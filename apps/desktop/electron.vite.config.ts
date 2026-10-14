import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8'),
) as { version: string };

const sharedRenderPlugins = () => [
  tanstackRouter({
    target: 'react',
    autoCodeSplitting: true,
    routesDirectory: 'routes',
    generatedRouteTree: 'routeTree.gen.ts',
  }),
  react(),
  tailwindcss(),
];

/**
 * electron-vite 5 主配置。
 *
 * 四段式：
 *  - main:     主进程入口 src/main/index.ts        → out/main/index.js
 *  - sync-worker: `?modulePath` 打出的独立 chunk（utilityProcess）
 *  - preload:  预加载入口 src/preload/index.ts     → out/preload/index.js
 *  - renderer: index.html（面板 + 托盘）
 *
 * Main 嵌入 quotern-core（读 ~/.ai-usage，内存 local-api）；renderer 经 IPC 取数。
 *
 * quotern-core / hono 为纯 ESM（exports 仅有 import），Electron main 产物是 CJS，
 * 不能 require 它们 — 打进 main bundle，避免 ERR_PACKAGE_PATH_NOT_EXPORTED。
 */
export default defineConfig({
  main: {
    plugins: [
      externalizeDepsPlugin({
        exclude: [
          'quotern-core',
          'electron-updater',
          'hono',
        ],
      }),
    ],
    build: {
      outDir: 'out/main',
      rollupOptions: {
        external: ['sharp'],
        input: { index: resolve(__dirname, 'src/main/index.ts') },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        input: { index: resolve(__dirname, 'src/preload/index.ts') },
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: sharedRenderPlugins(),
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
    resolve: {
      alias: [
        { find: '@', replacement: resolve(__dirname, 'src/renderer') },
      ],
    },
    server: {
      host: '127.0.0.1',
      port: Number(process.env.QUOTERN_DEV_DESKTOP_PORT || 5195),
      strictPort: true,
    },
  },
});
