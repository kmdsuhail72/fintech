import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from '@prometheus-io/client';
import type { Pool } from 'pg';
import { startOperation } from './tracing.js';
import { SpanKind } from '@opentelemetry/api';

export const registry = new Registry();
collectDefaultMetrics({ register: registry });
const registers = [registry];
const redisHealth = new Gauge({
  name: 'asteriq_redis_healthy',
  help: 'Last API Redis probe: 1 healthy, 0 failed, NaN before first probe.',
  registers,
});
redisHealth.set(Number.NaN);
export const httpRequests = new Counter({
  name: 'asteriq_http_requests_total',
  help: 'Completed HTTP requests.',
  labelNames: ['method', 'operation', 'status'],
  registers,
});
export const httpDuration = new Histogram({
  name: 'asteriq_http_request_duration_seconds',
  help: 'HTTP response duration.',
  labelNames: ['operation'],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60, 120],
  registers,
});
export const activeRequests = new Gauge({
  name: 'asteriq_http_active_requests',
  help: 'Requests currently in flight, excluding metrics scrapes.',
  registers,
});
export const tradingRequests = new Counter({
  name: 'asteriq_trading_requests_total',
  help: 'Order submission attempts at the HTTP boundary.',
  registers,
});
export const failedOrders = new Counter({
  name: 'asteriq_failed_orders_total',
  help: 'Order submissions returning errors or aborting; includes invalid or unauthenticated attempts.',
  registers,
});
export const watchlistActivity = new Counter({
  name: 'asteriq_watchlist_activity_total',
  help: 'Successful authenticated watchlist requests, including reads.',
  registers,
});
export const alertTriggers = new Counter({
  name: 'asteriq_price_alert_triggers_total',
  help: 'Distinct price alerts committed as triggered.',
  registers,
});
const trades = new Counter({
  name: 'asteriq_trades_total',
  help: 'New committed trade executions, excluding idempotent replay.',
  registers,
});
const sockets = new Gauge({
  name: 'asteriq_websocket_connections',
  help: 'Connected authenticated Socket.IO clients in this process.',
  registers,
});
const dbDuration = new Histogram({
  name: 'asteriq_database_query_duration_seconds',
  help: 'PostgreSQL query duration including network time, excluding pool acquisition.',
  labelNames: ['outcome'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5, 15],
  registers,
});
const users = new Map<string, number>();
new Gauge({
  name: 'asteriq_active_users',
  help: 'Distinct authenticated HTTP users seen in the last five minutes on this process; bounded to 10000.',
  registers,
  collect() {
    const cutoff = Date.now() - 300_000;
    for (const [id, timestamp] of users) if (timestamp < cutoff) users.delete(id);
    this.set(users.size);
  },
});
export function observeUser(id: string) {
  // IDs stay process-local and never become metric labels.
  if (users.has(id) || users.size < 10_000) users.set(id, Date.now());
}
export function prometheusEvent(name: string, value: number) {
  if (!Number.isFinite(value) || value < 0) return;
  if (name === 'TradesExecuted') trades.inc(value);
  if (name === 'WebSocketOpened') sockets.inc(value);
  if (name === 'WebSocketClosed') sockets.dec(value);
  if (name === 'RedisHealthy') redisHealth.set(value);
}

const observedPools = new WeakSet<Pool>();
export function instrumentDatabase(pool: Pool, onError?: (error: unknown) => void) {
  if (observedPools.has(pool)) return;
  observedPools.add(pool);
  pool.on('connect', (client) => {
    const query = client.query;
    client.query = function (this: unknown, ...args: unknown[]) {
      const operation = startOperation(
        'postgresql.query',
        { 'db.system.name': 'postgresql' },
        SpanKind.CLIENT,
      );
      const started = performance.now();
      let done = false;
      const finish = (error?: unknown) => {
        if (done) return;
        done = true;
        operation.finish(error);
        dbDuration
          .labels(error ? 'error' : 'success')
          .observe((performance.now() - started) / 1000);
        if (error && onError) {
          try {
            onError(error);
          } catch {
            /* Logging must preserve database outcomes. */
          }
        }
      };
      const callback = args[args.length - 1];
      if (typeof callback === 'function')
        args[args.length - 1] = (...values: unknown[]) => {
          finish(values[0]);
          return Reflect.apply(callback, undefined, values);
        };
      try {
        const result: unknown = operation.run(() => Reflect.apply(query, this, args));
        if (result instanceof Promise)
          return result.then(
            (value: unknown) => {
              finish();
              return value;
            },
            (error: unknown) => {
              finish(error);
              throw error;
            },
          );
        return result;
      } catch (error) {
        finish(error);
        throw error;
      }
    } as typeof client.query;
  });
}
