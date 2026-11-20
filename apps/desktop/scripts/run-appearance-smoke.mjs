import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const main = fileURLToPath(new URL('../out/main/', import.meta.url));
await build({ entryPoints: {
  'appearance-shared-test': fileURLToPath(new URL('../src/shared/appearance.ts', import.meta.url)),
  'appearance-store-test': fileURLToPath(new URL('../src/main/appearance-store.ts', import.meta.url)),
  'appearance-controller-test': fileURLToPath(new URL('../src/main/appearance-controller.ts', import.meta.url)),
}, outdir: main, outExtension: { '.js': '.mjs' }, platform: 'node', format: 'esm', bundle: true, packages: 'external' });
await import('./appearance-smoke.mjs');
