import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '../..');
const dockerConfig = resolve(root, '.runtime/docker-cli');
mkdirSync(dockerConfig, { recursive: true });
const fakeEnv = {
  ...process.env,
  DOCKER_CONFIG: dockerConfig,
  POSTGRES_DB: 'asteriq',
  POSTGRES_USER: 'asteriq',
  POSTGRES_PASSWORD: 'test-postgres-hex-value',
  REDIS_PASSWORD: 'test-redis-hex-value',
  JWT_ACCESS_SECRET: 'test-jwt-secret-at-least-thirty-two-characters',
  DATABASE_URL: 'postgresql://asteriq:test-postgres-hex-value@postgres:5432/asteriq',
  REDIS_URL: 'redis://:test-redis-hex-value@redis:6379',
  SITE_URL: 'https://asteriq.test',
  SMTP_URL: 'smtps://fake-user:fake-password@mail.test:465',
  AUTH_EMAIL_FROM: 'alerts@asteriq.test',
  OPENAI_API_KEY: 'test-key-not-a-real-key',
  EXPO_ACCESS_TOKEN: '',
  RUN_MIGRATIONS: 'true',
  INSTALL_NEWS_NLP: 'false',
  WEB_BIND: '127.0.0.1',
  WEB_PORT: '8080',
};
function config(override) {
  const args = [
    'compose',
    '--env-file',
    override === 'prod' ? '.env.docker.prod.example' : '.env.docker.dev.example',
    '-f',
    'docker-compose.yml',
  ];
  if (override) args.push('-f', `docker-compose.${override}.yml`);
  args.push('config', '--format', 'json');
  return JSON.parse(
    execFileSync('docker', args, {
      cwd: root,
      env: fakeEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }),
  );
}
test('all five services have health checks, persistence and an acyclic startup chain', () => {
  const cfg = config();
  assert.deepEqual(Object.keys(cfg.services).sort(), [
    'ai-service',
    'api',
    'postgres',
    'redis',
    'web',
  ]);
  for (const service of Object.values(cfg.services)) {
    assert.ok(service.healthcheck.test.length);
    assert.equal(service.restart, 'unless-stopped');
    assert.equal(service.init, true);
  }
  assert.equal(cfg.networks.data.internal, true);
  assert.equal(cfg.services.api.depends_on['ai-service'].condition, 'service_healthy');
  assert.equal(cfg.services['ai-service'].depends_on.postgres.condition, 'service_healthy');
  assert.equal(cfg.services['ai-service'].depends_on.api, undefined);
  assert.equal(cfg.services.web.depends_on.api.condition, 'service_healthy');
  assert.ok(cfg.services.postgres.volumes.some((volume) => volume.type === 'volume'));
  assert.ok(cfg.services.redis.volumes.some((volume) => volume.type === 'volume'));
  assert.ok(cfg.services['ai-service'].volumes.some((volume) => volume.type === 'volume'));
});
test('development selects reload targets and isolates source mounts from host dependencies', () => {
  const cfg = config('dev');
  for (const name of ['api', 'web', 'ai-service'])
    assert.equal(cfg.services[name].build.target, 'development');
  assert.equal(cfg.services.web.environment.VITE_API_URL, '/api/v1');
  assert.equal(cfg.services.web.environment.API_PROXY_TARGET, 'http://api:3000');
  for (const name of ['api', 'web', 'ai-service']) {
    assert.ok(cfg.services[name].volumes.some((volume) => volume.type === 'bind'));
    assert.ok(
      cfg.services[name].volumes.every((volume) => !volume.target.includes('node_modules')),
    );
  }
});
test('production has no code bind mounts or published backend/database ports', () => {
  const cfg = config('prod');
  assert.equal(cfg.name, 'asteriq-ai-prod');
  for (const [name, service] of Object.entries(cfg.services)) {
    assert.ok((service.volumes ?? []).every((volume) => volume.type !== 'bind'));
    if (name !== 'web') assert.equal(service.ports, undefined);
  }
  assert.equal(cfg.services.api.environment.NODE_ENV, 'production');
  assert.equal(cfg.services.api.environment.DEV_AUTH_TOKEN_OUTPUT, 'false');
  assert.equal(cfg.services.api.environment.AUTH_WEB_URL, 'https://asteriq.test');
  assert.equal(cfg.services.web.build.args.VITE_API_URL, '/api/v1');
  assert.ok(cfg.services.redis.command.join(' ').includes('--requirepass'));
  assert.equal(cfg.services.web.ports[0].host_ip, '127.0.0.1');
});
test('production refuses missing secrets before starting containers', () => {
  assert.throws(() =>
    execFileSync(
      'docker',
      [
        'compose',
        '--env-file',
        '.env.docker.prod.example',
        '-f',
        'docker-compose.yml',
        '-f',
        'docker-compose.prod.yml',
        'config',
        '--quiet',
      ],
      {
        cwd: root,
        env: { ...fakeEnv, POSTGRES_PASSWORD: '' },
        stdio: 'pipe',
      },
    ),
  );
});
test('Docker context excludes secrets, model artifacts and local dependency trees', () => {
  const ignore = readFileSync(resolve(root, '.dockerignore'), 'utf8');
  for (const pattern of [
    '**/.env',
    '**/node_modules',
    '.runtime',
    'apps/ai-service/artifacts',
    '**/.terraform',
    '**/*.tfstate*',
    '**/*.tfplan',
    'tests/load/users.json',
  ])
    assert.ok(ignore.includes(pattern));
  const nginx = readFileSync(resolve(root, 'infrastructure/docker/nginx.conf'), 'utf8');
  assert.ok(nginx.includes('location /api/'));
  assert.ok(nginx.includes('location /socket.io/'));
  assert.ok(nginx.includes('client_max_body_size 10m'));
});
