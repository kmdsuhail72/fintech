import http from 'k6/http';
import execution from 'k6/execution';
import { SharedArray } from 'k6/data';
import { Counter, Rate, Trend } from 'k6/metrics';
import { setTimeout, setInterval, clearInterval, clearTimeout } from 'k6/timers';
import { marketStream } from './socketio.js';

const profile = __ENV.PROFILE || 'smoke';
if (!/^[A-Za-z0-9._-]{1,48}$/.test(__ENV.RUN_ID || ''))
  throw new Error('RUN_ID must be a short safe identifier');
const profiles = {
  smoke: {
    peak: 10,
    stages: [
      { duration: '30s', target: 10 },
      { duration: '5m', target: 10 },
      { duration: '30s', target: 0 },
    ],
  },
  baseline: {
    peak: 1000,
    stages: [
      { duration: '3m', target: 1000 },
      { duration: '10m', target: 1000 },
      { duration: '2m', target: 0 },
    ],
  },
  capacity: {
    peak: 10000,
    stages: [
      { duration: '2m', target: 50 },
      { duration: '3m', target: 500 },
      { duration: '5m', target: 2000 },
      { duration: '5m', target: 5000 },
      { duration: '10m', target: 10000 },
      { duration: '20m', target: 10000 },
      { duration: '5m', target: 0 },
    ],
  },
};
if (!profiles[profile]) throw new Error('PROFILE must be smoke, baseline, or capacity');
const baseURL = (__ENV.BASE_URL || '').replace(/\/$/, '');
if (!/^https?:\/\/[^/?#@]+$/.test(baseURL))
  throw new Error('BASE_URL must be a credential-free origin');
if (baseURL.replace(/^https?:\/\//, '') !== __ENV.APPROVED_TARGET_HOST)
  throw new Error('Set APPROVED_TARGET_HOST to the exact approved non-production target');
if (__ENV.AI_STUB_CONFIRMED !== 'true')
  throw new Error('Configure and confirm a deterministic AI provider stub before running');
if (!__ENV.USERS_FILE) throw new Error('Set USERS_FILE to a private synthetic session dataset');
const users = new SharedArray('isolated users', () => JSON.parse(open(__ENV.USERS_FILE)));
if (users.length < profiles[profile].peak)
  throw new Error('Dataset must contain one unique identity per peak VU');
const identities = new Set();
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
for (let index = 0; index < profiles[profile].peak; index++) {
  const record = users[index];
  if (
    !uuid.test(record.userId || '') ||
    !uuid.test(record.portfolioId || '') ||
    !uuid.test(record.symbolId || '') ||
    identities.has(record.userId)
  ) {
    throw new Error('Each VU needs a unique userId and valid portfolio/symbol UUIDs');
  }
  identities.add(record.userId);
}

const appRequests = new Counter('app_requests');
const appErrors = new Rate('app_error_percentage');
const latency = new Trend('app_latency', true);
const skipped = new Counter('scheduled_actions_skipped');
const scenarioErrors = new Counter('scenario_errors');
const tradeSuccess = new Counter('trade_successes');
const sockets = {
  opened: new Counter('socketio_opened'),
  closed: new Counter('socketio_closed'),
  errors: new Counter('socketio_errors'),
  messages: new Counter('market_messages'),
  lag: new Trend('market_quote_lag', true),
  stale: new Counter('market_stream_stale'),
  clockSkew: new Counter('market_clock_skew'),
};

export const options = {
  scenarios: {
    users: {
      executor: 'ramping-vus',
      exec: 'virtualUser',
      startVUs: 1,
      stages: profiles[profile].stages,
      gracefulRampDown: '7m',
      gracefulStop: '7m',
    },
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(95)', 'p(99)', 'max'],
  thresholds: {
    app_error_percentage: ['rate<0.01'],
    'app_error_percentage{operation:portfolio}': ['rate<0.01'],
    'app_error_percentage{operation:quotes}': ['rate<0.01'],
    'app_error_percentage{operation:trade}': ['rate<0.01'],
    'app_error_percentage{operation:research}': ['rate<0.01'],
    'app_latency{operation:portfolio}': ['p(95)<500', 'p(99)<1000'],
    'app_latency{operation:quotes}': ['p(95)<300', 'p(99)<750'],
    'app_latency{operation:trade}': ['p(95)<1000', 'p(99)<2000'],
    'app_latency{operation:research}': ['p(95)<10000', 'p(99)<20000'],
    socketio_errors: ['count==0'],
    market_stream_stale: ['count==0'],
    market_quote_lag: ['p(95)<1000', 'p(99)<2000'],
    market_messages: ['count>0'],
    scheduled_actions_skipped: ['count==0'],
    scenario_errors: ['count==0'],
    market_clock_skew: ['count==0'],
  },
};

// State is private to each VU. Global idInTest works with execution segmentation.
let state;
function identity() {
  if (!state) {
    const index = execution.vu.idInTest - 1;
    const record = users[index];
    if (
      !record?.accessToken ||
      !record.refreshToken ||
      !record.portfolioId ||
      !record.symbolId ||
      !Number.isFinite(record.expiresAtMs)
    ) {
      throw new Error(
        'Dataset needs accessToken, refreshToken, expiresAtMs, portfolioId, and symbolId',
      );
    }
    state = {
      ...record,
      index,
      pending: new Set(),
      nextDue: {},
      tradeSide: 'BUY',
      tradeSequence: 0,
    };
  }
  return state;
}

async function request(operation, method, path, body) {
  const current = identity();
  const result = await http.asyncRequest(
    method,
    baseURL + '/api/v1' + path,
    body === undefined ? null : JSON.stringify(body),
    {
      headers: {
        Authorization: `Bearer ${current.accessToken}`,
        'Content-Type': 'application/json',
        'x-client-type': 'mobile',
        Origin: baseURL,
      },
      tags: { name: operation, operation },
      timeout: operation === 'research' ? '110s' : '15s',
    },
  );
  let payload;
  try {
    payload = result.json();
  } catch {
    payload = null;
  }
  const data = payload?.data;
  let valid = payload?.ok === true && data !== undefined && data !== null;
  if (operation === 'portfolio')
    valid =
      valid &&
      Array.isArray(data) &&
      data.length === 1 &&
      data[0].portfolio_id === current.portfolioId;
  if (operation === 'quotes')
    valid =
      valid &&
      data.symbol === (current.symbol || 'AAPL') &&
      Number.isFinite(Number(data.price)) &&
      Number(data.price) > 0;
  if (operation === 'trade')
    valid = valid && data.status === 'FILLED' && typeof data.id === 'string';
  if (operation === 'research')
    valid =
      valid &&
      data.ai_generated === true &&
      Array.isArray(data.sources) &&
      [
        'summary',
        'market_context',
        'technical_analysis',
        'news_sentiment',
        'potential_risks',
        'potential_opportunities',
        'educational_conclusion',
      ].every(
        (section) => typeof data[section]?.content === 'string' && data[section].content.length > 0,
      );
  if (operation === 'refresh')
    valid =
      valid &&
      typeof data.accessToken === 'string' &&
      typeof data.refreshToken === 'string' &&
      Number(data.accessTokenExpiresIn) > 0;
  appRequests.add(1, { operation });
  appErrors.add(result.status < 200 || result.status >= 300 || !valid, { operation });
  latency.add(result.timings.duration, { operation });
  return { result, payload };
}

async function ensureSession() {
  const current = identity();
  if (Date.now() < current.expiresAtMs - 60_000) return;
  // Only one refresh may run per VU: concurrent replay revokes the session.
  if (!current.refreshPromise) {
    current.refreshPromise = (async () => {
      const { result, payload } = await request('refresh', 'POST', '/auth/refresh', {
        refreshToken: current.refreshToken,
      });
      if (result.status !== 200 || !payload?.data?.refreshToken)
        throw new Error('Synthetic session refresh failed');
      current.accessToken = payload.data.accessToken;
      current.refreshToken = payload.data.refreshToken;
      current.expiresAtMs = Date.now() + payload.data.accessTokenExpiresIn * 1000;
      current.socket?.close();
      current.socket = current.streaming
        ? marketStream(
            baseURL,
            current.accessToken,
            current.symbolIds || [current.symbolId],
            sockets,
          )
        : null;
    })().finally(() => {
      current.refreshPromise = null;
    });
  }
  await current.refreshPromise;
}

async function trade() {
  const current = identity();
  if (!current.pendingTrade)
    current.pendingTrade = {
      portfolioId: current.portfolioId,
      symbolId: current.symbolId,
      side: current.tradeSide,
      quantity: '0.01',
      idempotencyKey: `load-${__ENV.RUN_ID}-${execution.vu.idInTest}-${++current.tradeSequence}`,
    };
  const { result, payload } = await request('trade', 'POST', '/orders', current.pendingTrade);
  if (result.status === 201 && payload?.data?.status === 'FILLED') {
    tradeSuccess.add(1);
    current.tradeSide = current.tradeSide === 'BUY' ? 'SELL' : 'BUY';
    current.pendingTrade = null;
  }
  // Ambiguous failures retain the same idempotency key for the next attempt.
}

export async function virtualUser() {
  scenarioErrors.add(0);
  skipped.add(0);
  sockets.errors.add(0);
  sockets.stale.add(0);
  sockets.clockSkew.add(0);
  const current = identity();
  const index = current.index;
  current.streaming = index % 10 < 6; // 60% = 6,000 streams at full capacity.
  await ensureSession();
  current.socket = current.streaming
    ? marketStream(baseURL, current.accessToken, current.symbolIds || [current.symbolId], sockets)
    : null;
  const intervals = [],
    starts = [];
  const active = new Set();
  function schedule(name, seconds, action) {
    const fire = () => {
      current.nextDue[name] = Date.now() + seconds * 1000;
      if (active.has(name)) {
        skipped.add(1, { operation: name });
        return;
      }
      active.add(name);
      const promise = (async () => {
        await ensureSession();
        await action();
      })()
        .catch(() => {
          scenarioErrors.add(1, { operation: name });
        })
        .finally(() => {
          active.delete(name);
          current.pending.delete(promise);
        });
      current.pending.add(promise);
    };
    // Deterministic jitter avoids synchronized timer waves.
    const phase = ((index * 2654435761) >>> 0) % (seconds * 1000);
    const delay = Math.max(0, (current.nextDue[name] ?? Date.now() + phase) - Date.now());
    starts.push(
      setTimeout(() => {
        fire();
        intervals.push(setInterval(fire, seconds * 1000));
      }, delay),
    );
  }
  schedule('portfolio', 60, () => request('portfolio', 'GET', '/portfolio'));
  if (index % 10 === 0)
    schedule('quotes', 10, () =>
      request('quotes', 'GET', `/market/quotes/${current.symbol || 'AAPL'}`),
    );
  if (index % 10 < 2) schedule('trade', 120, trade);
  if (index % 100 === 0)
    schedule('research', 300, () =>
      request('research', 'POST', '/ai/research/assistant', {
        question: 'Explain the educational risks of AAPL.',
        symbols: ['AAPL'],
        interval: '1d',
        include_portfolio: false,
      }),
    );
  try {
    await new Promise((resolve) => setTimeout(resolve, 240_000));
  } finally {
    for (const timer of starts) clearTimeout(timer);
    for (const timer of intervals) clearInterval(timer);
    current.streaming = false;
    current.socket?.close();
    await Promise.all([...current.pending].map((promise) => promise.catch(() => {})));
    current.socket?.close();
    current.socket = null;
  }
}

export function handleSummary(data) {
  return {
    'test-results/load-summary.json': JSON.stringify(
      { profile, peakUsers: profiles[profile].peak, ...data },
      null,
      2,
    ),
  };
}
