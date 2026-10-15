import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import type { Pool } from 'pg';
import { InMemorySpanExporter } from '@opentelemetry/sdk-trace-node';
import { SpanKind } from '@opentelemetry/api';
import {
  initTracing,
  flushTracing,
  incomingContext,
  startOperation,
  instrumentRedis,
  shutdownTracing,
} from '../src/utils/tracing.js';
import { instrumentDatabase } from '../src/utils/prometheus.js';
import { createTraceContext, observeAiCall, traceHeaders } from '../src/utils/observability.js';
import { normalizeBrowserTraces } from '../src/routes/telemetry.js';

test('HTTP, Redis, PostgreSQL and AI share a propagated trace without arguments or SQL', async () => {
  const exporter = new InMemorySpanExporter();
  initTracing(exporter);
  const id = 'a'.repeat(32);
  const request = startOperation(
    'http.server',
    {},
    SpanKind.SERVER,
    incomingContext(`00-${id}-${'b'.repeat(16)}-01`, 'asteriq=test'),
  );
  const pool = new EventEmitter();
  instrumentDatabase(pool as unknown as Pool);
  const client = { query: async (_sql: string) => ({ rows: [1] }) };
  pool.emit('connect', client);
  const redis = instrumentRedis({ get: async (_key: string) => 'private-value' });
  await request.run(async () => {
    assert.equal(createTraceContext().traceId, id);
    await redis.get('private-session-key');
    await client.query('SELECT private_financial_value');
    await observeAiCall(async () => {
      assert.ok(traceHeaders().traceparent?.startsWith('00-' + id + '-'));
      assert.equal(traceHeaders().tracestate, 'asteriq=test');
    });
  });
  request.finish();
  await flushTracing();
  const spans = exporter.getFinishedSpans();
  assert.ok(spans.some((span) => span.name === 'redis.operation'));
  assert.ok(spans.some((span) => span.name === 'postgresql.query'));
  assert.ok(spans.some((span) => span.name === 'ai.request'));
  assert.ok(spans.every((span) => span.spanContext().traceId === id));
  const server = spans.find((span) => span.name === 'http.server')!;
  assert.equal(server.parentSpanContext?.spanId, 'b'.repeat(16));
  for (const child of spans.filter((span) => span !== server)) {
    assert.equal(child.parentSpanContext?.spanId, server.spanContext().spanId);
    assert.equal(child.spanContext().traceState?.serialize(), 'asteriq=test');
  }
  const exported = JSON.stringify(spans.map(span => ({ name: span.name, attributes: span.attributes, events: span.events })));
  assert.ok(!exported.includes('private-session-key') && !exported.includes('private_financial_value'));
  await shutdownTracing();
});

test('browser trace proxy bounds batches and removes forged service/payload attributes', () => {
  const payload = {
    resourceSpans: [
      {
        resource: { attributes: [{ key: 'service.name', value: { stringValue: 'forged-api' } }] },
        scopeSpans: [
          {
            spans: [
              {
                traceId: 'a'.repeat(32),
                spanId: 'b'.repeat(16),
                name: 'private-user-prompt',
                startTimeUnixNano: '1000',
                endTimeUnixNano: '2000',
                attributes: [{ key: 'secret', value: { stringValue: 'private-password' } }],
                events: [{ name: 'private-exception' }],
              },
            ],
          },
        ],
      },
    ],
  };
  const result = normalizeBrowserTraces(payload);
  const text = JSON.stringify(result);
  assert.ok(text.includes('asteriq-web'));
  assert.ok(!text.includes('private-') && !text.includes('forged-api'));
  payload.resourceSpans[0]!.scopeSpans[0]!.spans = Array(33).fill(
    payload.resourceSpans[0]!.scopeSpans[0]!.spans[0],
  );
  assert.throws(() => normalizeBrowserTraces(payload));
});
