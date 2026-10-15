import { existsSync } from 'node:fs';

const required = ['.env'];
const missing = required.filter((path) => !existsSync(path));

if (missing.length > 0) {
  console.error(
    `Missing ${missing.join(', ')}. Copy .env.example to .env and configure local values.`,
  );
  process.exitCode = 1;
} else {
  console.info('Root environment file found.');
}
