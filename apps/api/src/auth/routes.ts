import { Router } from 'express';
import cookieParser from 'cookie-parser';
import type { Pool } from 'pg';
import { createClient } from 'redis';
import { corsOrigins, env } from '../config.js';
import { AuthError } from './errors.js';
import { createAuthController } from './controller.js';
import { requireAuthentication } from './middleware.js';
import { createAuthRateLimiters } from './rate-limit.js';
import { AuthService } from './service.js';

type RedisClient = ReturnType<typeof createClient>;

export function createAuthRouter(pool: Pool, redis: RedisClient) {
  const auth = new AuthService(pool, redis);
  const controller = createAuthController(auth);
  const limits = createAuthRateLimiters(redis);
  const router = Router();

  router.use(cookieParser());
  router.use((request, _response, next) => {
    const origin = request.header('origin');
    if (origin && !corsOrigins.includes(origin)) {
      next(new AuthError(403, 'ORIGIN_NOT_ALLOWED', 'Request origin is not allowed'));
      return;
    }
    if (
      env.NODE_ENV === 'production' &&
      request.header('x-client-type') !== 'mobile' &&
      request.method !== 'GET' &&
      request.method !== 'HEAD' &&
      request.method !== 'OPTIONS' &&
      !origin
    ) {
      next(new AuthError(403, 'ORIGIN_REQUIRED', 'Origin header is required'));
      return;
    }
    next();
  });

  router.post('/register', limits.register, controller.register);
  router.post('/login', limits.login, controller.login);
  router.post('/email/verify', limits.recovery, controller.verifyEmail);
  router.post('/email/verification/resend', limits.recovery, controller.resendVerification);
  router.post('/password/forgot', limits.recovery, controller.forgotPassword);
  router.post('/password/reset', limits.recovery, controller.resetPassword);
  router.post('/refresh', limits.refresh, controller.refresh);
  router.post('/logout', controller.logout);

  const authenticated = requireAuthentication(auth);
  router.post('/logout-all', authenticated, controller.logoutAll);
  router.get('/sessions', authenticated, controller.listSessions);
  router.delete('/sessions/:sessionId', authenticated, controller.revokeSession);

  return router;
}
