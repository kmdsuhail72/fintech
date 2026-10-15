import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Pool } from 'pg';
import { AlertEngine, matchesAlert, alertQuoteSchema } from '../src/alerts/alert-engine.js';
import type { AlertInput } from '../src/alerts/alert-engine.js';
import { createAlertSchema } from '../src/validators/api.validators.js';
import {
  AlertRepository,
  NotificationRepository,
} from '../src/repositories/domain.repositories.js';
import {
  DeliveryRepository,
  NotificationDeliveryWorker,
} from '../src/notifications/delivery-worker.js';
import type { DeliveryJob } from '../src/notifications/delivery-worker.js';
import { ExpoPushGateway } from '../src/notifications/push.gateway.js';

const quote = alertQuoteSchema.parse({
  symbolId: randomUUID(),
  symbol: 'AAPL',
  currency: 'USD',
  price: '251',
  previousClose: '250',
  timestamp: new Date().toISOString(),
  quoteStatus: 'SIMULATED',
  source: 'test',
});
const input: AlertInput = {
  symbolId: quote.symbolId,
  currency: 'USD',
  condition: 'ABOVE',
  targetPrice: '250',
  channels: ['IN_APP'],
};
test('strict price thresholds and exact absolute percentages', () => {
  assert.ok(matchesAlert(input, quote));
  assert.equal(matchesAlert(input, { ...quote, price: '250' }), false);
  assert.ok(
    matchesAlert(
      { ...input, condition: 'BELOW', targetPrice: '300' },
      { ...quote, price: '299.99' },
    ),
  );
  const percent: AlertInput = {
    ...input,
    condition: 'CHANGE_PERCENT',
    targetPrice: undefined,
    targetChangePercent: '5',
  };
  assert.equal(matchesAlert(percent, { ...quote, price: '105', previousClose: '100' }), false);
  assert.ok(matchesAlert(percent, { ...quote, price: '94.99', previousClose: '100' }));
  assert.ok(matchesAlert(percent, { ...quote, price: '105.01', previousClose: '100' }));
  assert.equal(matchesAlert(input, { ...quote, quoteStatus: 'STALE' }), false);
  assert.equal(matchesAlert(input, { ...quote, currency: 'EUR' }), false);
});
test('alert requests require exclusive thresholds and unique channel choices', () => {
  assert.equal(createAlertSchema.safeParse({ ...input, targetChangePercent: '5' }).success, false);
  assert.equal(createAlertSchema.safeParse({ ...input, channels: ['EMAIL'] }).success, false);
  assert.equal(
    createAlertSchema.safeParse({ ...input, channels: ['IN_APP', 'IN_APP'] }).success,
    false,
  );
  assert.equal(
    createAlertSchema.safeParse({
      ...input,
      condition: 'CHANGE_PERCENT',
      targetPrice: undefined,
      targetChangePercent: '0',
    }).success,
    false,
  );
  assert.equal(
    createAlertSchema.parse({
      ...input,
      condition: 'CHANGE_PERCENT',
      targetPrice: undefined,
      targetChangePercent: '5',
    }).targetChangePercent,
    '5',
  );
});

