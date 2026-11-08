import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdir, open } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const data = path.join(root, 'data');
await mkdir(data, { recursive: true });
const database = path.join(data, 'sendmidia.db');
await (await open(database, 'a')).close();
const require = createRequire(import.meta.url);
const result = spawnSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', 'server/prisma/schema.prisma'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, DATABASE_URL: `file:${database}` },
});
process.exitCode = result.status ?? 1;
