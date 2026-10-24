import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));

function buildId() {
  if (process.env.BUILD_ID) return process.env.BUILD_ID;
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 12);
  try {
    return execSync('git rev-parse --short=12 HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return 'dev';
  }
}

export default defineConfig(({ command }) => ({
  root,
  base: './',
  publicDir: 'public',
  define: {
    __BUILD_ID__: JSON.stringify(command === 'build' ? buildId() : 'dev'),
  },
  server: { host: true, port: 5173, fs: { allow: [fileURLToPath(new URL('..', import.meta.url))] } },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome106',
    cssTarget: 'chrome61',
    modulePreload: { polyfill: false },
    sourcemap: false,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('index.html', import.meta.url)),
        admin: fileURLToPath(new URL('admin/index.html', import.meta.url)),
      },
    },
  },
}));
