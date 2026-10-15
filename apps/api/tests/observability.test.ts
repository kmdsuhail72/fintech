import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import {
  createTraceContext,
  traceContext,
  traceHeaders,
  metricDocument,
  observeAiCall,
} from '../src/utils/observability.js';
import { observeHttp } from '../src/middleware/observability.js';
import { logger, userSafeIdentifier } from '../src/utils/logger.js';
import type { Pool } from 'pg';
import { TradingRepository } from '../src/repositories/domain.repositories.js';

test('valid trace parents correlate; malformed/zero IDs are replaced', () => {
  const parent = '00-' + 'a'.repeat(32) + '-' + 'b'.repeat(16) + '-01';
  const child = createTraceContext(parent);
  assert.equal(child.traceId, 'a'.repeat(32));
  assert.notEqual(child.spanId, 'b'.repeat(16));
  for (const invalid of ['invalid\nheader', `00-${'0'.repeat(32)}-${'b'.repeat(16)}-01`]) {
    assert.match(createTraceContext(invalid).traceparent, /^00-[a-f0-9]{32}-[a-f0-9]{16}-00$/);
    assert.notEqual(createTraceContext(invalid).traceId, '0'.repeat(32));
  }
});

test('concurrent asynchronous requests do not share trace context', async () => {
  const contexts = [createTraceContext(), createTraceContext()];
  await Promise.all(
    contexts.map((context) =>
      traceContext.run(context, async () => {
        await Promise.resolve();
        assert.equal(traceHeaders().traceparent, context.traceparent);
      }),
    ),
  );
  assert.deepEqual(traceHeaders(), {});
});

test('EMF uses bounded dimensions and discards nonfinite metric values', () => {
  const context = createTraceContext();
  const doc = traceContext.run(context, () =>
    metricDocument(
      {
        RequestCount: { value: 1, unit: 'Count' },
        Bad: { value: NaN, unit: 'None' },
      },
      'core',
    ),
  );
  assert.equal(doc.traceId, context.traceId);
  assert.deepEqual(doc._aws.CloudWatchMetrics[0]!.Dimensions, [
    ['Environment', 'Service'],
    ['Environment', 'Service', 'Operation'],
  ]);
  assert.deepEqual(doc._aws.CloudWatchMetrics[0]!.Metrics, [
    { Name: 'RequestCount', Unit: 'Count' },
  ]);
  assert.throws(() => metricDocument({ Bad: { value: Infinity, unit: 'None' } }));
});

test('AI transport failures retain their error and emit correlated failure metrics', async () => {
  const originalLog = console.log;
  const previous = process.env.OBSERVABILITY_ENABLED;
  const lines: string[] = [];
  console.log = (line) => {
    lines.push(String(line));
  };
  process.env.OBSERVABILITY_ENABLED = 'true';
  const parent = createTraceContext();
  const error = new Error('synthetic failure');
  try {
    await assert.rejects(
      traceContext.run(parent, () =>
        observeAiCall(async () => {
          assert.equal(traceContext.getStore()?.traceId, parent.traceId);
          assert.notEqual(traceContext.getStore()?.spanId, parent.spanId);
          throw error;
        }),
      ),
      (actual) => actual === error,
    );
    const event = JSON.parse(lines[0]!);
    assert.equal(event.AIServiceFailures, 1);
    assert.equal(event.traceId, parent.traceId);
    assert.equal(event.requestId, parent.requestId);
  } finally {
    console.log = originalLog;
    if (previous === undefined) delete process.env.OBSERVABILITY_ENABLED;
    else process.env.OBSERVABILITY_ENABLED = previous;
  }
});

test('HTTP instrumentation counts failures/aborts once and excludes health from SLOs', () => {
  const originalLog = console.log;
  const previous = process.env.OBSERVABILITY_ENABLED;
  const lines: string[] = [];
  console.log = (line) => {
    lines.push(String(line));
  };
  process.env.OBSERVABILITY_ENABLED = 'true';
  try {
    for (const [path, status, aborted] of [
      ['/api/v1/orders', 503, false],
      ['/api/v1/ready', 503, false],
      ['/api/v1/orders', 200, true],
    ] as const) {
      const response = new EventEmitter() as EventEmitter & {
        statusCode: number;
        writableFinished: boolean;
        setHeader: () => void;
      };
      Object.assign(response, {
        statusCode: status,
        writableFinished: !aborted,
        setHeader: () => {},
      });
      const request = {
        path,
        method: 'GET',
        header: () => undefined,
        route: { path: '/orders' },
      } as unknown as Request;
      observeHttp(request, response as unknown as Response, () => {});
      response.emit(aborted ? 'close' : 'finish');
      response.emit('close');
    }
    const metrics = lines.map((line) => JSON.parse(line)).filter((event) => event._aws);
    assert.equal(metrics.length, 3);
    assert.equal(metrics[0].HTTP5xx, 1);
    assert.equal(metrics[0].SloErrors, 1);
    assert.equal(metrics[1].SloRequests, 0);
    assert.equal(metrics[2].AbortedRequests, 1);
    assert.equal(metrics[2].SloErrors, 1);
  } finally {
    console.log = originalLog;
    if (previous === undefined) delete process.env.OBSERVABILITY_ENABLED;
    else process.env.OBSERVABILITY_ENABLED = previous;
  }
});