test('delivery routes stable IDs, receipts and retries without exposing provider errors', async () => {
  const outcomes: unknown[][] = [];
  const fake = {
    finish: async (...args: unknown[]) => {
      outcomes.push(args);
    },
    email: async () => 'verified@example.com',
    device: async () => 'ExpoPushToken[test]',
    removeInvalidDevice: async () => {},
  } as unknown as DeliveryRepository;
  const emitted: unknown[] = [];
  const socket = {
    to: (room: string) => ({
      emit: (name: string, data: unknown) => emitted.push([room, name, data]),
    }),
  };
  const mailed: unknown[] = [];
  const transport: typeof fetch = async (url) =>
    new Response(
      JSON.stringify({
        data: String(url).endsWith('getReceipts')
          ? { 'ticket-1': { status: 'ok' } }
          : [{ status: 'ok', id: 'ticket-1' }],
      }),
      { status: 200 },
    );
  const worker = new NotificationDeliveryWorker(
    fake,
    () => socket as never,
    new ExpoPushGateway(undefined, transport),
    {
      sendMail: async (options) => {
        mailed.push(options);
      },
    },
  );
  const job: DeliveryJob = {
    id: randomUUID(),
    notification_id: randomUUID(),
    user_id: randomUUID(),
    channel: 'IN_APP',
    device_id: null,
    title: 'Alert',
    body: 'Threshold matched',
    payload: { symbol: 'AAPL' },
    attempts: 1,
    lease_token: randomUUID(),
    provider_ticket: null,
  };
  await worker.deliver(job);
  assert.equal(outcomes.at(-1)?.[1], 'SENT');
  assert.equal((emitted[0] as unknown[])[0], `user:${job.user_id}`);
  await worker.deliver({ ...job, channel: 'EMAIL' });
  assert.equal(
    (mailed[0] as { messageId: string }).messageId,
    `<${job.notification_id}@notifications.asteriq.ai>`,
  );
  await worker.deliver({ ...job, channel: 'PUSH' });
  assert.equal(outcomes.at(-1)?.[1], 'ACCEPTED');
  await worker.deliver({ ...job, channel: 'PUSH', provider_ticket: 'ticket-1' });
  assert.equal(outcomes.at(-1)?.[1], 'SENT');
  const broken = new NotificationDeliveryWorker(
    fake,
    () => undefined,
    new ExpoPushGateway(undefined, transport),
    {
      sendMail: async () => {
        throw new Error('sensitive token');
      },
    },
  );
  await broken.deliver({ ...job, channel: 'EMAIL', attempts: 8 });
  assert.equal(outcomes.at(-1)?.[1], 'FAILED');
  assert.equal(outcomes.at(-1)?.[2], 'DELIVERY_UNAVAILABLE');
});

