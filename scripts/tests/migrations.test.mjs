import assert from 'node:assert/strict';
import test from 'node:test';
import { readMigrations, runMigrations } from '../migrate.mjs';

class FakeClient {
  history = new Map();
  existing = false;
  fail = false;
  calls = [];
  async query(sql, args = []) {
    this.calls.push(sql);
    if (sql.startsWith('SELECT name'))
      return { rows: [...this.history].map(([name, checksum]) => ({ name, checksum })) };
    if (sql.includes('to_regclass')) return { rows: [{ exists: this.existing }] };
    if (sql.startsWith('INSERT INTO schema_migrations')) this.history.set(args[0], args[1]);
    if (sql === 'CREATE TEST DATA' && this.fail) throw new Error('Forced migration failure');
    return { rows: [] };
  }
}
const migration = {
  name: '001_test.sql',
  version: '001',
  checksum: 'abc',
  sql: 'CREATE TEST DATA',
};
test('numbered migrations normalize wrappers and include every current schema version', async () => {
  const files = await readMigrations();
  assert.deepEqual(
    files.map((file) => file.version),
    ['001', '002', '003', '004', '005', '006', '007', '008'],
  );
  for (const file of files) {
    assert.equal(file.checksum.length, 64);
    assert.ok(!file.sql.startsWith('BEGIN;') && !file.sql.endsWith('COMMIT;'));
  }
});
test('migrations lock, record once, and refuse edited or missing applied files', async () => {
  const client = new FakeClient();
  assert.deepEqual(await runMigrations(client, [migration]), ['001_test.sql']);
  assert.deepEqual(await runMigrations(client, [migration]), []);
  assert.equal(client.calls.filter((sql) => sql === 'CREATE TEST DATA').length, 1);
  assert.ok(client.calls.some((sql) => sql.includes('pg_advisory_lock(')));
  await assert.rejects(runMigrations(client, [{ ...migration, checksum: 'changed' }]), /differs/);
  await assert.rejects(runMigrations(client, []), /differs/);
});
test('failed DDL is rolled back without recording success and always unlocks', async () => {
  const client = new FakeClient();
  client.fail = true;
  await assert.rejects(runMigrations(client, [migration]), /Forced/);
  assert.equal(client.history.size, 0);
  assert.ok(client.calls.includes('ROLLBACK'));
  assert.ok(client.calls.at(-1).includes('pg_advisory_unlock'));
});
test('untracked existing schemas need explicit baselines; baseline records verified versions', async () => {
  const client = new FakeClient();
  client.existing = true;
  await assert.rejects(runMigrations(client, [migration]), /no migration history/);
  assert.deepEqual(await runMigrations(client, [migration], { baseline: '001' }), []);
  assert.equal(client.history.get(migration.name), migration.checksum);
  assert.ok(!client.calls.includes('CREATE TEST DATA'));
  await assert.rejects(runMigrations(client, [migration], { baseline: '001' }), /untracked/);
});
