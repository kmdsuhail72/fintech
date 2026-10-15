import type { Pool } from 'pg';
import type { createClient } from 'redis';
import type { Server } from 'socket.io';
import { performance } from 'node:perf_hooks';
import { emitMetrics } from './observability.js';

export function startRuntimeMetrics(
  pool: Pool,
  redis: ReturnType<typeof createClient>,
  getIO: () => Server | undefined,
) {
  let pending = false;
  const tick = async () => {
    emitMetrics({
      RuntimeHeartbeat: { value: 1, unit: 'Count' },
      WebSocketConnections: { value: getIO()?.engine.clientsCount ?? 0, unit: 'Count' },
      DatabasePoolTotal: { value: pool.totalCount, unit: 'Count' },
      DatabasePoolIdle: { value: pool.idleCount, unit: 'Count' },
      DatabasePoolWaiting: { value: pool.waitingCount, unit: 'Count' },
    });
    if (pending) {
      emitMetrics({ RedisHealthy: { value: 0, unit: 'None' } });
      return;
    }
    pending = true;
    const started = performance.now();
    const probe = redis.ping().finally(() => {
      pending = false;
    });
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        probe,
        new Promise<never>((_resolve, reject) => {
          deadline = setTimeout(() => reject(new Error('probe timeout')), 2000);
          deadline.unref();
        }),
      ]);
      emitMetrics({
        RedisHealthy: { value: 1, unit: 'None' },
        RedisPingLatency: { value: performance.now() - started, unit: 'Milliseconds' },
      });
    } catch {
      emitMetrics({ RedisHealthy: { value: 0, unit: 'None' } });
    } finally {
      if (deadline) clearTimeout(deadline);
    }
  };
  const timer = setInterval(() => {
    void tick().catch(() => {});
  }, 60_000);
  timer.unref();
  return () => clearInterval(timer);
}
