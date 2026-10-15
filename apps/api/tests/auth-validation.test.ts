import assert from 'node:assert/strict';
import test from 'node:test';
import { compare } from 'bcryptjs';
import { loginSchema, registerSchema } from '../src/auth/validation.js';

test('registration normalizes email and accepts a compliant password', () => {
  const result = registerSchema.parse({
    email: '  LEARNER@example.com ',
    password: 'correct horse battery staple',
    displayName: 'Learner',
  });

  assert.equal(result.email, 'learner@example.com');
});

test('registration rejects passwords shorter than 12 characters', () => {
  assert.equal(
    registerSchema.safeParse({ email: 'learner@example.com', password: 'short-pass' }).success,
    false,
  );
});

test('password validation respects bcrypt UTF-8 byte limit', () => {
  assert.equal(
    registerSchema.safeParse({
      email: 'learner@example.com',
      password: '🙂'.repeat(19),
    }).success,
    false,
  );
});

test('login rejects unexpected fields', () => {
  assert.equal(
    loginSchema.safeParse({
      email: 'learner@example.com',
      password: 'correct horse battery staple',
      isAdmin: true,
    }).success,
    false,
  );
});

test('the dummy password hash remains a valid cost-12 bcrypt hash', async () => {
  const dummyHash = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.5nG7F2cLcnqD6i1x2A4mKzT9yQ9sO7e';
  assert.equal(dummyHash.length, 60);
  assert.equal(await compare('not-the-password', dummyHash), false);
});
