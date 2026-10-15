import { observeHttp } from './middleware/observability.js';
import { registry, instrumentDatabase } from './utils/prometheus.js';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import type { Pool } from 'pg';
import { createClient } from 'redis';
import type { Server as SocketServer } from 'socket.io';
import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import type { ApiResponse, HealthStatus, ReadinessStatus } from '@asteriq/types';
import { corsOrigins, env } from './config.js';
import { AuthError } from './auth/errors.js';
import { createAuthRouter } from './auth/routes.js';
import { ZodError } from 'zod';
import { createApiRouter } from './routes/api.routes.js';
import { logger } from './utils/logger.js';
import type { MarketDataService } from './market-data/market-data.service.js';

type RedisClient = ReturnType<typeof createClient>;

export function createApp(
  pool: Pool,
  redis: RedisClient,
  getIO?: () => SocketServer | undefined,
  marketData?: MarketDataService,
) {
  const app = express();
  instrumentDatabase(pool);
  app.get('/metrics', async (_request, response) => {
    response.setHeader('Content-Type', registry.contentType);
    response.send(await registry.metrics());
  });

  app.disable('x-powered-by');
  if (env.NODE_ENV === 'production') {
    app.set('trust proxy', env.TRUST_PROXY_HOPS);
  }
  app.use(observeHttp);
  app.use(helmet());
  app.use(
    cors({
      credentials: true,
      exposedHeaders: ['X-Request-Id', 'X-Trace-Id', 'traceparent'],
      origin(origin, callback) {
        if (!origin || corsOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new AuthError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed'));
      },
    }),
  );
  const standardJson = express.json({ limit: '1mb' });
  const documentJson = express.json({ limit: '10mb' });
  app.use((request, response, next) => {
    const parser =
      request.method === 'POST' && request.path === '/api/v1/ai/research/documents'
        ? documentJson
        : standardJson;
    parser(request, response, next);
  });

  app.use('/api/v1/auth', createAuthRouter(pool, redis));
  app.use(
    '/api/v1',
    rateLimit({
      windowMs: 60_000,
      limit: 300,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      store: new RedisStore({
        sendCommand: (...args: string[]) => redis.sendCommand(args),
        prefix: 'rl:api:',
      }),
      handler: (_request, _response, next) => {
        next(new AuthError(429, 'RATE_LIMITED', 'Too many requests; try again later'));
      },
    }),
  );
  app.use('/api/v1', createApiRouter(pool, redis, getIO, marketData));

  app.get('/api/v1/health', (_request, response) => {
    const result: ApiResponse<HealthStatus> = {
      ok: true,
      data: {
        status: 'ok',
        service: 'asteriq-api',
        timestamp: new Date().toISOString(),
      },
      requestId: response.getHeader('X-Request-Id') as string,
    };
    response.status(200).json(result);
  });

  app.get('/api/v1/ready', async (_request, response) => {
    const dependencies: ReadinessStatus['dependencies'] = {
      postgres: 'error',
      redis: 'error',
    };

    try {
      await pool.query('SELECT 1');
      dependencies.postgres = 'ok';
    } catch (error) {
      logger.error('PostgreSQL readiness check failed', {
        event: 'database_failure',
        error: error instanceof Error ? error.message : 'unknown error',
      });
    }

    try {
      await redis.ping();
      dependencies.redis = 'ok';
    } catch (error) {
      logger.error('Redis readiness check failed', {
        error: error instanceof Error ? error.message : 'unknown error',
      });
    }

    const ready = dependencies.postgres === 'ok' && dependencies.redis === 'ok';
    const result: ApiResponse<ReadinessStatus> = ready
      ? {
          ok: true,
          data: {
            status: 'ok',
            service: 'asteriq-api',
            timestamp: new Date().toISOString(),
            dependencies,
          },
          requestId: response.getHeader('X-Request-Id') as string,
        }
      : {
          ok: false,
          error: {
            code: 'DEPENDENCY_UNAVAILABLE',
            message: 'One or more required dependencies are unavailable',
          },
          requestId: response.getHeader('X-Request-Id') as string,
        };

    response.status(ready ? 200 : 503).json(result);
  });

  app.use((_request, response) => {
    const result: ApiResponse<never> = {
      ok: false,
      error: { code: 'NOT_FOUND', message: 'Route not found' },
      requestId: response.getHeader('X-Request-Id') as string,
    };
    response.status(404).json(result);
  });

  app.use(
    (
      error: unknown,
      request: express.Request,
      response: express.Response,
      next: express.NextFunction,
    ) => {
      if (response.headersSent) {
        next(error);
        return;
      }
      const requestId = response.getHeader('X-Request-Id') as string;
      if (
        error &&
        typeof error === 'object' &&
        'type' in error &&
        ['entity.parse.failed', 'entity.too.large', 'request.aborted'].includes(String(error.type))
      ) {
        const oversized = error.type === 'entity.too.large';
        response.status(oversized ? 413 : 400).json({
          ok: false,
          error: {
            code: oversized ? 'PAYLOAD_TOO_LARGE' : 'INVALID_REQUEST_BODY',
            message: oversized
              ? 'Request body exceeds the supported size'
              : 'Request body is invalid',
          },
          requestId,
        });
        return;
      }
      if (error instanceof AuthError) {
        const result: ApiResponse<never> = {
          ok: false,
          error: { code: error.code, message: error.message },
          requestId,
        };
        response.status(error.status).json(result);
        return;
      }
      if (error instanceof ZodError) {
        const result: ApiResponse<never> = {
          ok: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request data is invalid',
            details: error.issues.map((issue) => ({
              path: issue.path.join('.'),
              code: issue.code,
            })),
          },
          requestId,
        };
        response.status(400).json(result);
        return;
      }
      if (error && typeof error === 'object' && 'code' in error && error.code === '23505') {
        response.status(409).json({
          ok: false,
          error: {
            code: 'RESOURCE_CONFLICT',
            message: 'A resource with these values already exists',
          },
          requestId,
        });
        return;
      }
      if (
        error &&
        typeof error === 'object' &&
        'type' in error &&
        error.type === 'entity.parse.failed'
      ) {
        response.status(400).json({
          ok: false,
          error: { code: 'INVALID_JSON', message: 'Request body must contain valid JSON' },
          requestId,
        });
        return;
      }
      if (error && typeof error === 'object' && 'status' in error && error.status === 413) {
        response.status(413).json({
          ok: false,
          error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the allowed size' },
          requestId,
        });
        return;
      }
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        ['23503', '23514', '22003'].includes(String(error.code))
      ) {
        response.status(422).json({
          ok: false,
          error: {
            code: error.code === '22003' ? 'NUMERIC_OUT_OF_RANGE' : 'INVALID_REFERENCE',
            message:
              error.code === '22003'
                ? 'A numeric value exceeds the supported range'
                : 'Request references an unavailable or invalid resource',
          },
          requestId,
        });
        return;
      }
      logger.error('Unhandled request error', {
        requestId,
        method: request.method,
        endpoint: typeof request.route?.path === 'string' ? request.route.path : 'unmatched',
        status_code: 500,
        event:
          error &&
          typeof error === 'object' &&
          'code' in error &&
          /^[0-9A-Z]{5}$/.test(String(error.code))
            ? 'database_failure'
            : 'request_failure',
        error: error instanceof Error ? error.name : 'unknown error',
      });
      const result: ApiResponse<never> = {
        ok: false,
        error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
        requestId,
      };
      response.status(500).json(result);
    },
  );

  return app;
}
