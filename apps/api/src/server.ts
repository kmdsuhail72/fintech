import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { createClient } from 'redis';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
dotenv.config({ path: resolve(projectRoot, '.env') });

const { env } = await import('./config.js');
const { initTracing, shutdownTracing, instrumentRedis } = await import('./utils/tracing.js');
initTracing();
const { logger } = await import('./utils/logger.js');
const { startRuntimeMetrics } = await import('./utils/runtime-metrics.js');
const { createSocketServer } = await import('./socket/socket.server.js');
const { MarketDataService } = await import('./market-data/market-data.service.js');
const { AlertEngine } = await import('./alerts/alert-engine.js');
const { AlertStreamWorker } = await import('./alerts/quote-stream.js');
const { NotificationDeliveryWorker, DeliveryRepository } =
  await import('./notifications/delivery-worker.js');
const pool = new Pool({ connectionString: env.DATABASE_URL });
const { instrumentDatabase } = await import('./utils/prometheus.js');
instrumentDatabase(pool, (error) =>
  logger.error('Database query failed', {
    event: 'database_failure',
    error_type: error instanceof Error ? error.name : 'unknown',
  }),
);
const redis = instrumentRedis(createClient({ url: env.REDIS_URL }));

redis.on('error', (error) => {
  logger.error('Redis client error', { error: error.message });
});

let sockets: Awaited<ReturnType<typeof createSocketServer>> | undefined;
let stopRuntimeMetrics: (() => void) | undefined;
let marketData: InstanceType<typeof MarketDataService> | undefined;
let alertWorker: InstanceType<typeof AlertStreamWorker> | undefined;
let deliveryWorker: InstanceType<typeof NotificationDeliveryWorker> | undefined;
try {
  await Promise.all([pool.query('SELECT 1'), redis.connect()]);
  const { createApp } = await import('./app.js');
  marketData = new MarketDataService(pool, redis, () => sockets?.io);
  const app = createApp(pool, redis, () => sockets?.io, marketData);
  const httpServer = createServer(app);
  sockets = await createSocketServer(httpServer, pool, redis);
  if (process.env.OBSERVABILITY_ENABLED === 'true') {
    stopRuntimeMetrics = startRuntimeMetrics(pool, redis, () => sockets?.io);
  }
  if (env.ALERT_WORKERS_ENABLED) {
    alertWorker = new AlertStreamWorker(redis, new AlertEngine(pool));
    await alertWorker.start();
    deliveryWorker = new NotificationDeliveryWorker(
      new DeliveryRepository(pool),
      () => sockets?.io,
    );
    deliveryWorker.start();
  }
  marketData.start();
  httpServer.listen(env.API_PORT, '0.0.0.0', () => {
    logger.info('Asteriq API listening', { port: env.API_PORT });
  });

  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    stopRuntimeMetrics?.();
    logger.info('Graceful shutdown started', { signal });
    try {
      await marketData?.stop();
      await alertWorker?.stop();
      await deliveryWorker?.stop();
      await sockets?.close();
    } catch (error) {
      process.exitCode = 1;
      logger.error('Socket server shutdown failed', {
        error: error instanceof Error ? error.message : 'unknown error',
      });
    } finally {
      await Promise.allSettled([pool.end(), redis.quit()]);
      await shutdownTracing();
    }
  }

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
} catch (error) {
  stopRuntimeMetrics?.();
  logger.error('Failed to start API server', {
    error: error instanceof Error ? error.message : 'unknown error',
  });
  await Promise.allSettled([
    alertWorker?.stop(),
    deliveryWorker?.stop(),
    sockets?.close(),
    pool.end(),
    redis.isOpen ? redis.quit() : Promise.resolve(),
  ]);
  process.exitCode = 1;
}
