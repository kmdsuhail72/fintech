import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import { SignJWT } from 'jose';
import type { Pool, PoolClient } from 'pg';
import { createClient } from 'redis';
import { env } from '../config.js';
import { AuthError } from './errors.js';
import { sendAuthEmail } from './mailer.js';

type RedisClient = ReturnType<typeof createClient>;

const BCRYPT_COST = 12;
const LOCK_THRESHOLD = 5;
const LOCK_SECONDS = 15 * 60;
const ACCESS_SECONDS = 10 * 60;
const REFRESH_SECONDS = 30 * 24 * 60 * 60;
const VERIFY_SECONDS = 24 * 60 * 60;
const RESET_SECONDS = 30 * 60;
const dummyPasswordHash = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.5nG7F2cLcnqD6i1x2A4mKzT9yQ9sO7e';
const jwtKey = new TextEncoder().encode(env.JWT_ACCESS_SECRET);

export type ClientType = 'web' | 'mobile';
export type AuthResult = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  user: { id: string; email: string; displayName: string | null };
};
export type SessionInfo = {
  id: string;
  deviceLabel: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
};

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');
const opaqueToken = () => randomBytes(32).toString('base64url');
const lockKey = (email: string) => `auth:lock:${createHash('sha256').update(email).digest('hex')}`;
const revokedKey = (sessionId: string) => `auth:revoked:${sessionId}`;

