import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { coreSourcePlugin } from '../../scripts/vite-core-source.mjs';
import { createDemoInitialChunk, demoPreloadPlugin } from '../../scripts/demo-preload.mjs';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string };

const rootDir = path.dirname(fileURLToPath(import.meta.url));

/**
 * Vite `base` — asset URLs in built HTML/JS only.
 * SPA route prefix is `VITE_ROUTER_BASE` (see src/router.tsx).
 *
 * Priority (first non-empty wins):
 *   1. `PUBLIC_PATH` — CDN override (absolute URL); not set by npm scripts
 *   2. `VITE_BASE` — from `build` (CLI `/`)
 *   3. `/`
 */
function resolveAssetBase(raw: string | undefined): string {
  const value = (raw ?? '/').trim() || '/';
  if (value === '/') return '/';
  return value.endsWith('/') ? value : `${value}/`;
}

function pickAssetBase(env: Record<string, string>): string {
  return resolveAssetBase(env.PUBLIC_PATH || env.VITE_BASE);
}

export default defineConfig(({ mode }) => {
  // loadEnv merges `.env*` under process.env (existing keys win).
  const env = loadEnv(mode, rootDir, '');

  return {
    base: pickAssetBase(env),
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    plugins: [
      coreSourcePlugin(),
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
      }),
      react(),
      tailwindcss(),
      demoPreloadPlugin(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(rootDir, './src'),
      },
    },
    server: {
      host: env.QUOTERN_DEV_HOST?.trim() || '127.0.0.1',
      port: Number(env.QUOTERN_DEV_UI_PORT || 5194),
      strictPort: true,
      proxy: {
        '/functions': {
          target: env.VITE_CLI_API_ORIGIN || 'http://127.0.0.1:8252',
          changeOrigin: false,
        },
        '/health': env.VITE_CLI_API_ORIGIN || 'http://127.0.0.1:8252',
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
      // The public-IP demo uses HTTP/1; normal CLI/Desktop builds keep their chunk strategy.
      rollupOptions: env.QUOTERN_DEMO_BUILD === '1' ? { output: { manualChunks: createDemoInitialChunk(), onlyExplicitManualChunks: true } } : undefined,
    },
  };
});
