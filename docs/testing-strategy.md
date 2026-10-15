# Asteriq AI automated testing strategy

The strategy covers the React frontend, Node API, FastAPI AI service, PostgreSQL,
Redis, workers, WebSockets, Docker deployment, and AWS configuration. Asteriq
currently implements paper trading; test assertions must not imply live brokerage
execution or real-money custody.

This document provides the target structure, configurations, fixture contracts,
and sample cases. It does **not** install the new runners or replace the existing
suite. Samples requiring a fixture adapter are identified below.

## Test layers and tools

| Layer                       | Tools                                                   | What must be real                                                   | What can be replaced                                                             |
| --------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Frontend unit/component     | Vitest, React Testing Library, user-event, jsdom        | Components, hooks, validation, React Query behavior                 | HTTP with MSW; chart canvas where jsdom cannot render it                         |
| Backend unit                | Jest                                                    | Decimal/business rules, schemas, error mapping                      | Injected AI/email/market transports and clocks                                   |
| Backend integration         | Jest + Supertest                                        | Express middleware, authentication, PostgreSQL, Redis, transactions | External AI, market, email, and push providers                                   |
| Python unit/HTTP            | pytest + FastAPI TestClient/httpx                       | Schemas, calculations, provider adapters, response contracts        | Provider transport/model, backend transport, clock                               |
| Python database integration | pytest + PostgreSQL/pgvector                            | Owner-scoped retrieval, vector queries, transaction behavior        | Embedding vectors generated deterministically                                    |
| Browser component/contract  | Playwright                                              | Browser and frontend                                                | Explicitly mocked backend responses; report separately from E2E                  |
| End-to-end                  | Playwright                                              | Browser, API, AI HTTP process, PostgreSQL, Redis, worker, proxy     | External vendor calls only                                                       |
| Load/resilience             | k6                                                      | Staging-like deployment and data stores                             | Deterministic vendor simulators unless running a separately budgeted vendor test |
| Security                    | Negative Jest/pytest/Playwright cases, Trivy, OWASP ZAP | Authorization, JWT/session checks, proxy chain, headers, IAM plans  | External services; use synthetic attacker/victim accounts                        |

Keep tests close to each application. Put cross-application tests at the root.
Do not use an in-memory database to validate PostgreSQL locking, numeric precision,
idempotency, migrations, pgvector, or Redis coordination.

## Target directory structure

This is the recommended destination, not a claim that all directories already exist:

```text
apps/web/
  vitest.config.ts
  tests/
    setup.ts
    unit/                 formatting, quantities, hooks, cache identity
    components/           auth, order ticket, quotes, portfolio, watchlists, alerts
    integration/          page workflows using MSW
    fixtures/             market/portfolio response factories
    mocks/handlers.ts     named HTTP scenarios

apps/api/
  jest.config.mjs
  tests/jest/
    setup-env.mjs
    unit/                 validators, analytics, alerts, AI failure adapters
    integration/          auth, quotes, orders, portfolios, watchlists, alerts
    security/             JWT, BOLA, RBAC, CSRF, rate limits, sockets, auditing
    helpers/fixture.mjs   isolated real DB/Redis/app fixture
    helpers/email.mjs     captured outbox
    helpers/clock.mjs     fixed timestamps
    fixtures/             users, roles, portfolios, instruments, quotes

apps/ai-service/
  pyproject.toml
  tests/
    conftest.py
    unit/                 technical, sentiment, portfolio, provider failure cases
    integration/          FastAPI contracts, backend callback, pgvector isolation
    security/             owner tampering, malformed documents, token forwarding
    fixtures/             deterministic evidence, vectors, provider responses

tests/
  e2e/
    playwright.config.ts
    fixtures.ts           browser + isolated full-stack fixture
    auth.spec.ts
    trading.spec.ts
    portfolio.spec.ts
    watchlists.spec.ts
    alerts.spec.ts
    research.spec.ts
    security.spec.ts
  load/
    quotes.js
    trading.js
    websocket.js
    ai-capacity.js
  security/
    zap/                  context, authenticated scan configuration, rule policy
    regression-matrix.md
  contracts/              Node/FastAPI envelopes and upstream failure contracts
  fixtures/               shared synthetic accounts and golden financial cases

scripts/test/             start/health-check/seed/cleanup isolated test stack
test-results/             ignored JUnit, coverage, traces, screenshots, summaries
```