async function issueAccessToken(userId: string, sessionId: string): Promise<string> {
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setSubject(userId)
    .setJti(randomUUID())
    .setIssuer(env.JWT_ISSUER)
    .setAudience(env.JWT_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_SECONDS}s`)
    .sign(jwtKey);
}

async function withTransaction<T>(pool: Pool, operation: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export class AuthService {
  constructor(
    private readonly pool: Pool,
    private readonly redis: RedisClient,
  ) {}

  async register(input: {
    email: string;
    password: string;
    displayName?: string | undefined;
  }): Promise<{ message: string; developmentToken?: string }> {
    const passwordHash = await hash(input.password, BCRYPT_COST);
    const verifyToken = opaqueToken();
    try {
      await withTransaction(this.pool, async (client) => {
        const user = await client.query<{ id: string }>(
          `INSERT INTO users (email, password_hash, status)
           VALUES ($1, $2, 'PENDING')
           RETURNING id`,
          [input.email, passwordHash],
        );
        const id = user.rows[0]!.id;
        await client.query(
          `INSERT INTO user_profiles (user_id, display_name)
           VALUES ($1, $2)`,
          [id, input.displayName ?? null],
        );
        const account = await client.query<{ id: string }>(
          `INSERT INTO accounts (user_id, account_type, name, base_currency, initial_virtual_capital)
           VALUES ($1, 'PAPER', 'Paper Trading', $2, $3)
           RETURNING id`,
          [id, env.DEFAULT_CURRENCY, env.INITIAL_VIRTUAL_CAPITAL],
        );
        const accountId = account.rows[0]!.id;
        const wallet = await client.query<{ id: string }>(
          `INSERT INTO wallets (account_id, currency, balance)
           VALUES ($1, $2, $3)
           RETURNING id`,
          [accountId, env.DEFAULT_CURRENCY, env.INITIAL_VIRTUAL_CAPITAL],
        );
        await client.query(
          `INSERT INTO transactions
             (account_id, wallet_id, transaction_type, amount, currency, idempotency_key, description)
           VALUES ($1, $2, 'VIRTUAL_FUNDING', $3, $4, $5, 'Initial virtual paper-trading capital')`,
          [
            accountId,
            wallet.rows[0]!.id,
            env.INITIAL_VIRTUAL_CAPITAL,
            env.DEFAULT_CURRENCY,
            `initial-virtual-capital:${id}`,
          ],
        );
        await client.query(
          `INSERT INTO portfolios (account_id, name, base_currency)
           VALUES ($1, 'Main Portfolio', $2)`,
          [accountId, env.DEFAULT_CURRENCY],
        );
        await this.createOneTimeToken(
          client,
          id,
          'EMAIL_VERIFICATION',
          verifyToken,
          VERIFY_SECONDS,
        );
        await client.query(
          `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, outcome)
           VALUES ($1, 'AUTH_REGISTERED', 'user', $1, 'SUCCESS')`,
          [id],
        );
        return id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return { message: 'If the address can be registered, a verification email will be sent.' };
      }
      throw error;
    }

    await sendAuthEmail(
      input.email,
      'Verify your Asteriq AI account',
      `${env.AUTH_WEB_URL}/verify-email#token=${encodeURIComponent(verifyToken)}`,
    );

    return {
      message: 'If the address can be registered, a verification email will be sent.',
      ...(env.NODE_ENV === 'development' && env.DEV_AUTH_TOKEN_OUTPUT
        ? { developmentToken: verifyToken }
        : {}),
    };
  }

  async resendVerification(email: string): Promise<{ message: string; developmentToken?: string }> {
    const genericMessage = 'If the account needs verification, an email will be sent.';
    const result = await this.pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM users WHERE lower(email) = $1`,
      [email],
    );
    const user = result.rows[0];
    if (!user || user.status !== 'PENDING') return { message: genericMessage };

    const token = opaqueToken();
    await this.pool.query(
      `UPDATE auth_tokens
       SET consumed_at = now()
       WHERE user_id = $1 AND purpose = 'EMAIL_VERIFICATION' AND consumed_at IS NULL`,
      [user.id],
    );
    await this.createOneTimeTokenOutsideTransaction(
      user.id,
      'EMAIL_VERIFICATION',
      token,
      VERIFY_SECONDS,
    );
    await sendAuthEmail(
      email,
      'Verify your Asteriq AI account',
      `${env.AUTH_WEB_URL}/verify-email#token=${encodeURIComponent(token)}`,
    );
    return {
      message: genericMessage,
      ...(env.NODE_ENV === 'development' && env.DEV_AUTH_TOKEN_OUTPUT
        ? { developmentToken: token }
        : {}),
    };
  }

  async verifyEmail(token: string): Promise<void> {
    await withTransaction(this.pool, async (client) => {
      const tokenResult = await client.query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM auth_tokens
         WHERE token_hash = $1 AND purpose = 'EMAIL_VERIFICATION'
           AND consumed_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [hashToken(token)],
      );
      const record = tokenResult.rows[0];
      if (!record) throw invalidToken();
      await client.query(`UPDATE auth_tokens SET consumed_at = now() WHERE id = $1`, [record.id]);
      const update = await client.query(
        `UPDATE users
         SET status = 'ACTIVE', email_verified_at = now()
         WHERE id = $1 AND status = 'PENDING'`,
        [record.user_id],
      );
      if (update.rowCount !== 1) throw invalidToken();
    });
  }

  async login(
    input: { email: string; password: string },
    context: {
      clientType: ClientType;
      ip?: string | undefined;
      userAgent?: string | undefined;
      deviceLabel?: string | undefined;
    },
  ): Promise<AuthResult> {
    const key = lockKey(input.email);
    const locked = await this.redis.get(key);
    if (locked)
      throw new AuthError(429, 'ACCOUNT_LOCKED', 'Too many failed attempts; try again later');

    const result = await this.pool.query<{
      id: string;
      email: string;
      password_hash: string;
      status: string;
      display_name: string | null;
    }>(
      `SELECT u.id, u.email, u.password_hash, u.status, p.display_name
       FROM users u LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE lower(u.email) = $1`,
      [input.email],
    );
    const user = result.rows[0];
    const matches = await compare(input.password, user?.password_hash ?? dummyPasswordHash);
    if (!user || !matches || user.status !== 'ACTIVE') {
      const attempts = Number(
        await this.redis.eval(
          `local count = redis.call('INCR', KEYS[1])
           if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]) end
           return count`,
          { keys: [key], arguments: [String(LOCK_SECONDS)] },
        ),
      );
      if (attempts >= LOCK_THRESHOLD) {
        throw new AuthError(429, 'ACCOUNT_LOCKED', 'Too many failed attempts; try again later');
      }
      throw new AuthError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
    }
    await this.redis.del(key);
    return this.createSession(user, context);
  }

  async refresh(
    rawToken: string,
    context: { clientType: ClientType; ip?: string | undefined; userAgent?: string | undefined },
  ): Promise<AuthResult> {
    const currentHash = hashToken(rawToken);
    const nextToken = opaqueToken();
    const rotated = await withTransaction(this.pool, async (client) => {
      const tokenResult = await client.query<{
        id: string;
        session_id: string;
        used_at: Date | null;
        expires_at: Date;
      }>(
        `SELECT id, session_id, used_at, expires_at
         FROM refresh_tokens
         WHERE token_hash = $1
         FOR UPDATE`,
        [currentHash],
      );
      const token = tokenResult.rows[0];
      if (!token) throw invalidCredentials();
      if (token.used_at) {
        await client.query(
          `UPDATE sessions SET revoked_at = now()
           WHERE id = $1 AND revoked_at IS NULL`,
          [token.session_id],
        );
        return { reusedSessionId: token.session_id } as const;
      }
      if (token.expires_at.getTime() <= Date.now()) throw invalidCredentials();

      const sessionResult = await client.query<{
        id: string;
        user_id: string;
        expires_at: Date;
        email: string;
        display_name: string | null;
      }>(
        `SELECT s.id, s.user_id, s.expires_at, u.email, p.display_name
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN user_profiles p ON p.user_id = u.id
         WHERE s.id = $1 AND s.revoked_at IS NULL AND s.expires_at > now()
           AND u.status = 'ACTIVE'
         FOR UPDATE OF s`,
        [token.session_id],
      );
      const session = sessionResult.rows[0];
      if (!session) throw invalidCredentials();

      await client.query(`UPDATE refresh_tokens SET used_at = now() WHERE id = $1`, [token.id]);
      const newExpiry = new Date(Date.now() + REFRESH_SECONDS * 1000);
      const newHash = hashToken(nextToken);
      await client.query(
        `INSERT INTO refresh_tokens (session_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [session.id, newHash, newExpiry],
      );
      await client.query(
        `UPDATE sessions
         SET token_hash = $2, expires_at = $3, last_seen_at = now(),
             ip_address = COALESCE($4::inet, ip_address),
             user_agent = COALESCE($5, user_agent)
         WHERE id = $1`,
        [session.id, newHash, newExpiry, context.ip ?? null, context.userAgent ?? null],
      );
      return {
        sessionId: session.id,
        userId: session.user_id,
        email: session.email,
        displayName: session.display_name,
      } as const;
    });

    if ('reusedSessionId' in rotated) {
      await this.revokeSessionInRedis(rotated.reusedSessionId);
      throw invalidCredentials();
    }
    const accessToken = await issueAccessToken(rotated.userId, rotated.sessionId);
    return {
      accessToken,
      refreshToken: nextToken,
      accessTokenExpiresIn: ACCESS_SECONDS,
      user: { id: rotated.userId, email: rotated.email, displayName: rotated.displayName },
    };
  }

  async logout(sessionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE sessions SET revoked_at = now()
       WHERE id = $1 AND revoked_at IS NULL`,
      [sessionId],
    );
    await this.revokeSessionInRedis(sessionId);
  }

  async logoutByRefreshToken(rawToken: string): Promise<void> {
    const result = await this.pool.query<{ session_id: string }>(
      `SELECT session_id FROM refresh_tokens WHERE token_hash = $1`,
      [hashToken(rawToken)],
    );
    const sessionId = result.rows[0]?.session_id;
    if (sessionId) await this.logout(sessionId);
  }

  async logoutAll(userId: string): Promise<void> {
    const sessions = await this.pool.query<{ id: string }>(
      `UPDATE sessions SET revoked_at = now()
       WHERE user_id = $1 AND revoked_at IS NULL
       RETURNING id`,
      [userId],
    );
    await Promise.all(sessions.rows.map((session) => this.revokeSessionInRedis(session.id)));
  }

  async forgotPassword(email: string): Promise<{ message: string; developmentToken?: string }> {
    const genericMessage = 'If the account exists, a password reset email will be sent.';
    const result = await this.pool.query<{ id: string }>(
      `SELECT id FROM users WHERE lower(email) = $1 AND status = 'ACTIVE'`,
      [email],
    );
    const userId = result.rows[0]?.id;
    if (!userId) return { message: genericMessage };

    const token = opaqueToken();
    await this.pool.query(
      `UPDATE auth_tokens SET consumed_at = now()
       WHERE user_id = $1 AND purpose = 'PASSWORD_RESET' AND consumed_at IS NULL`,
      [userId],
    );
    await this.createOneTimeTokenOutsideTransaction(userId, 'PASSWORD_RESET', token, RESET_SECONDS);
    try {
      await sendAuthEmail(
        email,
        'Reset your Asteriq AI password',
        `${env.AUTH_WEB_URL}/reset-password#token=${encodeURIComponent(token)}`,
      );
    } catch (error) {
      console.error('Password reset email delivery failed', error);
      throw error;
    }
    return {
      message: genericMessage,
      ...(env.NODE_ENV === 'development' && env.DEV_AUTH_TOKEN_OUTPUT
        ? { developmentToken: token }
        : {}),
    };
  }

  async resetPassword(token: string, password: string): Promise<void> {
    const passwordHash = await hash(password, BCRYPT_COST);
    const revokedSessionIds = await withTransaction(this.pool, async (client) => {
      const tokenResult = await client.query<{ id: string; user_id: string }>(
        `SELECT id, user_id FROM auth_tokens
         WHERE token_hash = $1 AND purpose = 'PASSWORD_RESET'
           AND consumed_at IS NULL AND expires_at > now()
         FOR UPDATE`,
        [hashToken(token)],
      );
      const reset = tokenResult.rows[0];
      if (!reset) throw invalidToken();

      await client.query(`UPDATE auth_tokens SET consumed_at = now() WHERE id = $1`, [reset.id]);
      await client.query(`UPDATE users SET password_hash = $2 WHERE id = $1`, [
        reset.user_id,
        passwordHash,
      ]);
      const sessions = await client.query<{ id: string }>(
        `UPDATE sessions SET revoked_at = now()
         WHERE user_id = $1 AND revoked_at IS NULL
         RETURNING id`,
        [reset.user_id],
      );
      await client.query(
        `UPDATE auth_tokens SET consumed_at = now()
         WHERE user_id = $1 AND consumed_at IS NULL`,
        [reset.user_id],
      );
      return sessions.rows.map((session) => session.id);
    });
    await Promise.all(revokedSessionIds.map((sessionId) => this.revokeSessionInRedis(sessionId)));
  }

  async listSessions(
    userId: string,
    currentSessionId: string,
  ): Promise<Array<SessionInfo & { current: boolean }>> {
    const result = await this.pool.query<{
      id: string;
      device_label: string | null;
      ip_address: string | null;
      user_agent: string | null;
      created_at: Date;
      last_seen_at: Date;
      expires_at: Date;
    }>(
      `SELECT id, device_label, host(ip_address) AS ip_address, user_agent,
              created_at, last_seen_at, expires_at
       FROM sessions
       WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
       ORDER BY last_seen_at DESC`,
      [userId],
    );
    return result.rows.map((session) => ({
      id: session.id,
      deviceLabel: session.device_label,
      ipAddress: session.ip_address,
      userAgent: session.user_agent,
      createdAt: session.created_at.toISOString(),
      lastSeenAt: session.last_seen_at.toISOString(),
      expiresAt: session.expires_at.toISOString(),
      current: session.id === currentSessionId,
    }));
  }

  async revokeOwnedSession(userId: string, sessionId: string): Promise<void> {
    const result = await this.pool.query<{ id: string }>(
      `UPDATE sessions SET revoked_at = now()
       WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL
       RETURNING id`,
      [sessionId, userId],
    );
    if (result.rowCount === 0) throw new AuthError(404, 'SESSION_NOT_FOUND', 'Session not found');
    await this.revokeSessionInRedis(sessionId);
  }

  async assertSessionActive(sessionId: string, userId: string): Promise<void> {
    const revoked = await this.redis.get(revokedKey(sessionId));
    if (revoked) throw invalidCredentials();
    const result = await this.pool.query<{ last_seen_at: Date }>(
      `SELECT s.last_seen_at FROM sessions s JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.user_id = $2 AND s.revoked_at IS NULL AND s.expires_at > now()
         AND u.status = 'ACTIVE'`,
      [sessionId, userId],
    );
    const session = result.rows[0];
    if (!session) throw invalidCredentials();
    if (Date.now() - session.last_seen_at.getTime() >= 60_000) {
      await this.pool.query(
        `UPDATE sessions SET last_seen_at = now()
         WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`,
        [sessionId, userId],
      );
    }
  }

  async writeAudit(
    userId: string,
    action: string,
    entityType: string,
    entityId: string,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, outcome)
       VALUES ($1, $2, $3, $4, 'SUCCESS')`,
      [userId, action, entityType, entityId],
    );
  }

  private async createSession(
    user: { id: string; email: string; display_name: string | null },
    context: {
      clientType: ClientType;
      ip?: string | undefined;
      userAgent?: string | undefined;
      deviceLabel?: string | undefined;
    },
  ): Promise<AuthResult> {
    const sessionId = randomUUID();
    const refreshToken = opaqueToken();
    const refreshHash = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_SECONDS * 1000);

    await withTransaction(this.pool, async (client) => {
      await client.query(
        `INSERT INTO sessions
           (id, user_id, token_hash, device_label, ip_address, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5::inet, $6, $7)`,
        [
          sessionId,
          user.id,
          refreshHash,
          safeDeviceLabel(
            context.deviceLabel ?? (context.clientType === 'mobile' ? 'Mobile app' : 'Web browser'),
          ),
          context.ip ?? null,
          context.userAgent ?? null,
          expiresAt,
        ],
      );
      await client.query(
        `INSERT INTO refresh_tokens (session_id, token_hash, expires_at)
         VALUES ($1, $2, $3)`,
        [sessionId, refreshHash, expiresAt],
      );
      await client.query(
        `INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, outcome)
         VALUES ($1, 'AUTH_LOGIN', 'session', $2, 'SUCCESS')`,
        [user.id, sessionId],
      );
    });

    return {
      accessToken: await issueAccessToken(user.id, sessionId),
      refreshToken,
      accessTokenExpiresIn: ACCESS_SECONDS,
      user: { id: user.id, email: user.email, displayName: user.display_name },
    };
  }

  private async createOneTimeToken(
    client: PoolClient,
    userId: string,
    purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET',
    token: string,
    lifetimeSeconds: number,
  ) {
    await client.query(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + ($4 * interval '1 second'))`,
      [userId, purpose, hashToken(token), lifetimeSeconds],
    );
  }

  private async createOneTimeTokenOutsideTransaction(
    userId: string,
    purpose: 'EMAIL_VERIFICATION' | 'PASSWORD_RESET',
    token: string,
    lifetimeSeconds: number,
  ) {
    await this.pool.query(
      `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at)
       VALUES ($1, $2, $3, now() + ($4 * interval '1 second'))`,
      [userId, purpose, hashToken(token), lifetimeSeconds],
    );
  }

  private async revokeSessionInRedis(sessionId: string) {
    const result = await this.pool.query<{ expires_at: Date }>(
      `SELECT expires_at FROM sessions WHERE id = $1`,
      [sessionId],
    );
    const ttl = Math.max(
      1,
      Math.ceil(((result.rows[0]?.expires_at.getTime() ?? Date.now()) - Date.now()) / 1000),
    );
    await this.redis.set(revokedKey(sessionId), '1', { EX: ttl });
  }
}

