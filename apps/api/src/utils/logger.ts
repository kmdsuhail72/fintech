import { traceContext } from './observability.js';
import { createHmac } from 'node:crypto';
type LogFields = Record<string, string | number | boolean | null | undefined>;

export function userSafeIdentifier(userId?: string) {
  const key = process.env.LOG_USER_HASH_KEY;
  return userId && key && key.length >= 32
    ? createHmac('sha256', key).update(userId).digest('hex').slice(0, 24)
    : null;
}

function write(level: 'info' | 'warn' | 'error', message: string, fields: LogFields = {}) {
  const safeFields = Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      /password|authorization|token|secret|cookie|email|jwt|database.?url|redis.?url/i.test(key)
        ? '[REDACTED]'
        : typeof value === 'string'
          ? value
              .replace(/Bearer\s+[^\s]+/gi, 'Bearer [REDACTED]')
              .replace(/((?:postgres(?:ql)?|rediss?|smtps?):\/\/)[^@\s]+@/gi, '$1[REDACTED]@')
              .slice(0, 1000)
          : value,
    ]),
  );
  const entry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level,
    service: 'asteriq-api',
    message,
    environment: process.env.ASTERIQ_ENVIRONMENT ?? 'local',
    namespace: process.env.POD_NAMESPACE ?? null,
    pod: process.env.POD_NAME ?? null,
    request_id: fields.request_id ?? traceContext.getStore()?.requestId ?? null,
    trace_id: fields.trace_id ?? traceContext.getStore()?.traceId ?? null,
    user_safe_identifier: null,
    endpoint: fields.endpoint ?? fields.route ?? null,
    status_code: fields.status_code ?? fields.status ?? null,
    ...safeFields,
    ...traceContext.getStore(),
  });
  console[level](entry);
}

export const logger = {
  info: (message: string, fields?: LogFields) => write('info', message, fields),
  warn: (message: string, fields?: LogFields) => write('warn', message, fields),
  error: (message: string, fields?: LogFields) => write('error', message, fields),
};