Keep existing `node:test` files working during migration. Convert imports/assertions
to Jest/Vitest incrementally; do not simply point the new runner at `node:test`
files or run a file under two runners. The current `.github/workflows/_quality.yml`
already provides PostgreSQL/pgvector and Redis, JavaScript tests, and pytest.
Retain its existing paper-trading, alert, ownership, and migration assertions.

## Required feature matrix

| Feature                | Positive cases                                                                                              | Negative, security, and boundary cases                                                                                                                                               | Layers                                      |
| ---------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Registration           | Normalized email, 202 response, pending user, hashed password, one-time verification, initial paper funding | Duplicate email gives generic response; short/oversized UTF-8 password; extra `role` rejected; email failure; expired/reused token; no production development-token output           | RTL, Jest integration, E2E                  |
| Login                  | Verified active user, access JWT, web refresh cookie, mobile body token                                     | Invalid password/email generic errors; unverified/suspended user denied; lockout; rate limit; no plaintext credentials in logs                                                       | RTL, Jest integration/security, E2E         |
| Authentication         | Valid bearer identity; refresh rotation; logout/revoke/all-device logout                                    | Missing/tampered/expired JWT; wrong issuer/audience/algorithm; missing required claims; refresh replay including concurrent reuse; suspended account; socket revocation/expiry       | Jest, pytest callback, Playwright           |
| Market quotes          | Correct symbol, price, timestamp, currency, simulated label, OHLC intervals                                 | Unknown symbol; stale/missing quote; non-finite numeric input; invalid interval/limit; malformed provider response; reconnect/refresh                                                | RTL, Jest integration, E2E, k6              |
| Buy order              | Filled at server quote; wallet debited; position/trade/ledger created                                       | Zero/negative quantity; foreign portfolio; unsupported currency; stale quote; insufficient funds; retry/idempotency conflict; parallel spending                                      | RTL, Jest real DB, E2E                      |
| Sell order             | Wallet credited, holding reduced, realized P/L correct                                                      | No holding; oversell; foreign account; decimal rounding; concurrent sell; duplicate submit; failed write rollback                                                                    | RTL, Jest real DB, E2E                      |
| Insufficient balance   | 409 `INSUFFICIENT_VIRTUAL_CASH`; useful UI message                                                          | Wallet, positions, trades, orders, and ledger unchanged; no optimistic success; disabled duplicate click                                                                             | Jest real DB, RTL, E2E                      |
| Portfolio calculations | Cash, weighted average cost, market value, realized/unrealized P/L, allocation, equity                      | Empty portfolio; fractional lots; zero denominator; missing/stale quotes; currency mismatch; exact precision; reconciliation to ledger                                               | Jest unit/DB, pytest, RTL, E2E              |
| Watchlists             | Create/rename/delete; add/remove symbol; refresh persistence                                                | Other user's list inaccessible; duplicate item; unknown/inactive symbol; invalid UUID; empty/error UI; cache cleared on account change                                               | Jest integration, RTL, E2E                  |
| Alerts                 | Create/pause/cancel; matching quote creates owner notification                                              | Equality does not trigger strict ABOVE/BELOW; wrong currency; stale quote; percent threshold; duplicate/replayed quote; worker restart; concurrent workers; other user cannot mutate | Jest unit/DB/Redis, RTL, E2E                |
| AI endpoint failures   | Valid structured report with citations/disclaimer                                                           | Missing/expired auth; timeout; network reset; 401/403/422/429/5xx policy; invalid JSON/schema; oversized response; missing key/model; unknown citations; no secret echo; retry UX    | Jest adapters/integration, pytest, RTL, E2E |

Test email verification through the public API with a captured synthetic outbox,
not by setting `status=ACTIVE` in the registration happy path. Database seeding is
appropriate for trading tests focused on trading, not as a substitute for auth tests.

## Deterministic fixture and isolation rules

- A suite must explicitly require `TEST_DATABASE_URL`/`TEST_REDIS_URL` for its
  integration project. In CI, missing infrastructure is a failure, not a silent skip.
  Require an allowlisted disposable database/host and `TEST_ENVIRONMENT=isolated`.
- Use a unique PostgreSQL schema per worker/test and a distinct Redis database
  per worker or disposable Redis instance. Current auth/API limiter prefixes are
  fixed, so merely generating unique user IDs does not isolate IP rate limits.
- Apply the actual migrations. Preinstall `pgcrypto` and `vector` in `public`
  with a bootstrap role; test runtime grants separately with restricted roles.
  Never run database cleanup against a production URL or call shared `FLUSHALL`.