function safeDeviceLabel(value?: string): string | null {
  if (!value) return null;
  const normalized = value.replace(/[\r\n]/g, '').trim();
  return normalized ? normalized.slice(0, 100) : null;
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505';
}

function invalidCredentials() {
  return new AuthError(401, 'INVALID_CREDENTIALS', 'Authentication credentials are invalid');
}

function invalidToken() {
  return new AuthError(400, 'INVALID_OR_EXPIRED_TOKEN', 'Token is invalid or expired');
}

export async function verifyAccessToken(token: string) {
  const { jwtVerify } = await import('jose');
  try {
    const verified = await jwtVerify(token, jwtKey, {
      algorithms: ['HS256'],
      issuer: env.JWT_ISSUER,
      audience: env.JWT_AUDIENCE,
      requiredClaims: ['exp', 'iat', 'sub', 'sid'],
      typ: 'JWT',
      maxTokenAge: `${ACCESS_SECONDS}s`,
    });
    const userId = verified.payload.sub;
    const sessionId = verified.payload.sid;
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (
      typeof userId !== 'string' ||
      typeof sessionId !== 'string' ||
      !uuid.test(userId) ||
      !uuid.test(sessionId) ||
      typeof verified.payload.exp !== 'number'
    )
      throw invalidCredentials();
    return {
      userId,
      sessionId,
      expiresAtMs: Math.min(verified.payload.exp, verified.payload.iat! + ACCESS_SECONDS) * 1000,
    };
  } catch {
    throw invalidCredentials();
  }
}

export function accessTokenTtlSeconds() {
  return ACCESS_SECONDS;
}