test(
  'database alert races create history and outbox once; pause, ownership, replay and leases are enforced',
  { skip: !process.env.ALERT_TEST_DATABASE_URL },
  async () => {
    const url = process.env.ALERT_TEST_DATABASE_URL!;
    const schema = 'alert_test_' + randomUUID().replaceAll('-', '');
    const admin = new Pool({ connectionString: url });
    const pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public` });
    try {
      await admin.query(`CREATE SCHEMA "${schema}"`);
      for (const file of [
        '001_initial_schema.sql',
        '002_authentication.sql',
        '006_push_devices.sql',
        '008_price_alert_engine.sql',
      ]) {
        await pool.query(
          await readFile(
            fileURLToPath(new URL(`../../../database/migrations/${file}`, import.meta.url)),
            'utf8',
          ),
        );
      }
      const owner = randomUUID(),
        stranger = randomUUID(),
        symbolId = randomUUID(),
        sessionId = randomUUID(),
        deviceId = randomUUID();
      await pool.query(
        `INSERT INTO users(id,email,password_hash,status,email_verified_at) VALUES($1,'owner@example.com','hash','ACTIVE',now()),($2,'stranger@example.com','hash','ACTIVE',now())`,
        [owner, stranger],
      );
      await pool.query(
        `INSERT INTO symbols(id,symbol,exchange_code,company_name,quote_currency) VALUES($1,'AAPL','NASDAQ','Apple','USD')`,
        [symbolId],
      );
      await pool.query(
        `INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES($1,$2,'test-hash',now()+interval '1 day')`,
        [sessionId, owner],
      );
      await pool.query(
        `INSERT INTO notification_devices(id,user_id,session_id,installation_id,expo_push_token,platform) VALUES($1,$2,$3,$4,'ExpoPushToken[test]','ios')`,
        [deviceId, owner, sessionId, randomUUID()],
      );
      const repository = new AlertRepository(pool),
        engine = new AlertEngine(pool),
        delivery = new DeliveryRepository(pool);
      const alert = await repository.create(owner, {
        ...input,
        symbolId,
        channels: ['IN_APP', 'EMAIL', 'PUSH'],
      });
      const percent = await repository.create(owner, {
        symbolId,
        currency: 'USD',
        condition: 'CHANGE_PERCENT',
        targetChangePercent: '5',
        channels: ['IN_APP'],
      });
      const paused = await repository.create(owner, { ...input, symbolId, targetPrice: '200' });
      await repository.updateStatus(owner, paused.id, 'PAUSED');
      await assert.rejects(repository.updateStatus(stranger, alert.id, 'PAUSED'));
      const event = {
        ...quote,
        symbolId,
        price: '260',
        previousClose: '240',
        timestamp: new Date(Date.now() + 1).toISOString(),
      };
      assert.equal(
        await engine.evaluate({ ...event, price: '105', previousClose: '100' }),
        0,
        'exactly 5% must not trigger',
      );
      assert.equal(await engine.evaluate({ ...event, quoteStatus: 'STALE' }), 0);
      await Promise.all(Array.from({ length: 8 }, () => engine.evaluate(event)));
      assert.equal((await pool.query('SELECT count(*) FROM notifications')).rows[0].count, '4');
      assert.equal(
        (await pool.query('SELECT count(*) FROM notification_outbox')).rows[0].count,
        '4',
      );
      assert.equal(
        (await repository.list(owner)).find((row) => row.id === paused.id).status,
        'PAUSED',
      );
      assert.equal(
        (await repository.list(owner)).find((row) => row.id === percent.id).status,
        'TRIGGERED',
      );
      await assert.rejects(repository.updateStatus(owner, alert.id, 'ACTIVE'));
      await repository.updateStatus(owner, paused.id, 'ACTIVE');
      assert.equal(
        await engine.evaluate(event),
        0,
        'old events cannot trigger an alert resumed after the event',
      );
      await engine.evaluate({ ...event, timestamp: new Date().toISOString() });
      assert.equal((await pool.query('SELECT count(*) FROM notifications')).rows[0].count, '5');
      const [first, second] = await Promise.all([delivery.claim(2), delivery.claim(2)]);
      assert.equal(
        new Set([...first, ...second].map((job) => job.id)).size,
        4,
        'concurrent delivery claims are disjoint',
      );
      const claimed = first[0];
      const abandoned = second[0];
      await pool.query(
        "UPDATE notification_outbox SET lease_until=now()-interval '1 second' WHERE id=$1",
        [abandoned.id],
      );
      const replacement = (await delivery.claim(10)).find((job) => job.id === abandoned.id)!;
      assert.equal(replacement.attempts, 2);
      assert.notEqual(replacement.lease_token, abandoned.lease_token);
      await delivery.finish(abandoned, 'SENT');
      assert.equal(
        (await pool.query('SELECT state FROM notification_outbox WHERE id=$1', [abandoned.id]))
          .rows[0].state,
        'PROCESSING',
      );
      await delivery.finish(replacement, 'SENT');
      await delivery.finish({ ...claimed, lease_token: randomUUID() }, 'SENT');
      assert.equal(
        (await pool.query('SELECT state FROM notification_outbox WHERE id=$1', [claimed.id]))
          .rows[0].state,
        'PROCESSING',
      );
      await delivery.finish(claimed, 'SENT');
      const notice = (
        await pool.query('SELECT * FROM notifications WHERE id=$1', [claimed.notification_id])
      ).rows[0];
      assert.equal(notice.status, 'SENT');
      await new NotificationRepository(pool).markRead(owner, notice.id);
      await delivery.finish(claimed, 'SENT');
      assert.equal(
        (await pool.query('SELECT status FROM notifications WHERE id=$1', [notice.id])).rows[0]
          .status,
        'READ',
      );
      await assert.rejects(new NotificationRepository(pool).markRead(stranger, notice.id));
      await pool.query(
        `INSERT INTO price_alerts(user_id,symbol_id,condition,target_price,currency)
        SELECT $1,$2,'ABOVE',1,'USD' FROM generate_series(1,501)`,
        [owner, symbolId],
      );
      const cohort = { ...event, timestamp: new Date(Date.now() + 1).toISOString() };
      assert.equal(await engine.evaluate(cohort), 500);
      assert.equal(await engine.evaluate(cohort), 1);
      assert.equal(await engine.evaluate(cohort), 0);
      assert.equal((await pool.query('SELECT count(*) FROM notifications')).rows[0].count, '506');
      // Force a notification insert failure and check alert transition rollback.
      const atomic = await repository.create(owner, { ...input, symbolId, targetPrice: '1' });
      await pool.query(
        `ALTER TABLE notifications ADD CONSTRAINT reject_new CHECK(notification_type <> 'PRICE_ALERT') NOT VALID`,
      );
      await assert.rejects(
        engine.evaluate({ ...event, timestamp: new Date(Date.now() + 1).toISOString() }),
      );
      assert.equal(
        (await repository.list(owner)).find((row) => row.id === atomic.id).status,
        'ACTIVE',
      );
    } finally {
      await pool.end();
      await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
      await admin.end();
    }
  },
);
