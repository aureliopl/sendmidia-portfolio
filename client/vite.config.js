import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const require = createRequire(import.meta.url);
const packageInfo = require('../package.json');

function resolveBuildCommit() {
  if (process.env.GITHUB_SHA) {
    return process.env.GITHUB_SHA.slice(0, 7);
  }

  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return '';
  }
}

// Em dev, o Vite serve a UI (5173) e encaminha API e WebSocket para o Fastify (3100).
export default defineConfig({
  plugins: [react()],
  define: {
    'import.meta.env.VITE_APP_VERSION': JSON.stringify(packageInfo.version),
    'import.meta.env.VITE_APP_COMMIT': JSON.stringify(resolveBuildCommit()),
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    allowedHosts: ['localhost', '127.0.0.1'],
    proxy: {
      '/api': { target: 'http://127.0.0.1:3100', changeOrigin: true },
      '/socket.io': { target: 'http://127.0.0.1:3100', ws: true, changeOrigin: true },
    },
  },
});
