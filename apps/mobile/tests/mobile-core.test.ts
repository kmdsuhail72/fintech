import { prepareChartBars } from '../src/services/chartData';
import assert from 'node:assert/strict';
import test from 'node:test';
import { SessionController } from '../src/auth/session';
import { ApiClient, ApiError } from '../src/services/client';
import { validateTrade } from '../src/services/tradeValidation';
import { parseNotificationTarget } from '../src/notifications/routing';
import type { Quote } from '../src/services/types';
const auth = (refreshToken = 'refresh-next') => ({
  accessToken: 'access-next',
  refreshToken,
  accessTokenExpiresIn: 600,
  user: { id: 'user-one', email: 'test@example.test', displayName: 'Test' },
});
const json = (data: unknown, status = 200) =>
  new Response(
    JSON.stringify(
      status >= 400
        ? { ok: false, error: { code: 'AUTHENTICATION_REQUIRED', message: 'Sign in again.' } }
        : { ok: true, data },
    ),
    { status, headers: { 'Content-Type': 'application/json' } },
  );
function storage(saved: string | null = null, pin = false) {
  return {
    saved,
    pin,
    async read() {
      return this.saved;
    },
    async write(value: string) {
      this.saved = value;
    },
    async clear() {
      this.saved = null;
      this.pin = false;
    },
    async hasPin() {
      return this.pin;
    },
  };
}
const transport = (
  handler: (path: string, init: RequestInit | undefined) => Promise<Response> | Response,
) => (async (input, init) => handler(String(input), init)) as typeof fetch;
async function ready(store = storage(), fetcher = transport(() => json(auth()))) {
  const session = new SessionController('http://test/api/v1', store, fetcher);
  await session.boot();
  await session.login('test@example.test', 'test-password');
  store.pin = true;
  session.completePinSetup();
  return session;
}
test('cold start restores only a locked session and cannot request private tokens', async () => {
  const store = storage('stored-refresh', true);
  const session = new SessionController(
    'http://test',
    store,
    transport(() => json(auth())),
  );
  await session.boot();
  assert.equal(session.getSnapshot().status, 'locked');
  await assert.rejects(
    session.token(),
    (error) => error instanceof ApiError && error.code === 'APP_LOCKED',
  );
  await assert.rejects(session.unlock(false));
  await session.unlock(true);
  assert.equal(session.getSnapshot().status, 'ready');
  assert.equal(store.saved, 'refresh-next');
});
test('an orphan refresh token without a PIN requires server login', async () => {
  const store = storage('stored-refresh');
  const session = new SessionController('http://test', store);
  await session.boot();
  assert.equal(session.getSnapshot().status, 'signedOut');
  assert.equal(store.saved, null);
});
test('refresh is single-flight across simultaneous requests', async () => {
  let count = 0;
  const session = await ready(
    storage(),
    transport((path) => {
      if (path.endsWith('/refresh')) count++;
      return json(auth());
    }),
  );
  const tokens = await Promise.all([session.token(true), session.token(true), session.token(true)]);
  assert.equal(count, 1);
  assert.deepEqual(tokens, ['access-next', 'access-next', 'access-next']);
});
test('locking during refresh preserves the rotated refresh token but never unlocks the app', async () => {
  const store = storage();
  let release: ((response: Response) => void) | undefined;
  let started: (() => void) | undefined;
  const begun = new Promise<void>((resolve) => {
    started = resolve;
  });
  const session = await ready(
    store,
    transport((path) =>
      path.endsWith('/refresh')
        ? new Promise((resolve) => {
            release = resolve;
            started?.();
          })
        : json(auth('first-refresh')),
    ),
  );
  const pending = session.token(true);
  await begun;
  session.lock();
  release!(json(auth('rotated-refresh')));
  await assert.rejects(
    pending,
    (error) => error instanceof ApiError && error.code === 'APP_LOCKED',
  );
  assert.equal(store.saved, 'rotated-refresh');
  assert.equal(session.getSnapshot().status, 'locked');
});
test('late refresh cannot restore credentials after logout', async () => {
  const store = storage();
  let release: ((response: Response) => void) | undefined;
  let started: (() => void) | undefined;
  const begun = new Promise<void>((resolve) => {
    started = resolve;
  });
  const session = await ready(
    store,
    transport((path) =>
      path.endsWith('/refresh')
        ? new Promise((resolve) => {
            release = resolve;
            started?.();
          })
        : json(auth()),
    ),
  );
  const pending = session.token(true);
  await begun;
  await session.logout();
  release!(json(auth('stale-refresh')));
  await assert.rejects(pending);
  assert.equal(store.saved, null);
  assert.equal(session.getSnapshot().status, 'signedOut');
});
test('expired server session clears local credentials; network failure keeps the app locked', async () => {
  const store = storage('stored', true);
  const expired = new SessionController(
    'http://test',
    store,
    transport(() => json(null, 401)),
  );
  await expired.boot();
  await assert.rejects(expired.unlock(true));
  assert.equal(expired.getSnapshot().status, 'signedOut');
  const other = storage('stored', true);
  const offline = new SessionController(
    'http://test',
    other,
    transport(() => {
      throw new Error('Offline');
    }),
  );
  await offline.boot();
  await assert.rejects(offline.unlock(true));
  assert.equal(offline.getSnapshot().status, 'locked');
  assert.equal(other.saved, 'stored');
});
test('REST retries once after token refresh and preserves the trade idempotency key', async () => {
  const bodies: string[] = [];
  let requests = 0;
  const client = new ApiClient(
    'http://test',
    { token: async (force) => (force ? 'new-access' : 'old-access'), invalidate: async () => {} },
    transport((_, init) => {
      requests++;
      bodies.push(String(init?.body));
      assert.equal((init?.headers as Record<string, string>)['x-client-type'], 'mobile');
      return requests === 1 ? json(null, 401) : json({ id: 'order-one' });
    }),
  );
  const result = await client.request<{ id: string }>('/orders', {
    method: 'POST',
    body: { quantity: '1', idempotencyKey: 'one-review-one-key' },
  });
  assert.equal(result.id, 'order-one');
  assert.equal(requests, 2);
  assert.equal(bodies[0], bodies[1]);
});
test('REST handles successful empty deletion responses', async () => {
  const client = new ApiClient(
    'http://test',
    undefined,
    transport(() => new Response(null, { status: 204 })),
  );
  assert.equal(
    await client.request('/watchlists/items/one', { public: true, method: 'DELETE' }),
    undefined,
  );
});
test('trade guards cover precision, balances, holdings, currency, stale quotes and tiny orders', () => {
  const now = Date.now();
  const quote: Quote = {
    symbolId: 'symbol-one',
    symbol: 'AAPL',
    price: '200',
    changePercent: '1',
    currency: 'USD',
    timestamp: new Date(now).toISOString(),
    quoteStatus: 'SIMULATED',
    volume: 100,
  };
  const input = {
    quantity: '2',
    side: 'BUY' as const,
    cash: '1000',
    shares: '2',
    quote,
    currency: 'USD',
    now,
  };
  assert.equal(validateTrade(input), null);
  assert.match(validateTrade({ ...input, quantity: '0.000000001' })!, /quantity/);
  assert.match(validateTrade({ ...input, cash: '399' })!, /balance/);
  assert.match(validateTrade({ ...input, side: 'SELL', quantity: '3' })!, /shares/);
  assert.match(validateTrade({ ...input, currency: 'EUR' })!, /conversion/);
  assert.match(
    validateTrade({
      ...input,
      quote: { ...quote, timestamp: new Date(now - 61000).toISOString() },
    })!,
    /fresh/,
  );
  assert.match(validateTrade({ ...input, quantity: '0.00000001' })!, /minimum/);
});
test('notification routing only accepts whitelisted destinations', () => {
  assert.equal(parseNotificationTarget({ screen: 'Alerts' }), 'Alerts');
  assert.equal(parseNotificationTarget({ screen: 'Trade', quantity: '100' }), null);
  assert.equal(parseNotificationTarget({ screen: 'https://example.test' }), null);
  assert.equal(parseNotificationTarget(null), null);
});

test('mobile chart groups the full long-range span, retains extrema and keeps source-period SMA', () => {
  const bars = Array.from({ length: 600 }, (_, index) => ({
    timestamp: new Date(Date.UTC(2024, 0, 1 + index)).toISOString(),
    open: String(100 + index),
    high: String(102 + index),
    low: String(99 + index),
    close: String(101 + index),
    volume: '10',
    samples: 1,
  }));
  const result = prepareChartBars(bars, '5Y');
  assert.ok(result.length <= 240);
  assert.equal(result[0]!.open, bars[0]!.open);
  assert.equal(result.at(-1)!.close, bars.at(-1)!.close);
  assert.equal(result[0]!.volume, '30');
  assert.equal(result.at(-1)!.sma, 690.5);
  assert.equal(prepareChartBars(bars, '1D').length, 2);
});
