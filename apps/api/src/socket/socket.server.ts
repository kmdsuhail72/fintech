import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import { Server } from 'socket.io';
import type { Pool } from 'pg';
import type { createClient } from 'redis';
import { corsOrigins } from '../config.js';
import { AuthService, verifyAccessToken } from '../auth/service.js';
import { logger } from '../utils/logger.js';
import { emitMetrics } from '../utils/observability.js';

type RedisClient = ReturnType<typeof createClient>;

export async function createSocketServer(httpServer: HttpServer, pool: Pool, redis: RedisClient) {
  const publisher = redis.duplicate();
  const subscriber = redis.duplicate();
  publisher.on('error', (error) =>
    logger.error('Socket Redis publisher error', { error: error.message }),
  );
  subscriber.on('error', (error) =>
    logger.error('Socket Redis subscriber error', { error: error.message }),
  );
  await Promise.all([publisher.connect(), subscriber.connect()]);

  const io = new Server(httpServer, {
    cors: { origin: corsOrigins, credentials: true },
    serveClient: false,
    allowRequest: (request, callback) => {
      const origin = request.headers.origin;
      // Native clients may omit Origin; JWT/session authentication still applies.
      callback(null, !origin || corsOrigins.includes(origin));
    },
    maxHttpBufferSize: 64 * 1024,
    connectionStateRecovery: { maxDisconnectionDuration: 2 * 60 * 1000 },
  });
  io.adapter(createAdapter(publisher, subscriber));
  const auth = new AuthService(pool, redis);

  io.use(async (socket, next) => {
    try {
      const authToken = socket.handshake.auth.token;
      const header = socket.handshake.headers.authorization;
      const token =
        typeof authToken === 'string'
          ? authToken
          : typeof header === 'string' && header.startsWith('Bearer ')
            ? header.slice(7)
            : undefined;
      if (!token) throw new Error('unauthorized');
      const identity = await verifyAccessToken(token);
      await auth.assertSessionActive(identity.sessionId, identity.userId);
      socket.data.userId = identity.userId;
      socket.data.sessionId = identity.sessionId;
      socket.data.expiresAtMs = identity.expiresAtMs;
      next();
    } catch {
      emitMetrics({ WebSocketAuthFailures: { value: 1, unit: 'Count' } });
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const expiresAtMs = socket.data.expiresAtMs as number;
    if (!Number.isFinite(expiresAtMs) || expiresAtMs <= Date.now()) {
      socket.disconnect(true);
      return;
    }
    emitMetrics({ WebSocketOpened: { value: 1, unit: 'Count' } });
    const userId = socket.data.userId as string;
    let subscriptionWindowStarted = Date.now();
    let subscriptionAttempts = 0;
    const subscriptions = new Set<string>();
    const expiryTimer = setTimeout(() => socket.disconnect(true), expiresAtMs - Date.now());
    expiryTimer.unref();
    const sessionCheck = setInterval(() => {
      void auth
        .assertSessionActive(socket.data.sessionId as string, userId)
        .catch(() => socket.disconnect(true));
    }, 15_000);
    sessionCheck.unref();
    const registryKey = (symbolId: string) => `market:subscribers:${symbolId}`;
    const subscriptionHeartbeat = setInterval(() => {
      const score = Date.now();
      for (const symbolId of subscriptions) {
        void redis.zAdd(registryKey(symbolId), { score, value: socket.id }).catch((error) => {
          logger.error('Socket subscription heartbeat failed', {
            userId,
            symbolId,
            error: error instanceof Error ? error.message : 'unknown error',
          });
        });
      }
    }, 15_000);
    subscriptionHeartbeat.unref();
    void socket.join(`user:${userId}`);
    socket.on('market:subscribe', async (payload: unknown) => {
      try {
        if (Date.now() - subscriptionWindowStarted >= 60_000) {
          subscriptionWindowStarted = Date.now();
          subscriptionAttempts = 0;
        }
        subscriptionAttempts += 1;
        if (subscriptionAttempts > 60) {
          socket.emit('market:error', {
            code: 'SUBSCRIPTION_RATE_LIMITED',
            message: 'Too many subscription attempts; try again shortly',
          });
          return;
        }
        const symbolId =
          payload && typeof payload === 'object' && 'symbolId' in payload
            ? (payload as { symbolId?: unknown }).symbolId
            : undefined;
        if (
          typeof symbolId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            symbolId,
          )
        ) {
          socket.emit('market:error', {
            code: 'INVALID_SYMBOL',
            message: 'A valid symbol ID is required',
          });
          return;
        }
        if (socket.rooms.size >= 52 && !socket.rooms.has(`market:${symbolId}`)) {
          socket.emit('market:error', {
            code: 'SUBSCRIPTION_LIMIT',
            message: 'Too many market subscriptions',
          });
          return;
        }
        const result = await pool.query(`SELECT 1 FROM symbols WHERE id = $1 AND is_active`, [
          symbolId,
        ]);
        if (!result.rowCount) {
          socket.emit('market:error', {
            code: 'SYMBOL_NOT_FOUND',
            message: 'Active symbol not found',
          });
          return;
        }
        await socket.join(`market:${symbolId}`);
        await redis.zAdd(registryKey(symbolId), { score: Date.now(), value: socket.id });
        subscriptions.add(symbolId);
      } catch (error) {
        logger.error('Socket market subscription failed', {
          userId,
          error: error instanceof Error ? error.message : 'unknown error',
        });
        socket.emit('market:error', {
          code: 'SUBSCRIPTION_FAILED',
          message: 'Subscription failed',
        });
      }
    });
    socket.on('market:unsubscribe', async (payload: unknown) => {
      const symbolId =
        payload && typeof payload === 'object' && 'symbolId' in payload
          ? (payload as { symbolId?: unknown }).symbolId
          : undefined;
      if (
        typeof symbolId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(symbolId)
      ) {
        await socket.leave(`market:${symbolId}`);
        await redis.zRem(registryKey(symbolId), socket.id);
        subscriptions.delete(symbolId);
      }
    });
    socket.on('disconnect', () => {
      clearTimeout(expiryTimer);
      emitMetrics({ WebSocketClosed: { value: 1, unit: 'Count' } });
      clearInterval(sessionCheck);
      clearInterval(subscriptionHeartbeat);
      for (const symbolId of subscriptions) {
        void redis.zRem(registryKey(symbolId), socket.id).catch((error) => {
          logger.error('Socket subscription cleanup failed', {
            userId,
            symbolId,
            error: error instanceof Error ? error.message : 'unknown error',
          });
        });
      }
      subscriptions.clear();
    });
    socket.on('market:quote', () => {
      socket.emit('market:error', {
        code: 'SERVER_EVENT_ONLY',
        message: 'Market quotes are server-published events',
      });
    });
  });

  return {
    io,
    async close() {
      await new Promise<void>((resolve, reject) => {
        io.close((error) =>
          error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING'
            ? reject(error)
            : resolve(),
        );
      });
      await Promise.allSettled([publisher.quit(), subscriber.quit()]);
    },
  };
}
