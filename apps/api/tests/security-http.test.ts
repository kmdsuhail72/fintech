import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { createClient } from 'redis';
import { createServer } from 'node:http';
import { io as connectSocket } from 'socket.io-client';
import { SignJWT } from 'jose';
import express from 'express';

const db = process.env.TEST_DATABASE_URL,
  cache = process.env.TEST_REDIS_URL;
test(
  'real session status, socket JWT expiry/origin, and HTTP body errors',
  { skip: !db || !cache },
  async () => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = db;
    process.env.REDIS_URL = cache;
    process.env.JWT_ACCESS_SECRET ??= 'synthetic-http-security-key-at-least-32-characters';
    const { env } = await import('../src/config.js');
    const { createApp } = await import('../src/app.js');
    const { AuthService } = await import('../src/auth/service.js');
    const { createSocketServer } = await import('../src/socket/socket.server.js');
    const admin = new Pool({ connectionString: db });
    const schema = 'security_' + randomUUID().replaceAll('-', '');
    const pool = new Pool({ connectionString: db, options: `-c search_path=${schema},public` });
    const redis = createClient({ url: cache });
    redis.on('error', () => {});
    let sockets: Awaited<ReturnType<typeof createSocketServer>> | undefined;
    const server = createServer();
    const clients: ReturnType<typeof connectSocket>[] = [];
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      const dir = fileURLToPath(new URL('../../../database/migrations/', import.meta.url));
      for (const name of (await readdir(dir)).filter((name) => /^\d+_.+\.sql$/.test(name)).sort()) {
        await pool.query(await readFile(dir + name, 'utf8'));
      }
      await redis.connect();
      const previousMode = env.NODE_ENV;
      const previousHops = env.TRUST_PROXY_HOPS;
      env.NODE_ENV = 'production';
      env.TRUST_PROXY_HOPS = 2;
      const application = createApp(pool, redis);
      env.NODE_ENV = previousMode;
      env.TRUST_PROXY_HOPS = previousHops;
      const probe = express();
      probe.set('trust proxy', application.get('trust proxy'));
      probe.get('/client-ip', (request, response) => response.json({ ip: request.ip }));
      server.on('request', (request, response) => {
        if (request.url === '/client-ip') probe(request, response);
        else application(request, response);
      });
      const user = randomUUID(),
        session = randomUUID();
      await pool.query(
        "INSERT INTO users(id,email,password_hash,status) VALUES($1,$2,'unused','ACTIVE')",
        [user, user + '@example.test'],
      );
      await pool.query(
        "INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 day')",
        [session, user, randomUUID()],
      );
      const auth = new AuthService(pool, redis);
      await auth.assertSessionActive(session, user);
      await pool.query("UPDATE users SET status='SUSPENDED' WHERE id=$1", [user]);
      await assert.rejects(auth.assertSessionActive(session, user));
      await pool.query("UPDATE users SET status='ACTIVE' WHERE id=$1", [user]);
      sockets = await createSocketServer(server, pool, redis);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const url = `http://127.0.0.1:${address.port}`;
      const clientIp = await fetch(url + '/client-ip', {
        headers: { 'X-Forwarded-For': '198.51.100.99, 192.0.2.10' },
      });
      assert.deepEqual(await clientIp.json(), { ip: '198.51.100.99' });
      const spoofedIp = await fetch(url + '/client-ip', {
        headers: { 'X-Forwarded-For': '198.51.100.99, 203.0.113.10, 192.0.2.10' },
      });
      assert.deepEqual(await spoofedIp.json(), { ip: '203.0.113.10' });
      const malformed = await fetch(url + '/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"password":"never-echo-this"',
      });
      assert.equal(malformed.status, 400);
      assert.doesNotMatch(await malformed.text(), /never-echo-this/);
      const oversized = await fetch(url + '/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'x'.repeat(1_100_000) }),
      });
      assert.equal(oversized.status, 413);
      const jwt = await new SignJWT({ sid: session })
        .setSubject(user)
        .setIssuedAt()
        .setIssuer(env.JWT_ISSUER)
        .setAudience(env.JWT_AUDIENCE)
        .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
        .setExpirationTime('4s')
        .sign(new TextEncoder().encode(env.JWT_ACCESS_SECRET));
      const rejected = connectSocket(url, {
        auth: { token: jwt },
        transports: ['websocket'],
        extraHeaders: { Origin: 'https://foreign.example.test' },
        reconnection: false,
      });
      clients.push(rejected);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('origin rejection timed out')), 3000);
        rejected.once('connect', () => {
          clearTimeout(timer);
          reject(new Error('foreign origin accepted'));
        });
        rejected.once('connect_error', () => {
          clearTimeout(timer);
          resolve();
        });
      });
      const client = connectSocket(url, {
        auth: { token: jwt },
        transports: ['websocket'],
        reconnection: false,
      });
      clients.push(client);
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('socket expiry timed out')), 7000);
        client.once('disconnect', (reason) => {
          clearTimeout(timer);
          assert.equal(reason, 'io server disconnect');
          resolve();
        });
        client.once('connect_error', (error) => {
          clearTimeout(timer);
          reject(error);
        });
      });
    } finally {
      clients.forEach((client) => client.disconnect());
      if (sockets) await sockets.close();
      else await new Promise<void>((resolve) => server.close(() => resolve()));
      if (redis.isOpen) await redis.quit();
      await pool.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  },
);
