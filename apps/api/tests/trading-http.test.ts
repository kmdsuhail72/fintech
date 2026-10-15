import { PushDeviceRepository } from '../src/notifications/push.repository.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import test from 'node:test';
import type { Server } from 'node:http';
import { hash } from 'bcryptjs';
import { Pool } from 'pg';
import { createClient } from 'redis';

const databaseUrl = process.env.TEST_DATABASE_URL;
const redisUrl = process.env.TEST_REDIS_URL;

test(
  'authenticated trading HTTP flow, ownership, rejection rollback and interval candles',
  { skip: !databaseUrl || !redisUrl },
  async () => {
    assert.ok(databaseUrl);
    assert.ok(redisUrl);
    process.env.DATABASE_URL ??= databaseUrl;
    process.env.REDIS_URL ??= redisUrl;
    process.env.JWT_ACCESS_SECRET ??= 'isolated-http-test-secret-at-least-32-characters';
    const { createApp } = await import('../src/app.js');
    const schema = 'trading_http_' + randomUUID().replaceAll('-', '');
    const admin = new Pool({ connectionString: databaseUrl });
    const redis = createClient({ url: redisUrl });
    redis.on('error', () => {});
    let pool: Pool | undefined;
    let server: Server | undefined;
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      pool = new Pool({
        connectionString: databaseUrl,
        options: `-c search_path=${schema},public`,
      });
      const migrations = resolve(process.cwd(), '../../database/migrations');
      for (const file of (await readdir(migrations))
        .filter((file) => /^\d+_.+\.sql$/.test(file))
        .sort()) {
        await pool.query(await readFile(resolve(migrations, file), 'utf8'));
      }
      await redis.connect();
      const password = 'Paper-trading-test-2026!';
      const passwordHash = await hash(password, 4);
      const userId = randomUUID();
      const otherId = randomUUID();
      for (const id of [userId, otherId])
        await pool.query(
          "INSERT INTO users (id, email, password_hash, status, email_verified_at) VALUES ($1, $2, $3, 'ACTIVE', now())",
          [id, id + '@example.test', passwordHash],
        );
      const accountId = randomUUID();
      const portfolioId = randomUUID();
      await pool.query(
        "INSERT INTO accounts (id, user_id, account_type, name, base_currency, initial_virtual_capital) VALUES ($1, $2, 'PAPER', 'HTTP test', 'USD', 1000)",
        [accountId, userId],
      );
      await pool.query(
        "INSERT INTO wallets (account_id, currency, balance) VALUES ($1, 'USD', 1000)",
        [accountId],
      );
      await pool.query(
        "INSERT INTO portfolios (id, account_id, name, base_currency) VALUES ($1, $2, 'HTTP test', 'USD')",
        [portfolioId, accountId],
      );
      const symbolId = randomUUID();
      await pool.query(
        "INSERT INTO symbols (id, symbol, exchange_code, company_name, asset_type, quote_currency, is_active) VALUES ($1, 'HTTPTEST', 'TEST', 'HTTP Test Asset', 'EQUITY', 'USD', true)",
        [symbolId],
      );
      const quote = async (price: string, timestamp?: string, volume = 0) =>
        pool!.query(
          "INSERT INTO market_quotes (symbol_id, price, currency, quote_status, source, observed_at, open_price, high_price, low_price, previous_close, change_amount, change_percent, volume) VALUES ($1, $2, 'USD', 'SIMULATED', 'http-test', COALESCE($3::timestamptz, now()), $2, $2, $2, $2, 0, 0, $4)",
          [symbolId, price, timestamp ?? null, volume],
        );
      const {
        rows: [{ bucket }],
      } = await pool.query<{ bucket: Date }>(
        "SELECT date_bin('5 minutes', now(), '2000-01-01'::timestamptz) - interval '5 minutes' AS bucket",
      );
      await quote('200', new Date(bucket.getTime() - 60_000).toISOString(), 90);
      for (const [index, price] of ['200', '210', '195', '205'].entries())
        await quote(
          price,
          new Date(bucket.getTime() + (index + 1) * 10000).toISOString(),
          [100, 130, 160, 200][index],
        );
      await quote('200', undefined, 220);
      const app = createApp(pool, redis);
      server = app.listen(0, '127.0.0.1');
      await new Promise<void>((resolve) => server!.once('listening', resolve));
      const address = server.address();
      assert.ok(address && typeof address !== 'string');
      const base = 'http://127.0.0.1:' + address.port + '/api/v1';
      type Envelope = { ok: boolean; data?: unknown; error?: { code: string } };
      const request = async (path: string, method = 'GET', body?: unknown, token?: string) => {
        const response = await fetch(base + path, {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: 'Bearer ' + token } : {}),
          },
          ...(body ? { body: JSON.stringify(body) } : {}),
        });
        return {
          status: response.status,
          body: response.status === 204 ? null : ((await response.json()) as Envelope),
        };
      };
      assert.equal((await request('/health')).status, 200);
      assert.equal((await request('/ready')).status, 200);
      assert.equal((await request('/orders')).status, 401);
      const login = async (id: string) => {
        const result = await request('/auth/login', 'POST', {
          email: id + '@example.test',
          password,
        });
        assert.equal(result.status, 200);
        return (result.body!.data as { accessToken: string }).accessToken;
      };
      const token = await login(userId);
      const otherToken = await login(otherId);
      const installationId = randomUUID();
      const deviceToken = 'ExponentPushToken[test_device_token]';
      const registered = await request(
        '/notifications/devices',
        'POST',
        { installationId, token: deviceToken, platform: 'android' },
        token,
      );
      assert.equal(registered.status, 201);
      assert.equal((await new PushDeviceRepository(pool).eligibleForUser(userId)).length, 1);
      const takeover = await request(
        '/notifications/devices',
        'POST',
        { installationId: randomUUID(), token: deviceToken, platform: 'ios' },
        otherToken,
      );
      assert.equal(takeover.status, 409);
      assert.equal((await new PushDeviceRepository(pool).eligibleForUser(otherId)).length, 0);
      assert.equal(
        (await request('/notifications/devices/' + installationId, 'DELETE', undefined, otherToken))
          .status,
        204,
      );
      assert.equal((await new PushDeviceRepository(pool).eligibleForUser(userId)).length, 1);
      assert.equal(
        (
          await request(
            '/notifications/devices',
            'POST',
            { installationId, token: 'malformed', platform: 'android' },
            token,
          )
        ).status,
        400,
      );
      const watchlistResult = await request(
        '/watchlists',
        'POST',
        { name: 'My actual watchlist' },
        token,
      );
      assert.equal(watchlistResult.status, 201);
      const watchlistId = (watchlistResult.body!.data as { id: string }).id;
      assert.equal(
        (await request('/watchlists/' + watchlistId + '/items', 'POST', { symbolId }, token))
          .status,
        201,
      );
      const lists = (await request('/watchlists', 'GET', undefined, token)).body!.data as Array<{
        items: Array<{ symbol: string }>;
      }>;
      assert.equal(lists[0]!.items[0]!.symbol, 'HTTPTEST');
      assert.deepEqual((await request('/watchlists', 'GET', undefined, otherToken)).body!.data, []);
      const candles = await request('/market/quotes/HTTPTEST/candles?interval=5m&limit=3');
      assert.equal(candles.status, 200);
      const bars = (
        candles.body!.data as {
          candles: Array<{
            timestamp: string;
            open: string;
            high: string;
            low: string;
            close: string;
            samples: number;
            volume: string | null;
          }>;
        }
      ).candles;
      const bar = bars.find((bar) => bar.timestamp === bucket.toISOString())!;
      assert.ok(bar);
      assert.deepEqual([bar.open, bar.high, bar.low, bar.close].map(Number), [200, 210, 195, 205]);
      assert.equal(bar.samples, 4);
      assert.equal(Number(bar.volume), 110);
      assert.equal((await request('/market/quotes/HTTPTEST/candles?interval=2m')).status, 400);
      assert.equal((await request('/market/quotes/DOESNOTEXIST/candles')).status, 404);
      for (const interval of ['1m', '15m', '1h', '1d']) {
        assert.equal(
          (await request('/market/quotes/HTTPTEST/candles?interval=' + interval)).status,
          200,
        );
      }
      assert.equal((await request('/market/quotes/HTTPTEST/candles?limit=0')).status, 400);
      assert.equal((await request('/market/quotes/HTTPTEST/candles?limit=2001')).status, 400);
      const recentBars = (await request('/market/quotes/HTTPTEST/candles?interval=5m&limit=1'))
        .body!.data as { candles: unknown[] };
      assert.equal(recentBars.candles.length, 1);
      const emptySymbolId = randomUUID();
      await pool.query(
        "INSERT INTO symbols (id, symbol, exchange_code, company_name, asset_type, quote_currency, is_active) VALUES ($1, 'EMPTYTEST', 'TEST', 'No samples', 'EQUITY', 'USD', true)",
        [emptySymbolId],
      );
      const emptyCandles = await request('/market/quotes/EMPTYTEST/candles');
      assert.equal(emptyCandles.status, 200);
      assert.deepEqual((emptyCandles.body!.data as { candles: unknown[] }).candles, []);
      const place = (side: 'BUY' | 'SELL', quantity: string, key = randomUUID()) =>
        request(
          '/orders',
          'POST',
          { portfolioId, symbolId, side, quantity, idempotencyKey: key },
          token,
        );
      const state = async () => {
        const portfolio = (await request('/portfolio', 'GET', undefined, token)).body!
          .data as Array<{ cash_balance: string; positions: Array<{ quantity: string }> }>;
        return {
          cash: Number(portfolio[0]!.cash_balance),
          shares: Number(portfolio[0]!.positions[0]?.quantity ?? 0),
          orders: ((await request('/orders', 'GET', undefined, token)).body!.data as unknown[])
            .length,
          trades: ((await request('/trades', 'GET', undefined, token)).body!.data as unknown[])
            .length,
        };
      };
      const key = randomUUID();
      const buy = await place('BUY', '2', key);
      assert.equal(buy.status, 201);
      const buyId = (buy.body!.data as { id: string }).id;
      assert.deepEqual(await state(), { cash: 600, shares: 2, orders: 1, trades: 1 });
      assert.equal((await place('BUY', '2', key)).status, 201);
      assert.deepEqual(await state(), { cash: 600, shares: 2, orders: 1, trades: 1 });
      const insufficientCash = await place('BUY', '4');
      assert.equal(insufficientCash.status, 409);
      assert.equal(insufficientCash.body!.error!.code, 'INSUFFICIENT_VIRTUAL_CASH');
      const insufficientShares = await place('SELL', '3');
      assert.equal(insufficientShares.status, 409);
      assert.equal(insufficientShares.body!.error!.code, 'INSUFFICIENT_POSITION');
      assert.equal((await place('BUY', '0.000000001')).status, 400);
      const tooSmall = await place('BUY', '0.00000001');
      assert.equal(tooSmall.status, 422);
      assert.equal(tooSmall.body!.error!.code, 'ORDER_VALUE_TOO_SMALL');
      const wrongPortfolio = await request(
        '/orders',
        'POST',
        {
          portfolioId: randomUUID(),
          symbolId,
          side: 'BUY',
          quantity: '1',
          idempotencyKey: randomUUID(),
        },
        token,
      );
      assert.equal(wrongPortfolio.status, 404);
      assert.deepEqual(await state(), { cash: 600, shares: 2, orders: 1, trades: 1 });
      assert.equal((await request('/orders/' + buyId, 'DELETE', undefined, token)).status, 404);
      assert.equal(
        (await request('/orders/' + buyId, 'DELETE', undefined, otherToken)).status,
        404,
      );
      assert.equal((await place('SELL', '1')).status, 201);
      assert.deepEqual(await state(), { cash: 800, shares: 1, orders: 2, trades: 2 });
      const pendingId = randomUUID();
      await pool.query(
        "INSERT INTO orders (id, account_id, portfolio_id, symbol_id, side, status, quantity, filled_quantity, idempotency_key) VALUES ($1, $2, $3, $4, 'BUY', 'PENDING', 1, 0, $5)",
        [pendingId, accountId, portfolioId, symbolId, randomUUID()],
      );
      assert.equal(
        (await request('/orders/' + pendingId, 'DELETE', undefined, otherToken)).status,
        404,
      );
      const cancel = await request('/orders/' + pendingId, 'DELETE', undefined, token);
      assert.equal(cancel.status, 200);
      assert.equal((cancel.body!.data as { status: string }).status, 'CANCELLED');
      assert.deepEqual(await state(), { cash: 800, shares: 1, orders: 3, trades: 2 });
      await pool.query(
        "UPDATE market_quotes SET observed_at = now() - interval '10 minutes' WHERE symbol_id = $1",
        [symbolId],
      );
      const unavailable = await place('BUY', '1');
      assert.equal(unavailable.status, 503);
      assert.equal(unavailable.body!.error!.code, 'QUOTE_UNAVAILABLE');
      assert.deepEqual(await state(), { cash: 800, shares: 1, orders: 3, trades: 2 });
      assert.equal(
        (
          await request(
            '/watchlists/' + watchlistId + '/items/' + symbolId,
            'DELETE',
            undefined,
            token,
          )
        ).status,
        204,
      );
      const emptiedLists = (await request('/watchlists', 'GET', undefined, token)).body!
        .data as Array<{ items: unknown[] }>;
      assert.deepEqual(emptiedLists[0]!.items, []);
      await request('/auth/logout-all', 'POST', {}, token);
      assert.equal((await new PushDeviceRepository(pool).eligibleForUser(userId)).length, 0);
      await request('/auth/logout-all', 'POST', {}, otherToken);
    } finally {
      if (server)
        await new Promise<void>((resolve, reject) =>
          server!.close((error) => (error ? reject(error) : resolve())),
        );
      if (redis.isOpen) await redis.quit();
      await pool?.end();
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
  },
);