- Seed two users, an admin, instrument IDs, coherent initial funding, wallet,
  portfolio, and explicit quote timestamps. Use UUIDs, never placeholder IDs that
  bypass validators. Disable the market simulator for deterministic order tests.
- Use decimal strings and exact golden values. Generate quote timestamps relative
  to a fixed test clock; use real timers in real DB/socket integration tests unless
  the application clock is explicitly injected. Do not mock all of `Date` globally.
- Capture email/push messages without sending them. Mock vendor transports, not
  session checks, database ownership predicates, or transaction execution.
- Close HTTP servers, WebSockets, pools, subscribers, workers, and clients in
  `finally`/teardown. Drop only the generated schema after verifying its prefix.
- Tests are independent: each gets fresh data, including a new idempotency key.
  Add separate tests that deliberately share a key or race a balance.
- Do not store credentials, authenticated Playwright state, tokens, or private
  report contents in snapshots, traces, or uploaded artifacts.

### Golden financial scenario

No fees, USD, initial paper capital 1,000.00:

| Operation            | Cash | Quantity | Average cost | Market value | Equity | Realized P/L | Unrealized P/L |
| -------------------- | ---- | -------- | ------------ | ------------ | ------ | ------------ | -------------- |
| Initial              | 1000 | 0        | —            | 0            | 1000   | 0            | 0              |
| Buy 2 at 200         | 600  | 2        | 200          | 400          | 1000   | 0            | 0              |
| Quote changes to 250 | 600  | 2        | 200          | 500          | 1100   | 0            | 100            |
| Sell 1 at 250        | 850  | 1        | 200          | 250          | 1100   | 50           | 50             |

Separately test weighted average cost: buy 10 at 200, buy 10 at 220 → average 210. Sell 5 at 230 → realized 100; remaining 15 at quote 240 → unrealized 450.
Use exact database decimal assertions for boundaries, including quantities at
eight-decimal precision. Small integer `Number` conversions below are only for
readable sample assertions, not a production money implementation.

## Sample frontend configuration and cases

Install reviewed compatible versions of Vitest, `@vitest/coverage-v8`, jsdom,
`@testing-library/react`, its `@testing-library/dom` peer, `@testing-library/jest-dom`, user-event, and MSW as web
dev dependencies. Use a separate test tsconfig including tests and Vitest types;
the current application tsconfig only includes `src`. Check runner engine and Vite
peer requirements before selecting versions: the current manifest permits Node
22.0 and Vite 6.2, which do not necessarily satisfy the latest Vitest requirements.
Keep Vitest and its coverage provider on matching versions.

`apps/web/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    environment: 'jsdom',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/{unit,components,integration}/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      reporter: ['text', 'lcov', 'json-summary'],
    },
  },
});
```

Setup imports `@testing-library/jest-dom/vitest`, runs RTL `cleanup` after each
test, resets mocks, and configures MSW to **error on unhandled requests**.
Create a fresh React Query client per render with retries disabled for failure
tests. Avoid network calls to real vendors.

Sample component test using the existing `OrderPanel`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { OrderPanel } from '../../src/trading/TradingComponents';

