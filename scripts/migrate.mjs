import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import pg from 'pg';
import dotenv from 'dotenv';

export async function readMigrations(
  directory = fileURLToPath(new URL('../database/migrations/', import.meta.url)),
) {
  const names = (await readdir(directory))
    .filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name))
    .sort();
  if (!names.length) throw new Error('No migration files found.');
  const versions = new Set();
  return Promise.all(
    names.map(async (name) => {
      const version = name.slice(0, 3);
      if (versions.has(version)) throw new Error('Duplicate migration version.');
      versions.add(version);
      const sql = (await readFile(resolve(directory, name), 'utf8'))
        .replace(/^\uFEFF/, '')
        .replace(/\r\n/g, '\n');
      if (!/^BEGIN;\s/i.test(sql.trim()) || !/\sCOMMIT;$/i.test(sql.trim()))
        throw new Error(`Migration ${name} must have one outer transaction.`);
      return {
        name,
        version,
        checksum: createHash('sha256').update(sql).digest('hex'),
        sql: sql
          .trim()
          .replace(/^BEGIN;\s*/i, '')
          .replace(/\s*COMMIT;$/i, ''),
      };
    }),
  );
}

export async function runMigrations(client, migrations, { baseline } = {}) {
  await client.query("SELECT pg_advisory_lock(hashtext('asteriq:schema-migrations'))");
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const applied = new Map(
      (await client.query('SELECT name, checksum FROM schema_migrations')).rows.map((row) => [
        row.name,
        row.checksum,
      ]),
    );
    for (const [name, checksum] of applied) {
      const migration = migrations.find((entry) => entry.name === name);
      if (!migration || migration.checksum !== checksum)
        throw new Error(`Applied migration differs from this image: ${name}`);
    }
    const existing = (await client.query("SELECT to_regclass('users') IS NOT NULL AS exists"))
      .rows[0].exists;
    if (baseline !== undefined) {
      if (!/^\d{3}$/.test(baseline) || !migrations.some((entry) => entry.version === baseline))
        throw new Error('Specify an existing three-digit baseline version.');
      if (applied.size || !existing)
        throw new Error('Baseline requires an existing untracked schema.');
      await client.query('BEGIN');
      try {
        for (const migration of migrations.filter((entry) => entry.version <= baseline)) {
          await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
            migration.name,
            migration.checksum,
          ]);
          applied.set(migration.name, migration.checksum);
        }
        await client.query('COMMIT');
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    } else if (!applied.size && existing) {
      throw new Error(
        'Existing schema has no migration history. Verify its applied versions and explicitly baseline it before startup.',
      );
    }
    const completed = [];
    for (const migration of migrations) {
      if (applied.has(migration.name)) continue;
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)', [
          migration.name,
          migration.checksum,
        ]);
        await client.query('COMMIT');
        completed.push(migration.name);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    return completed;
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('asteriq:schema-migrations'))");
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  let client;
  try {
    dotenv.config({ path: fileURLToPath(new URL('../.env', import.meta.url)) });
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.');
    const args = process.argv.slice(2);
    if (args.some((arg) => !/^--baseline=\d{3}$/.test(arg)) || args.length > 1)
      throw new Error('Usage: node scripts/migrate.mjs [--baseline=008]');
    client = new pg.Client({
      connectionString: process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL,
      connectionTimeoutMillis: 10000,
      statement_timeout: 120000,
    });
    await client.connect();
    const completed = await runMigrations(
      client,
      await readMigrations(),
      args.length ? { baseline: args[0].split('=')[1] } : {},
    );
    console.log(`Database schema ready; ${completed.length} migration(s) applied.`);
  } catch (error) {
    console.error(
      'Schema migration failed:',
      error instanceof Error ? error.message : 'Unknown failure',
    );
    process.exitCode = 1;
  } finally {
    await client?.end();
  }
}
