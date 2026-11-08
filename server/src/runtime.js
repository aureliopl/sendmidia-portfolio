import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const instanceId = randomUUID();
export const startedAt = new Date();
export const repoRoot = path.resolve(__dirname, '../..');
export const isProd = process.env.NODE_ENV === 'production';

let buildCommit = null;
try {
  buildCommit = execSync('git rev-parse --short HEAD', {
    cwd: repoRoot,
    stdio: ['ignore', 'pipe', 'ignore'],
  })
    .toString()
    .trim();
} catch {
  buildCommit = null;
}

export { buildCommit };

export function safeError(err) {
  const statusCode = err?.output?.statusCode ?? err?.statusCode ?? null;
  const code = typeof err?.code === 'string' ? err.code : null;
  const message = typeof err?.message === 'string'
    ? err.message.replace(/\s+/g, ' ').slice(0, 200)
    : null;
  return {
    name: err?.name || 'Error',
    code,
    statusCode,
    message,
  };
}
