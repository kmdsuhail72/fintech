import type { RequestHandler } from 'express';
import { AuthError } from '../auth/errors.js';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new AuthError(400, 'INVALID_TRACE', 'Invalid trace payload');
  return value as ObjectValue;
};
export function normalizeBrowserTraces(value: unknown) {
  const body = object(value);
  if (!Array.isArray(body.resourceSpans) || body.resourceSpans.length > 4)
    throw new AuthError(400, 'INVALID_TRACE', 'Invalid trace payload');
  let count = 0;
  return {
    resourceSpans: body.resourceSpans.map((resource) => {
      const row = object(resource);
      if (!Array.isArray(row.scopeSpans) || row.scopeSpans.length > 4)
        throw new AuthError(400, 'INVALID_TRACE', 'Invalid trace payload');
      return {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'asteriq-web' } },
            {
              key: 'deployment.environment.name',
              value: { stringValue: process.env.ASTERIQ_ENVIRONMENT ?? 'local' },
            },
            { key: 'asteriq.client.untrusted', value: { boolValue: true } },
          ],
        },
        scopeSpans: row.scopeSpans.map((scope) => {
          const data = object(scope);
          if (!Array.isArray(data.spans))
            throw new AuthError(400, 'INVALID_TRACE', 'Invalid trace payload');
          return {
            scope: { name: 'asteriq-web' },
            spans: data.spans.map((item) => {
              const span = object(item);
              if (
                ++count > 32 ||
                !/^[a-f0-9]{32}$/i.test(String(span.traceId)) ||
                /^0+$/.test(String(span.traceId)) ||
                !/^[a-f0-9]{16}$/i.test(String(span.spanId)) ||
                /^0+$/.test(String(span.spanId)) ||
                (span.parentSpanId && !/^[a-f0-9]{16}$/i.test(String(span.parentSpanId))) ||
                !/^[0-9]{1,20}$/.test(String(span.startTimeUnixNano)) ||
                !/^[0-9]{1,20}$/.test(String(span.endTimeUnixNano)) ||
                BigInt(String(span.endTimeUnixNano)) < BigInt(String(span.startTimeUnixNano))
              )
                throw new AuthError(400, 'INVALID_TRACE', 'Invalid trace payload');
              const attributes = Array.isArray(span.attributes)
                ? span.attributes.flatMap((entry) => {
                    const attribute = object(entry);
                    if (attribute.key !== 'http.response.status_code') return [];
                    const status = Number(object(attribute.value).intValue);
                    return Number.isInteger(status) && status >= 100 && status <= 599
                      ? [{ key: attribute.key, value: { intValue: String(status) } }]
                      : [];
                  })
                : [];
              return {
                traceId: span.traceId,
                spanId: span.spanId,
                ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
                name: 'web.http.request',
                kind: 3,
                startTimeUnixNano: String(span.startTimeUnixNano),
                endTimeUnixNano: String(span.endTimeUnixNano),
                flags: 1,
                status: { code: object(span.status ?? {}).code === 2 ? 2 : 0 },
                attributes,
                events: [],
                links: [],
              };
            }),
          };
        }),
      };
    }),
  };
}
export const browserTraceProxy: RequestHandler = async (request, response, next) => {
  try {
    if (process.env.OTEL_ENABLED !== 'true' || !process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT)
      throw new AuthError(503, 'TRACING_UNAVAILABLE', 'Trace collection is unavailable');
    if (Buffer.byteLength(JSON.stringify(request.body) ?? '') > 131072)
      throw new AuthError(413, 'TRACE_TOO_LARGE', 'Trace batch is too large');
    const traces = normalizeBrowserTraces(request.body);
    const result = await fetch(process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT, {
      method: 'POST',
      redirect: 'error',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(traces),
      signal: AbortSignal.timeout(3000),
    });
    if (!result.ok)
      throw new AuthError(503, 'TRACING_UNAVAILABLE', 'Trace collection is unavailable');
    response.json({});
  } catch (error) {
    next(
      error instanceof AuthError
        ? error
        : new AuthError(503, 'TRACING_UNAVAILABLE', 'Trace collection is unavailable'),
    );
  }
};
