import type { RequestHandler } from 'express';
import { performance } from 'node:perf_hooks';
import { createTraceContext, emitMetrics, traceContext } from '../utils/observability.js';
import { logger, userSafeIdentifier } from '../utils/logger.js';
import { incomingContext, startOperation, withoutTracing } from '../utils/tracing.js';
import { SpanKind } from '@opentelemetry/api';
import {
  activeRequests,
  httpRequests,
  httpDuration,
  tradingRequests,
  failedOrders,
  watchlistActivity,
  observeUser,
} from '../utils/prometheus.js';

const observeHttpInternal: RequestHandler = (request, response, next) => {
  const context = createTraceContext(request.header('traceparent'));
  const originalPath = request.path;
  const started = performance.now();
  activeRequests.inc();
  const order = request.method === 'POST' && /^\/api\/v1\/orders\/?$/.test(request.path);
  if (order) tradingRequests.inc();
  const health = /^\/api\/v1\/(?:health|ready)\/?$/.test(request.path);
  const operation = health
    ? 'health'
    : request.path.startsWith('/api/v1/ai/research')
      ? 'research'
      : 'core';
  const latencyTarget = operation === 'research' ? 10_000 : 500;
  response.setHeader('X-Request-Id', context.requestId);
  response.setHeader('X-Trace-Id', context.traceId);
  response.setHeader('traceparent', context.traceparent);
  let recorded = false;
  const record = (aborted: boolean) => {
    if (recorded) return;
    recorded = true;
    traceContext.run(context, () => {
      const duration = performance.now() - started;
      const status = aborted ? 499 : response.statusCode;
      activeRequests.dec();
      const category = order
        ? 'trading'
        : request.path.startsWith('/api/v1/watchlists')
          ? 'watchlist'
          : operation;
      const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(
        request.method,
      )
        ? request.method
        : 'OTHER';
      httpRequests.labels(method, category, String(status)).inc();
      httpDuration.labels(category).observe(duration / 1000);
      if (order && status >= 400) failedOrders.inc();
      if (request.auth) {
        observeUser(request.auth.userId);
        if (category === 'watchlist' && status < 400) watchlistActivity.inc();
      }
      const eligible =
        !health &&
        request.method !== 'OPTIONS' &&
        (status < 400 || status === 429 || status >= 500 || aborted);
      const successful = eligible && status < 400;
      emitMetrics(
        {
          RequestCount: { value: 1, unit: 'Count' },
          RequestLatency: { value: duration, unit: 'Milliseconds' },
          HTTP4xx: { value: Number(status >= 400 && status < 500), unit: 'Count' },
          HTTP5xx: { value: Number(status >= 500), unit: 'Count' },
          AbortedRequests: { value: Number(aborted), unit: 'Count' },
          SloRequests: { value: Number(eligible), unit: 'Count' },
          SloErrors: {
            value: Number(eligible && (status >= 500 || status === 429 || aborted)),
            unit: 'Count',
          },
          SuccessfulRequests: { value: Number(successful), unit: 'Count' },
          SlowRequests: { value: Number(successful && duration > latencyTarget), unit: 'Count' },
        },
        operation,
      );
      logger.info('HTTP request completed', {
        method: request.method,
        route: typeof request.route?.path === 'string' ? request.route.path : 'unmatched',
        status,
        durationMs: Math.round(duration),
        aborted,
        endpoint:
          typeof request.route?.path === 'string'
            ? request.route.path
            : originalPath.startsWith('/api/v1/orders')
              ? '/orders/*'
              : 'unmatched',
        status_code: status,
        user_safe_identifier: userSafeIdentifier(request.auth?.userId),
        event:
          status === 401
            ? 'authentication_failure'
            : status === 403
              ? 'authorization_failure'
              : status >= 400 &&
                  request.method !== 'GET' &&
                  originalPath.startsWith('/api/v1/orders')
                ? 'trade_failure'
                : status >= 500 && operation === 'research'
                  ? 'ai_failure'
                  : 'http_request',
      });
    });
  };
  response.once('finish', () => record(false));
  response.once('close', () => {
    if (!response.writableFinished) record(true);
  });
  traceContext.run(context, next);
};

export const observeHttp: RequestHandler = (request, response, next) => {
  if (request.path === '/api/v1/telemetry/traces') return withoutTracing(next);
  if (/^\/api\/v1\/(health|ready)\/?$/.test(request.path))
    return observeHttpInternal(request, response, next);
  const method = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'HEAD'].includes(
    request.method,
  )
    ? request.method
    : 'OTHER';
  const operation = startOperation(
    'http.server',
    { 'http.request.method': method },
    SpanKind.SERVER,
    incomingContext(request.header('traceparent'), request.header('tracestate')),
  );
  let done = false;
  const finish = (aborted: boolean) => {
    if (done) return;
    done = true;
    operation.span?.setAttribute('http.response.status_code', aborted ? 499 : response.statusCode);
    if (typeof request.route?.path === 'string')
      operation.span?.setAttribute('http.route', request.route.path);
    operation.finish(aborted || response.statusCode >= 500);
  };
  response.once('finish', () => finish(false));
  response.once('close', () => {
    if (!response.writableFinished) finish(true);
  });
  operation.run(() => observeHttpInternal(request, response, next));
};
