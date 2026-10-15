import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import type { Pool } from 'pg';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { registry, prometheusEvent, instrumentDatabase } from '../src/utils/prometheus.js';

test('committed trade metrics are cumulative and ignore invalid samples', async () => {
  registry.resetMetrics();
  prometheusEvent('TradesExecuted', 2);
  prometheusEvent('TradesExecuted', Number.NaN);
  const text = await registry.metrics();
  assert.match(text, /# TYPE asteriq_trades_total counter/);
  assert.match(text, /asteriq_trades_total 2/);
});

test('Redis probe health is exported independently of CloudWatch configuration', async () => {
  prometheusEvent('RedisHealthy', 0);
  assert.match(await registry.metrics(), /asteriq_redis_healthy 0/);
  prometheusEvent('RedisHealthy', 1);
  assert.match(await registry.metrics(), /asteriq_redis_healthy 1/);
});

test('API exposes parseable metrics without counting scrapes or accessing dependencies', async () => {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://unused:unused@localhost/unused',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'test-only-signing-key-at-least-32-characters',
    SMTP_URL: '',
    AUTH_EMAIL_FROM: '',
  });
  const { Pool } = await import('pg');
  const { createApp } = await import('../src/app.js');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const redis = { sendCommand: async () => 'test-script-sha' };
  const server = createServer(createApp(pool, redis as Parameters<typeof createApp>[1]));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  try {
    registry.resetMetrics();
    for (let scrape = 0; scrape < 2; scrape++) {
      const response = await fetch(`http://127.0.0.1:${address.port}/metrics`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') ?? '', /text\/plain/);
      const body = await response.text();
      assert.match(body, /# TYPE asteriq_http_requests_total counter/);
      assert.match(body, /asteriq_http_active_requests 0/);
      assert.ok(!body.includes('operation="core"'));
    }
  } finally {
    server.close();
    await once(server, 'close');
    await pool.end();
  }
});

test('database instrumentation preserves promises, callbacks and errors without SQL labels', async () => {
  const pool = new EventEmitter();
  instrumentDatabase(pool as unknown as Pool);
  const client = {
    query(...args: unknown[]) {
      const callback = args.at(-1);
      if (typeof callback === 'function') {
        callback(null, { rows: [1] });
        return;
      }
      if (args[0] === 'FAIL') return Promise.reject(new Error('query failed'));
      return Promise.resolve({ rows: [1] });
    },
  };
  pool.emit('connect', client);
  assert.deepEqual(await client.query('SELECT private_value'), { rows: [1] });
  await assert.rejects(client.query('FAIL'), /query failed/);
  client.query('SELECT secret', (error: unknown, result: unknown) => {
    assert.equal(error, null);
    assert.deepEqual(result, { rows: [1] });
  });
  const text = await registry.metrics();
  assert.match(text, /asteriq_database_query_duration_seconds_count\{outcome="success"\} 2/);
  assert.match(text, /asteriq_database_query_duration_seconds_count\{outcome="error"\} 1/);
  assert.ok(!text.includes('private_value') && !text.includes('SELECT secret'));
});