test('structured logs redact secret fields and credential-bearing URLs', () => {
  const original = console.error;
  let line = '';
  console.error = (value) => {
    line = String(value);
  };
  try {
    logger.error('failure', {
      token: 'do-not-log',
      error: 'postgresql://user:password@db/test Bearer abcdef',
    });
    assert.doesNotMatch(line, /do-not-log|password@|abcdef/);
    assert.equal(JSON.parse(line).token, '[REDACTED]');
  } finally {
    console.error = original;
  }
});

test('structured logging schema uses trace aliases and keyed user pseudonyms', () => {
  const original = console.info;
  const previous = process.env.LOG_USER_HASH_KEY;
  let line = '';
  console.info = (value) => {
    line = String(value);
  };
  try {
    delete process.env.LOG_USER_HASH_KEY;
    assert.equal(userSafeIdentifier('private-user'), null);
    process.env.LOG_USER_HASH_KEY = 'test-only-log-key-at-least-32-characters';
    const identifier = userSafeIdentifier('private-user');
    assert.match(identifier!, /^[a-f0-9]{24}$/);
    traceContext.run(createTraceContext(), () =>
      logger.info('HTTP request completed', {
        endpoint: '/orders/:orderId',
        status_code: 500,
        user_safe_identifier: identifier,
      }),
    );
    const entry = JSON.parse(line);
    for (const key of [
      'timestamp',
      'service',
      'environment',
      'namespace',
      'pod',
      'level',
      'request_id',
      'trace_id',
      'user_safe_identifier',
      'endpoint',
      'status_code',
    ]) {
      assert.ok(key in entry);
    }
    assert.equal(entry.request_id, entry.requestId);
    assert.equal(entry.trace_id, entry.traceId);
    assert.ok(!line.includes('private-user'));
  } finally {
    console.info = original;
    if (previous === undefined) delete process.env.LOG_USER_HASH_KEY;
    else process.env.LOG_USER_HASH_KEY = previous;
  }
});

test('idempotent trade replay does not increment trades; failed commit emits nothing', async () => {
  const original = console.log;
  const previous = process.env.OBSERVABILITY_ENABLED;
  const lines: string[] = [];
  console.log = (line) => {
    lines.push(String(line));
  };
  process.env.OBSERVABILITY_ENABLED = 'true';
  const pool = (failCommit: boolean) =>
    ({
      async connect() {
        return {
          release() {},
          async query(sql: string) {
            if (sql === 'COMMIT' && failCommit) throw new Error('synthetic commit failure');
            if (sql.includes('FROM accounts')) return { rows: [{ id: 'account' }], rowCount: 1 };
            if (sql.includes('FROM orders'))
              return { rows: [{ id: 'existing-order', same_request: true }], rowCount: 1 };
            return { rows: [], rowCount: 0 };
          },
        };
      },
    }) as unknown as Pool;
  const input = {
    symbolId: 'fixture',
    side: 'BUY' as const,
    quantity: '1',
    idempotencyKey: 'test-replay-key',
  };
  try {
    const result = await new TradingRepository(pool(false)).createMarketOrder('user', input);
    assert.equal(result.id, 'existing-order');
    assert.equal(JSON.parse(lines[0]!).TradesExecuted, 0);
    lines.length = 0;
    await assert.rejects(
      new TradingRepository(pool(true)).createMarketOrder('user', input),
      /commit failure/,
    );
    assert.equal(lines.length, 0);
  } finally {
    console.log = original;
    if (previous === undefined) delete process.env.OBSERVABILITY_ENABLED;
    else process.env.OBSERVABILITY_ENABLED = previous;
  }
});
