import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import electron from 'electron';

// Bundle the real tray controller separately, without starting the application runtime.
await build({ entryPoints: [fileURLToPath(new URL('../src/main/TrayPopover.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../out/main/island-tray-test.mjs', import.meta.url)), platform: 'node', format: 'esm', bundle: true, packages: 'external',
  plugins: [{ name: 'isolated-collection', setup(build) {
    build.onResolve({ filter: /^\.\/local-runtime$/ }, () => ({ path: 'collection', namespace: 'island-fixture' }));
    build.onLoad({ filter: /.*/, namespace: 'island-fixture' }, () => ({ contents: 'export function pokeSyncOnForeground() {}', loader: 'js' }));
  } }] });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [fileURLToPath(new URL('./island-ux-smoke.mjs', import.meta.url)), ...process.argv.slice(2)], { env, windowsHide: true, stdio: 'inherit' });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
