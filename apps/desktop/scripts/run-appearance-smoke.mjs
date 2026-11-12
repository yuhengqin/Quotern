import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import electron from 'electron';

const main = fileURLToPath(new URL('../out/main/', import.meta.url));
await build({ entryPoints: {
  'appearance-ipc-test': fileURLToPath(new URL('../src/main/appearance-ipc.ts', import.meta.url)),
  'appearance-window-test': fileURLToPath(new URL('../src/main/DesktopWindow.ts', import.meta.url)),
  'appearance-tray-test': fileURLToPath(new URL('../src/main/TrayPopover.ts', import.meta.url)),
}, outdir: main, outExtension: { '.js': '.mjs' }, platform: 'node', format: 'esm', bundle: true, packages: 'external',
plugins: [{ name: 'isolated-collection', setup(build) {
  build.onResolve({ filter: /^\.\/local-runtime$/ }, () => ({ path: 'collection', namespace: 'appearance-fixture' }));
  build.onLoad({ filter: /.*/, namespace: 'appearance-fixture' }, () => ({ contents: 'export function pokeSyncOnForeground() {}', loader: 'js' }));
} }] });
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [fileURLToPath(new URL('./appearance-smoke.mjs', import.meta.url)), ...process.argv.slice(2)], { env, windowsHide: true, stdio: 'inherit' });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
