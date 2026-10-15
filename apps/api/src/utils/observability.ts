import { SpanKind } from '@opentelemetry/api';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomBytes, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { prometheusEvent } from './prometheus.js';
import { currentTrace, injectTrace, traceOperation } from './tracing.js';

export type TraceContext = {
  requestId: string;
  traceId: string;
  spanId: string;
  traceparent: string;
};
export const traceContext = new AsyncLocalStorage<TraceContext>();
export const NAMESPACE = 'Asteriq/Application';
type Metric = { value: number; unit: 'Count' | 'Milliseconds' | 'None' };
export type Metrics = Record<string, Metric>;

export function createTraceContext(parent?: string): TraceContext {
  const active = currentTrace();
  if (active)
    return {
      requestId: randomUUID(),
      traceId: active.traceId,
      spanId: active.spanId,
      traceparent: `00-${active.traceId}-${active.spanId}-${active.traceFlags & 1 ? '01' : '00'}`,
    };
  const match = /^00-([0-9a-f]{32})-([0-9a-f]{16})-(0[01])$/.exec(parent ?? '');
  const valid = match && match[1] !== '0'.repeat(32) && match[2] !== '0'.repeat(16);
  const traceId = valid ? match[1]! : randomBytes(16).toString('hex');
  const spanId = randomBytes(8).toString('hex');
  const flags = valid ? match[3]! : '00'; // Correlation only; no sampling/export claim.
  return {
    requestId: randomUUID(),
    traceId,
    spanId,
    traceparent: `00-${traceId}-${spanId}-${flags}`,
  };
}

export function traceHeaders(): Record<string, string> {
  const context = traceContext.getStore();
  if (currentTrace())
    return { ...injectTrace(), ...(context ? { 'X-Request-Id': context.requestId } : {}) };
  return context ? { traceparent: context.traceparent, 'X-Request-Id': context.requestId } : {};
}

export function metricDocument(metrics: Metrics, operation = 'runtime') {
  const entries = Object.entries(metrics).filter(([, metric]) => Number.isFinite(metric.value));
  if (entries.length === 0) throw new Error('No finite metric values');
  return {
    _aws: {
      Timestamp: Date.now(),
      CloudWatchMetrics: [
        {
          Namespace: NAMESPACE,
          Dimensions: [
            ['Environment', 'Service'],
            ['Environment', 'Service', 'Operation'],
          ],
          Metrics: entries.map(([Name, metric]) => ({ Name, Unit: metric.unit })),
        },
      ],
    },
    Environment: process.env.ASTERIQ_ENVIRONMENT ?? 'local',
    Service: 'api',
    Operation: operation,
    ...Object.fromEntries(entries.map(([name, metric]) => [name, metric.value])),
    timestamp: new Date().toISOString(),
    level: 'info',
    message: 'application_metrics',
    ...traceContext.getStore(),
  };
}

export function emitMetrics(metrics: Metrics, operation = 'runtime') {
  for (const [name, metric] of Object.entries(metrics)) prometheusEvent(name, metric.value);
  if (process.env.OBSERVABILITY_ENABLED !== 'true') return;
  // EMF goes through awslogs; telemetry must never change transaction outcomes.
  try {
    console.log(JSON.stringify(metricDocument(metrics, operation)));
  } catch {
    /* best effort */
  }
}

export async function observeAiCall<T>(operation: () => Promise<T>): Promise<T> {
  return traceOperation(
    'ai.request',
    { 'peer.service': 'ai-service' },
    async () => {
      const parent = traceContext.getStore();
      const child = createTraceContext(parent?.traceparent);
      if (parent) child.requestId = parent.requestId;
      return traceContext.run(child, async () => {
        const started = performance.now();
        let failed = false;
        try {
          return await operation();
        } catch (error) {
          failed = true;
          throw error;
        } finally {
          emitMetrics(
            {
              AIServiceRequests: { value: 1, unit: 'Count' },
              AIServiceFailures: { value: Number(failed), unit: 'Count' },
              AIServiceLatency: { value: performance.now() - started, unit: 'Milliseconds' },
            },
            'research',
          );
        }
      });
    },
    SpanKind.CLIENT,
  );
}
