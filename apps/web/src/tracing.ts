import { context, propagation, SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import {
  WebTracerProvider,
  BatchSpanProcessor,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
  type SpanExporter,
} from '@opentelemetry/sdk-trace-web';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { W3CTraceContextPropagator, ExportResultCode } from '@opentelemetry/core';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { getAccessToken } from './authToken.js';

let initialized = false;
export function initWebTracing() {
  if (initialized || import.meta.env?.VITE_TRACING_ENABLED !== 'true') return;
  initialized = true;
  const api = new URL(
    import.meta.env?.VITE_API_URL ?? 'http://localhost:3000/api/v1',
    location.origin,
  );
  const endpoint = new URL(api.pathname.replace(/\/$/, '') + '/telemetry/traces', api.origin).href;
  const exporter: SpanExporter = {
    export(spans, callback) {
      const token = getAccessToken();
      if (!token) {
        callback({ code: ExportResultCode.SUCCESS });
        return;
      }
      const sender = new OTLPTraceExporter({
        url: endpoint,
        headers: { Authorization: 'Bearer ' + token },
        timeoutMillis: 3000,
      });
      sender.export(spans, (result) => {
        callback(result);
        void sender.shutdown().catch(() => {});
      });
    },
    shutdown: async () => {},
  };
  const provider = new WebTracerProvider({
    resource: resourceFromAttributes({ 'service.name': 'asteriq-web' }),
    sampler: new ParentBasedSampler({ root: new TraceIdRatioBasedSampler(0.1) }),
    spanProcessors: [
      new BatchSpanProcessor(exporter, {
        maxQueueSize: 128,
        maxExportBatchSize: 32,
        scheduledDelayMillis: 5000,
        exportTimeoutMillis: 3000,
      }),
    ],
  });
  provider.register({ propagator: new W3CTraceContextPropagator() });
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    let url: URL;
    try {
      url = new URL(input instanceof Request ? input.url : String(input), location.origin);
    } catch {
      return original(input, init);
    }
    if (
      url.origin !== api.origin ||
      !url.pathname.startsWith(api.pathname + '/') ||
      url.pathname === new URL(endpoint).pathname
    )
      return original(input, init);
    return trace
      .getTracer('asteriq-web')
      .startActiveSpan('web.http.request', { kind: SpanKind.CLIENT }, async (span) => {
        const headers = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
        const carrier: Record<string, string> = {};
        propagation.inject(context.active(), carrier);
        for (const [key, value] of Object.entries(carrier)) headers.set(key, value);
        try {
          const response = await original(input, { ...init, headers });
          span.setAttribute('http.response.status_code', response.status);
          if (response.status >= 400) span.setStatus({ code: SpanStatusCode.ERROR });
          return response;
        } catch (error) {
          span.setStatus({ code: SpanStatusCode.ERROR });
          throw error;
        } finally {
          span.end();
        }
      });
  };
  window.addEventListener('pagehide', () => {
    void provider.forceFlush().catch(() => {});
  });
}
