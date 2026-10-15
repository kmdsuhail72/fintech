import { rateLimit } from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { createClient } from 'redis';
import { AuthError } from './errors.js';

type RedisClient = ReturnType<typeof createClient>;

export function createAuthRateLimiters(redis: RedisClient) {
  const createLimiter = (prefix: string, limit: number, windowMs: number) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: 'draft-8',
      legacyHeaders: false,
      store: new RedisStore({
        sendCommand: (...args: string[]) => redis.sendCommand(args),
        prefix,
      }),
      handler: (_request, _response, next) => {
        next(new AuthError(429, 'RATE_LIMITED', 'Too many requests; try again later'));
      },
    });

  return {
    register: createLimiter('rl:auth:register:', 5, 60 * 60 * 1000),
    login: createLimiter('rl:auth:login:', 10, 15 * 60 * 1000),
    refresh: createLimiter('rl:auth:refresh:', 30, 60 * 1000),
    recovery: createLimiter('rl:auth:recovery:', 5, 60 * 60 * 1000),
  };
}
