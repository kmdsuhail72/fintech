import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

const projectRoot = fileURLToPath(new URL('../../../', import.meta.url));
dotenv.config({ path: resolve(projectRoot, '.env') });

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(3000),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(1),
    ALERT_WORKERS_ENABLED: z
      .enum(['true', 'false'])
      .default('true')
      .transform((value) => value === 'true'),
    EXPO_ACCESS_TOKEN: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().optional(),
    ),
    AI_SERVICE_URL: z.string().url().default('http://127.0.0.1:8000'),
    MARKET_SIMULATION_INTERVAL_MS: z.coerce.number().int().min(1000).max(60_000).default(3000),
    MARKET_HISTORY_INTERVAL_MS: z.coerce.number().int().min(5000).max(3_600_000).default(15_000),
    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),
    CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:8081'),
    JWT_ACCESS_SECRET: z.string().min(32),
    JWT_ISSUER: z.string().default('asteriq-ai'),
    JWT_AUDIENCE: z.string().default('asteriq-clients'),
    AUTH_WEB_URL: z.string().url().default('http://localhost:5173'),
    DEFAULT_CURRENCY: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('USD'),
    INITIAL_VIRTUAL_CAPITAL: z
      .string()
      .regex(/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/)
      .refine((value) => Number(value) > 0, 'Must be positive')
      .default('100000.0000'),
    SMTP_URL: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().url().optional(),
    ),
    AUTH_EMAIL_FROM: z.preprocess(
      (value) => (value === '' ? undefined : value),
      z.string().email().optional(),
    ),
    DEV_AUTH_TOKEN_OUTPUT: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
  })
  .superRefine((value, context) => {
    if (Boolean(value.SMTP_URL) !== Boolean(value.AUTH_EMAIL_FROM)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SMTP_URL and AUTH_EMAIL_FROM must be configured together',
      });
    }
    if (value.NODE_ENV === 'production' && (!value.SMTP_URL || !value.AUTH_EMAIL_FROM)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SMTP_URL and AUTH_EMAIL_FROM are required in production',
      });
    }
  });

export const env = envSchema.parse(process.env);
export const corsOrigins = env.CORS_ORIGINS.split(',').map((origin) => origin.trim());
