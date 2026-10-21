// Controlled native acceptance test; never starts Quotern's runtime or uses its profile.
import { build as bundle } from 'esbuild';
import { build } from 'vite';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temporary = path.join(desktop, '.quotern-dev');
await mkdir(temporary, { recursive: true });
const output = await mkdtemp(path.join(temporary, 'pet-pointer-smoke-'));
await build({
  configFile: false, root: path.join(desktop, 'src/renderer'), base: './', esbuild: { jsx: 'automatic' },
  build: { outDir: path.join(output, 'renderer'), emptyOutDir: false, rollupOptions: { input: path.join(desktop, 'src/renderer/pet.html') } },
});
await bundle({
  entryPoints: [path.join(desktop, 'src/preload/index.ts')], outfile: path.join(output, 'preload/index.js'),
  bundle: true, platform: 'node', format: 'cjs', external: ['electron'],
});
await bundle({
  entryPoints: [path.join(desktop, 'scripts/pet-pointer-native.ts')], outfile: path.join(output, 'main/smoke.mjs'),
  bundle: true, platform: 'node', format: 'esm', packages: 'external',
  plugins: [{
    name: 'isolated-local-runtime',
    setup(builder) {
      builder.onResolve({ filter: /^\.\/local-runtime$/ }, () => ({ path: 'local-runtime', namespace: 'fixture' }));
      builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        export const isLocalRuntimeSyncing = () => false;
        export const localApiRequest = async () => { throw new Error('collector disabled in input fixture'); };
        export const onLocalRuntimeSynced = () => () => {};
        export const onLocalRuntimeSyncActivity = () => () => {};
      ` }));
    },
  }],
});
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
delete env.ELECTRON_RENDERER_URL;
const child = spawn(createRequire(import.meta.url)('electron'), [path.join(output, 'main/smoke.mjs'), output, desktop], {
  env, stdio: 'inherit', windowsHide: true,
});
const stop = () => { child.kill(); };
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
try {
  const [code] = await once(child, 'exit');
  console.log(`Pet pointer evidence: ${output}`);
  process.exitCode = code ?? 1;
} finally {
  process.off('SIGINT', stop);
  process.off('SIGTERM', stop);
}
