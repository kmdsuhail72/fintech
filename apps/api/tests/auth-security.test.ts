import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ??= 'postgresql://localhost/auth_unit_test';
process.env.REDIS_URL ??= 'redis://localhost:6379';
process.env.JWT_ACCESS_SECRET ??= 'synthetic-auth-test-secret-at-least-32-characters';
const { env } = await import('../src/config.js');
const { verifyAccessToken } = await import('../src/auth/service.js');
const key = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const userId = randomUUID(),
  sessionId = randomUUID();

test('JWT requires expiration and valid UUID identities', async () => {
  const token = (sub: string, expires: boolean) => {
    const builder = new SignJWT({ sid: sessionId })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(sub)
      .setIssuer(env.JWT_ISSUER)
      .setAudience(env.JWT_AUDIENCE)
      .setIssuedAt();
    return (expires ? builder.setExpirationTime('10m') : builder).sign(key);
  };
  const identity = await verifyAccessToken(await token(userId, true));
  assert.equal(identity.userId, userId);
  assert.ok(identity.expiresAtMs > Date.now());
  await assert.rejects(verifyAccessToken(await token(userId, false)));
  await assert.rejects(verifyAccessToken(await token('not-a-uuid', true)));
});
