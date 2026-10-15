import {
  context,
  createContextKey,
  propagation,
  ROOT_CONTEXT,
  SpanKind,
  SpanStatusCode,
  trace,
  type Attributes,
} from '@opentelemetry/api';
import {
  NodeTracerProvider,
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { W3CTraceContextPropagator } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';

let provider: NodeTracerProvider | undefined;
const suppressed = createContextKey('asteriq.suppress-tracing');
export function initTracing(exporter?: SpanExporter) {
  if (provider || (!exporter && process.env.OTEL_ENABLED !== 'true')) return;
  const requested = Number(process.env.OTEL_TRACE_SAMPLE_RATIO ?? '0.1');
  const ratio = Number.isFinite(requested) ? Math.max(0, Math.min(1, requested)) : 0.1;
  provider = new NodeTracerProvider({
    resource: resourceFromAttributes({
      'service.name': 'asteriq-api',
      'deployment.environment.name': process.env.ASTERIQ_ENVIRONMENT ?? 'local',
    }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(exporter ? 1 : ratio) }),
    spanProcessors: [
      new BatchSpanProcessor(
        exporter ??
          new OTLPTraceExporter({
            ...(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
              ? { url: process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT }
              : {}),
            timeoutMillis: 3000,
          }),
        {
          maxQueueSize: 1024,
          maxExportBatchSize: 128,
          scheduledDelayMillis: 2000,
          exportTimeoutMillis: 3000,
        },
      ),
    ],
  });
  provider.register({ propagator: new W3CTraceContextPropagator() });
}
export async function shutdownTracing() {
  await provider?.shutdown();
}
export async function flushTracing() {
  await provider?.forceFlush();
}
export function tracingActive() {
  return !!provider && !context.active().getValue(suppressed);
}
export function withoutTracing<T>(fn: () => T): T {
  return context.with(context.active().setValue(suppressed, true), fn);
}
export function currentTrace() {
  const span = trace.getSpan(context.active())?.spanContext();
  return span && span.traceId !== '0'.repeat(32) ? span : undefined;
}
export function injectTrace(): Record<string, string> {
  const headers: Record<string, string> = {};
  if (currentTrace()) propagation.inject(context.active(), headers);
  return headers;
}
export function incomingContext(traceparent?: string, tracestate?: string) {
  return propagation.extract(ROOT_CONTEXT, {
    ...(traceparent ? { traceparent } : {}),
    ...(tracestate ? { tracestate } : {}),
  });
}
export function startOperation(
  name: string,
  attributes: Attributes = {},
  kind = SpanKind.INTERNAL,
  parent = context.active(),
) {
  const span = tracingActive()
    ? trace.getTracer('asteriq-api').startSpan(name, { attributes, kind }, parent)
    : undefined;
  const active = span ? trace.setSpan(parent, span) : parent;
  let finished = false;
  return {
    span,
    run<T>(fn: () => T): T {
      return context.with(active, fn);
    },
    finish(error?: unknown) {
      if (finished) return;
      finished = true;
      if (error) span?.setStatus({ code: SpanStatusCode.ERROR });
      span?.end();
    },
  };
}
export function traceOperation<T>(
  name: string,
  attributes: Attributes,
  fn: () => T,
  kind = SpanKind.INTERNAL,
): T {
  const operation = startOperation(name, attributes, kind);
  try {
    const result = operation.run(fn);
    if (result instanceof Promise)
      return result.then(
        (value) => {
          operation.finish();
          return value;
        },
        (error) => {
          operation.finish(true);
          throw error;
        },
      ) as T;
    operation.finish();
    return result;
  } catch (error) {
    operation.finish(true);
    throw error;
  }
}
export function instrumentRedis<T extends object>(client: T): T {
  const ignored = new Set([
    'on',
    'once',
    'off',
    'emit',
    'addListener',
    'removeListener',
    'removeAllListeners',
    'listeners',
  ]);
  const cache = new Map<PropertyKey, unknown>();
  let proxy: T;
  proxy = new Proxy(client, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (property === 'constructor') return value;
      if (typeof value !== 'function') return value;
      if (!cache.has(property))
        cache.set(property, (...args: unknown[]) => {
          if (property === 'duplicate')
            return instrumentRedis(Reflect.apply(value, target, args) as object);
          if (property === 'multi') {
            const multi = Reflect.apply(value, target, args) as object;
            let chain: object;
            chain = new Proxy(multi, {
              get(inner, key) {
                const method: unknown = Reflect.get(inner, key, inner);
                if (typeof method !== 'function') return method;
                return (...values: unknown[]) => {
                  const call = () => Reflect.apply(method, inner, values) as unknown;
                  const result =
                    key === 'exec'
                      ? traceOperation(
                          'redis.transaction',
                          { 'db.system.name': 'redis', 'db.operation.name': 'EXEC' },
                          call,
                          SpanKind.CLIENT,
                        )
                      : call();
                  return result === inner ? chain : result;
                };
              },
            });
            return chain;
          }
          const call = () => Reflect.apply(value, target, args) as unknown;
          const result = ignored.has(String(property))
            ? call()
            : traceOperation(
                'redis.operation',
                { 'db.system.name': 'redis', 'db.operation.name': String(property).slice(0, 40) },
                call,
                SpanKind.CLIENT,
              );
          return result === target ? proxy : result;
        });
      return cache.get(property);
    },
  });
  return proxy;
}