describe('order ticket', () => {
  it.each(['BUY', 'SELL'] as const)('reviews a valid %s order', async (side) => {
    const onReview = vi.fn();
    render(
      <MemoryRouter>
        <OrderPanel
          instrument={{ id: 'fixture-symbol', symbol: 'AAPL', exchange_code: 'NASDAQ' }}
          price={200}
          change={0}
          side={side}
          quantity="2"
          availableCash={1000}
          availableShares={5}
          balanceLoading={false}
          isAuthenticated
          submitting={false}
          onSideChange={vi.fn()}
          onQuantityChange={vi.fn()}
          onReview={onReview}
        />
      </MemoryRouter>,
    );
    await userEvent.click(
      screen.getByRole('button', { name: `Review ${side.toLowerCase()} order` }),
    );
    expect(onReview).toHaveBeenCalledTimes(1);
  });

  it('blocks review and explains insufficient balance', () => {
    const onReview = vi.fn();
    render(
      <MemoryRouter>
        <OrderPanel
          instrument={{ id: 'fixture-symbol', symbol: 'AAPL', exchange_code: 'NASDAQ' }}
          price={200}
          change={0}
          side="BUY"
          quantity="6"
          availableCash={1000}
          availableShares={0}
          balanceLoading={false}
          isAuthenticated
          submitting={false}
          onSideChange={vi.fn()}
          onQuantityChange={vi.fn()}
          onReview={onReview}
          validationError="Insufficient available balance for this order."
        />
      </MemoryRouter>,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Insufficient');
    expect(screen.getByRole('button', { name: 'Review buy order' })).toBeDisabled();
    expect(onReview).not.toHaveBeenCalled();
  });
});
```

The component accepts a precomputed `validationError`; this sample checks display
and blocking, not the calculation that produces that error. Cover quantity/balance
calculation at the page/hook layer and enforce it independently in backend tests.
Additional RTL cases: registration success message, generic login error, stale
quote label, empty portfolio/watchlist, failed watchlist mutation, paused alert,
AI unavailable/retry, and double-click protection during submission.

## Sample backend configuration and cases

Install reviewed Jest, `@jest/globals`, and Supertest versions as API dev
dependencies. This repository is ESM. One simple strategy is to compile API
TypeScript first and use `.test.mjs` files importing `dist`; it avoids a second
TypeScript transformer with different ESM semantics.

`apps/api/jest.config.mjs`:

```js
export default {
  testEnvironment: 'node',
  transform: {},
  setupFiles: ['<rootDir>/tests/jest/setup-env.mjs'],
  testMatch: ['<rootDir>/tests/jest/**/*.test.mjs'],
  collectCoverageFrom: ['dist/**/*.js'],
  coverageProvider: 'v8',
  coverageReporters: ['text', 'lcov', 'json-summary'],
  testTimeout: 30000,
  maxWorkers: 2,
};
```

Build shared types and API before Jest. Run from `apps/api`:

```sh
node --experimental-vm-modules ../../node_modules/jest/bin/jest.js --config jest.config.mjs
```

`setup-env.mjs` must set `NODE_ENV=test` and synthetic signing/configuration values
**before** importing `dist/app.js`, which reads configuration at module evaluation.
For integration suites, validate disposable URLs before opening any connection.
Run a separate production-mode security project to test Secure cookies and
Origin requirements; test-mode cookies cannot prove production cookie security.
[Jest ESM guidance](https://jestjs.io/docs/ecmascript-modules).

### Real-database fixture contract

The following integration sample requires implementing `helpers/fixture.mjs`
using the existing [HTTP integration fixture](../apps/api/tests/trading-http.test.ts).
The helper is **not an existing repository API**:

```text
createFixture({cash, price}) -> {
  app, pool, redis, symbolId, portfolioId, token, otherToken,
  capturedEmails,
  verifyRegisteredEmail(email), // redeem captured token through /auth/email/verify
  setQuote(price),              // insert a fresh deterministic SIMULATED quote
  snapshotFinancialState(),    // sorted wallet/position/order/trade/ledger rows
  close()                      // close clients and delete only this fixture's schema
}
```

Use Supertest against `createApp(pool, redis)`; do not mock PostgreSQL/Redis. Use
an isolated fake mail transport or ESM module mock for `sendAuthEmail` registered
**before** dynamically importing the app. Registration tests must exercise bcrypt
hashing and the actual verification endpoint.

Sample `tests/jest/integration/core-flows.test.mjs`:

```js
import { beforeEach, afterEach, it, expect } from '@jest/globals';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { createFixture } from '../helpers/fixture.mjs';

let f;
beforeEach(async () => {
  f = await createFixture({ cash: '1000', price: '200' });
});
afterEach(async () => {
  await f?.close();
});
const auth = () => ({ Authorization: `Bearer ${f.token}` });
const order = (side, quantity) => ({
  portfolioId: f.portfolioId,
  symbolId: f.symbolId,
  side,
  quantity,
  idempotencyKey: randomUUID(),
});

it('registers, verifies, and logs in without returning the password', async () => {
  const email = `${randomUUID()}@example.test`;
  const password = 'Synthetic-test-password-2026!';
  const registered = await request(f.app)
    .post('/api/v1/auth/register')
    .send({ email, password })
    .expect(202);
  expect(registered.body.data.developmentToken).toBeUndefined();
  const row = await f.pool.query('SELECT password_hash, status FROM users WHERE email=$1', [email]);
  expect(row.rows[0].password_hash).not.toBe(password);
  expect(row.rows[0].status).toBe('PENDING');
  await f.verifyRegisteredEmail(email);
  const login = await request(f.app)
    .post('/api/v1/auth/login')
    .send({ email, password })
    .expect(200);
  expect(login.body.data.accessToken).toEqual(expect.any(String));
  expect(login.body.data.refreshToken).toBeUndefined(); // web token is HttpOnly cookie
  expect(login.headers['set-cookie'].join(';')).toContain('HttpOnly');
});

it('requires authentication for portfolio access', async () => {
  await request(f.app).get('/api/v1/portfolio').expect(401);
  await request(f.app).get('/api/v1/portfolio').set(auth()).expect(200);
});

it('serves the fixture quote', async () => {
  const result = await request(f.app).get('/api/v1/market/quotes/AAPL').expect(200);
  expect(result.body.data.price).toBe('200.00000000'); // match actual numeric serialization
  expect(result.body.data.symbol).toBe('AAPL');
});

it('buys, sells, and reconciles portfolio values', async () => {
  await request(f.app).post('/api/v1/orders').set(auth()).send(order('BUY', '2')).expect(201);
  await f.setQuote('250');
  await request(f.app).post('/api/v1/orders').set(auth()).send(order('SELL', '1')).expect(201);
  const result = await request(f.app).get('/api/v1/portfolio').set(auth()).expect(200);
  const p = result.body.data.find((item) => item.portfolio_id === f.portfolioId);
  expect(Number(p.cash_balance)).toBe(850);
  expect(Number(p.market_value)).toBe(250);
  expect(Number(p.total_value)).toBe(1100);
  expect(Number(p.realized_pnl)).toBe(50);
  expect(Number(p.unrealized_pnl)).toBe(50);
});

it('rejects insufficient cash without writing financial state', async () => {
  const before = await f.snapshotFinancialState();
  const result = await request(f.app)
    .post('/api/v1/orders')
    .set(auth())
    .send(order('BUY', '6'))
    .expect(409);
  expect(result.body.error.code).toBe('INSUFFICIENT_VIRTUAL_CASH');
  expect(await f.snapshotFinancialState()).toEqual(before);
});

it('persists a watchlist and denies another owner', async () => {
  const created = await request(f.app)
    .post('/api/v1/watchlists')
    .set(auth())
    .send({ name: 'Learning' })
    .expect(201);
  const id = created.body.data.id;
  await request(f.app)
    .post(`/api/v1/watchlists/${id}/items`)
    .set(auth())
    .send({ symbolId: f.symbolId })
    .expect(201);
  await request(f.app)
    .delete(`/api/v1/watchlists/${id}`)
    .set('Authorization', `Bearer ${f.otherToken}`)
    .expect(404);
  const mine = await request(f.app).get('/api/v1/watchlists').set(auth()).expect(200);
  expect(mine.body.data.some((list) => list.id === id)).toBe(true);
});

it('creates and pauses an alert', async () => {
  const result = await request(f.app)
    .post('/api/v1/alerts')
    .set(auth())
    .send({
      symbolId: f.symbolId,
      condition: 'ABOVE',
      targetPrice: '210',
      currency: 'USD',
      channels: ['IN_APP'],
    })
    .expect(201);
  await request(f.app)
    .patch(`/api/v1/alerts/${result.body.data.id}`)
    .set(auth())
    .send({ status: 'PAUSED' })
    .expect(200);
});
```

The fixture must use AAPL as its synthetic symbol and return the same numeric
serialization as PostgreSQL. Confirm response field names against the current
contract before promoting these samples to CI. Alert lifecycle HTTP tests do not
replace worker integration tests: process matching, equality, paused, stale, and
duplicate quotes through `AlertEngine`, Redis Streams, and notification delivery.

### AI transport failures with Jest

This sample uses the existing injected transport and does not need the DB fixture:

```js
import { it, expect } from '@jest/globals';
import { ResearchAssistantService } from '../../../dist/services/research-assistant.service.js';

const input = { question: 'Explain AAPL risk', symbols: ['AAPL'], interval: '1d' };
it.each([
  [
    'network reset',
    async () => {
      throw new Error('synthetic transport failure');
    },
    503,
  ],
  [
    'timeout',
    async () => {
      throw new DOMException('test timeout', 'AbortError');
    },
    503,
  ],
  ['invalid JSON', async () => new Response('not-json'), 502],
  ['invalid schema', async () => Response.json({ ok: true, data: {} }), 502],
])('sanitizes %s', async (_name, transport, status) => {
  const service = new ResearchAssistantService('http://ai.test', transport);
  await expect(service.generate(input, 'Bearer synthetic-token')).rejects.toMatchObject({ status });
});
```

Also verify upstream 401/403/422/5xx mapping, redirects, oversized payloads, and
safe Retry-After behavior. Current Node generation maps upstream 429 to 503;
record the intended contract before asserting that 429 is preserved. Test true
timeout enforcement with a local delayed server as well as mocked AbortError.

## Sample Python endpoint-failure case

Use existing pytest and FastAPI TestClient. The following monkeypatch isolates
the HTTP provider-error contract; it deliberately replaces generation, so it
does not prove session validation or provider transport behavior:

```python
from fastapi.testclient import TestClient
from app.main import app
from app.api import assistant as assistant_routes
from app.models.research_llm import ResearchProviderError


def test_ai_provider_failure_returns_safe_503(monkeypatch):
    async def unavailable(*args, **kwargs):
        raise ResearchProviderError("AI research temporarily unavailable.", 503)

    monkeypatch.setattr(assistant_routes, "generate_research", unavailable)
    with TestClient(app) as client:
        response = client.post(
            "/research/assistant",
            headers={"Authorization": "Bearer synthetic-test-token"},
            json={"question": "Explain AAPL risk", "symbols": ["AAPL"]},
        )
    assert response.status_code == 503
    assert response.json()["ok"] is False
    assert response.headers["Retry-After"] == "30"
    assert "synthetic-test-token" not in response.text
```

Add separate tests where real `generate_research` calls a fake provider and
`BackendReader` uses `httpx.MockTransport`: 401 on revoked/foreign sessions;
authentication rechecked before sending evidence; provider exception/timeout;
malformed structured output; unknown citations; embeddings dimension mismatch;
RAG document-owner boundaries; PDF extraction limits; missing model/key; tracing
disabled; no credentials/identity in prompts. PostgreSQL tests use actual pgvector.
Do not assert exact natural-language LLM wording; assert schema, citation validity,
privacy, and safety properties. Real-provider canaries are separately scheduled,
budgeted, and excluded from PR tests.

## Sample Playwright configuration and E2E cases

Install reviewed `@playwright/test` and browser versions. The fixture in
`tests/e2e/fixtures.ts` must provision/reset each worker's full stack, seed only
synthetic data, and expose a quote-control channel unavailable in production.
Use distinct ports/Compose project names per worker, or initially use one worker.

```ts
// tests/e2e/playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list'], ['junit', { outputFile: '../../test-results/e2e.xml' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

Start the isolated stack and poll API/AI readiness before Playwright. Add a
`webServer` configuration only when its command owns all lifecycle/cleanup;
otherwise let the test-stack script own it. Do not reuse an arbitrary developer
server in CI. [Playwright server lifecycle guidance](https://playwright.dev/docs/test-webserver).

This browser sample requires the proposed fixture (not yet implemented):

```ts
import { test, expect } from './fixtures';

test('login, buy, and persist the new position', async ({ page, fixture }) => {
  // Fixture creates a verified synthetic user, cash 1000, AAPL quote 200.
  await page.goto('/login');
  await page.getByLabel('Email address').fill(fixture.email);
  await page.getByLabel('Password').fill(fixture.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/$/);
  await page.goto('/trading?symbol=AAPL');
  await page.getByLabel('Quantity', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Review buy order' }).click();
  const dialog = page.getByRole('dialog');
  const submitted = page.waitForResponse(
    (r) => r.url().endsWith('/api/v1/orders') && r.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Confirm buy', exact: true }).click();
  expect((await submitted).status()).toBe(201);
  await expect.poll(async () => (await fixture.readPortfolio()).cash).toBe('600');
  await page.reload();
  await expect.poll(async () => (await fixture.readPortfolio()).quantity).toBe('2');
});
```

Add a visible holdings/cash assertion using actual accessible UI labels so a
correct API response with a stale UI still fails. This sample's fixture database
assertions verify persistence, not complete UI rendering.

Required E2E journeys:

1. Register in browser, capture verification email, redeem it through the public
   API, then log in. The current frontend lacks a working verification/reset route;
   track full browser recovery as a feature gap, not a passing test.
2. Buy → quote update → sell → portfolio/history reconciliation after reload.
3. Attempt unaffordable buy/oversell → visible rejection and unchanged state.
4. Save watchlist → reload → remove symbol; repeat with a second user to prove isolation.
5. Create alert → publish a deterministic quote → await actual worker notification
   and authenticated WebSocket delivery; replay quote and assert exactly one notification.
6. Force vendor timeout through the external stub → AI error/retry UI; restore
   stub → successful structured report. Do not intercept the Node endpoint in this E2E.
7. Revoke/expire session → private HTTP and socket access denied; switch accounts
   and prove private React Query cache does not expose previous-user data.

Use role/label locators and auto-waiting assertions, not CSS coordinates or fixed
sleeps. Add Firefox/WebKit and mobile viewport jobs nightly; keep Chromium critical
journeys on every main build. Retry is diagnostic: report a test that passes only
on retry as flaky, and do not treat unexplained flakes as release evidence.

## Load and resilience strategy

Use dedicated staging-like infrastructure and synthetic users. Run smoke, normal
load, spike, soak, and contention profiles. Proposed starting targets below are
**acceptance goals to calibrate**, not measured application performance:

| Profile        | Starting workload                                          | Acceptance signal                                                        |
| -------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------ |
| Quote reads    | 5 requests/sec smoke; then 50/sec for 10 minutes           | p95 below 500 ms; unexpected failures below 1%                           |
| Trading        | 10 independent users; separate same-wallet race profile    | No negative cash/holdings; exactly one effect per idempotency key        |
| WebSockets     | 100/500/1000 staged concurrent sockets                     | Bounded memory/DB checks; authorized fanout; connection leases recovered |
| AI capacity    | Ramp to configured admitted concurrency                    | Predictable busy responses, bounded queue, provider budgets respected    |
| Soak           | 30–60 minutes at sustainable mixed load                    | No growing memory, connection, Redis-key, or queue leak                  |
| Fault recovery | Restart workers, interrupt Redis/AI transport, fail a task | Defined recovery time; no duplicate financial/notification side effects  |

Example `tests/load/quotes.js`:

```js
import http from 'k6/http';
import { check } from 'k6';

export const options = {
  scenarios: {
    quotes: {
      executor: 'constant-arrival-rate',
      rate: 5,
      timeUnit: '1s',
      duration: '1m',
      preAllocatedVUs: 5,
      maxVUs: 20,
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    dropped_iterations: ['count==0'],
  },
};

export default function () {
  if (!__ENV.BASE_URL) throw new Error('Set BASE_URL to the approved test target');
  const r = http.get(`${__ENV.BASE_URL}/api/v1/market/quotes/AAPL`);
  check(r, {
    'valid quote response': (response) => response.status === 200 && response.json('ok') === true,
  });
}
```

Public API rate limits are 300/minute per resolved client IP. The 5/sec smoke may
still encounter polling/other traffic in the same bucket; test limit behavior
separately. Larger capacity profiles require distributed synthetic client IPs or
a documented test-only configuration in an isolated deployment. Do not claim
throughput from requests rejected by an unintended shared rate-limit bucket.
Tag expected rejection traffic separately while still checking its status/body;
do not mask real 5xx failures as expected 429s. Record p50/p95/p99, dropped iterations,
DB lock waits, pool saturation, CPU/memory, Redis lag, fanout delay, and provider cost.
[k6 thresholds can enforce failures](https://grafana.com/docs/k6/latest/using-k6/thresholds/).

## Security regression and scanning

Map cases to the [security design review](./security-review.md). Tests for unresolved
findings should express desired secure behavior and are expected to fail until fixed;
do not write assertions that normalize the vulnerable behavior.

| Category                      | Automated checks                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Authentication/JWT            | Expiry, required claims, issuer/audience/algorithm, suspended user, refresh replay, absolute lifetime, MFA step-up                         |
| Authorization/BOLA            | Two-user tests for every object ID and list; foreign portfolio/document/session/watchlist/alert denied; admin-only mutation                |
| SQL injection/mass assignment | Injection strings in search/name fields remain data; extra role/userId/ownerId rejected; no schema or ownership changes                    |
| XSS/browser headers           | Malicious names/excerpts render as text; unsafe citation schemes excluded; HTML CSP/HSTS/frame policy verified through the proxy           |
| CSRF/CORS                     | Foreign/missing Origin web refresh rejected; production cookie flags; mobile refresh needs body token; no permissive credentialed wildcard |
| Rate limits/proxies           | Two clients receive separate quotas; prepended forwarded address cannot spoof identity; login/recovery limits, user AI budgets             |
| WebSockets                    | Invalid JWT/origin rejected; expiry/revocation disconnect; private room not caller-selectable; connection/event/message limits             |
| Secrets/logging               | No recovery secrets in logged URLs, request bodies, traces, or AI evidence; secret rotation rolls tasks; sanitized errors                  |
| Financial integrity           | Atomic ledger updates; replay/double-submit; competing buy/sell; audit insertion; runtime role cannot alter/truncate ledger/audit          |
| Infrastructure                | Terraform mocked guardrails; real restricted-role permissions; TLS wrong-CA/hostname rejection; private RDS/Redis; alarm delivery          |

Keep existing Trivy source/container scans and OIDC release validation. Add IaC
misconfiguration scanning with reviewed policies and expiring exceptions. Run ZAP
baseline on a disposable main build and authenticated active scans in isolated
staging nightly. Seed both user and admin contexts; active scans mutate state and
must not target production by default. Track findings by rule, endpoint, owner,
severity, and expiry rather than excluding every warning globally.

## CI execution and release gates

| Trigger              | Mandatory checks                                                                                                                         | Artifacts                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| PR                   | Lint/typecheck; Vitest/RTL; Jest units; real DB/Redis integration; pytest unit/pgvector; security negatives; Trivy; Terraform validation | JUnit, LCOV/coverage summary, sanitized security reports                     |
| Main                 | All PR gates; deterministic Chromium E2E through proxy; container health/startup tests; ZAP baseline                                     | Browser traces/screenshots on failure, E2E JUnit, immutable release manifest |
| Nightly              | Cross-browser E2E; deeper authenticated security scans; concurrency/chaos; load/soak; dependency checks                                  | Trends, k6 summary, security triage reports, flake report                    |
| Production promotion | Successful immutable Main release; current image rescan; known security blockers resolved/approved; staging smoke; deployment health     | Release identity, deployment result, health evidence                         |
| Post-deploy          | Read-only health/quote checks and dedicated synthetic authentication smoke                                                               | Sanitized smoke result and alert on failure                                  |

Do not parallelize tests that intentionally share wallet/session/Redis state except
inside a controlled concurrency test. Shard independent fixtures, not a single
stateful end-to-end journey. Collect results even on failure and avoid publishing
cookies, passwords, token-bearing URLs, or provider evidence in traces.

Suggested initial coverage gates: 80% statements and 75% branches overall, with
90% branches for changed financial/auth logic. Establish the baseline before
enforcing increases; coverage does not replace risk cases or concurrency tests.
Use mutation testing on financial/auth pure functions and require a test proving
each important invariant. All required integration projects must execute; document
optional-model skips and forbid blanket skip rules that make missing CI services green.

Suggested script names after installing/configuring the runners:

```text
test:web             npm exec --workspace @asteriq/web -- vitest run --config vitest.config.ts
test:api:unit        Jest unit project against compiled API
test:api:integration Jest integration/security projects with disposable services
test:python          pytest with JUnit and branch coverage
test:e2e             playwright test --config tests/e2e/playwright.config.ts
test:load            k6 run tests/load/quotes.js with approved BASE_URL
test:security        negative regressions + scans in an isolated target
```

Run Vitest from the web workspace (or set its root explicitly). Keep separate config/project names for
unit and integration execution and coverage merging. Python coverage additionally
requires `pytest-cov`; JUnit alone does not measure coverage.

## Implementation sequence and current gaps

1. Preserve existing tests and establish their coverage/test inventory. Install
   reviewed runners into the appropriate workspaces and update the lockfile.
2. Add isolated fixtures and fail-fast integration prerequisites. Port financial
   invariants/concurrency tests before deleting any legacy test.
3. Add RTL interaction tests and Jest/Supertest flows; build and typecheck test code.
4. Add full-stack Playwright fixtures, captured email, deterministic provider stub,
   proxy route, worker control, and artifact redaction.
5. Integrate required CI projects, then nightly load/security suites and trends.

Known gaps affecting the target suite: verification/reset browser routes are not
implemented; several security regressions intentionally expose current defects;
the Terraform AI-to-API authentication callback URL/SG route needs correction;
existing frontend server-rendered markup tests do not prove browser interactions;
integration tests currently skip when URLs are missing; optional Python dependencies
must be installed for the required suites. These are implementation work items,
not completed automation claimed by this document.

Reference runner setup against official documentation:
[Vitest](https://vitest.dev/guide/),
[React Testing Library](https://testing-library.com/docs/react-testing-library/intro/),
[Playwright](https://playwright.dev/docs/intro),
[Jest](https://jestjs.io/docs/getting-started),
[Supertest](https://github.com/ladjs/supertest),
[pytest](https://docs.pytest.org/en/stable/).
