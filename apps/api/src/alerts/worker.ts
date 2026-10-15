import { createServer } from 'node:http';
import { Pool } from 'pg';
import { createClient } from 'redis';
import { env } from '../config.js';
import { AlertEngine } from './alert-engine.js';
import { ALERT_PARTITIONS, AlertStreamWorker } from './quote-stream.js';
import {
  DeliveryRepository,
  NotificationDeliveryWorker,
} from '../notifications/delivery-worker.js';
import { createSocketServer } from '../socket/socket.server.js';

// Independent workers join the Redis Socket.IO adapter without opening an HTTP listener.
const pool = new Pool({ connectionString: env.DATABASE_URL });
const redis = createClient({ url: env.REDIS_URL });
redis.on('error', () => console.error('Alert worker Redis error'));
const shardSpec = process.env.ALERT_PARTITIONS;
const partitions = shardSpec
  ? shardSpec.split(',').map(Number)
  : Array.from({ length: ALERT_PARTITIONS }, (_, index) => index);
if (
  partitions.some((index) => !Number.isInteger(index) || index < 0 || index >= ALERT_PARTITIONS) ||
  new Set(partitions).size !== partitions.length
)
  throw new Error('ALERT_PARTITIONS must list unique shard numbers from 0 to 15');
await redis.connect();
const sockets = await createSocketServer(createServer(), pool, redis);
const stream = new AlertStreamWorker(redis, new AlertEngine(pool), partitions);
const deliveries = new NotificationDeliveryWorker(new DeliveryRepository(pool), () => sockets.io);
await stream.start();
deliveries.start();
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await stream.stop();
  await deliveries.stop();
  await sockets.close();
  await Promise.allSettled([pool.end(), redis.quit()]);
}
process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
