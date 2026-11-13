import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import electron from 'electron';
import { unusedPort } from './desktop-cdp.mjs';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(desktop, '../../.quotern-dev', `notifications-acceptance-${Date.now()}`);
const bundle = path.join(desktop, 'out/notifications-smoke.cjs');
await build({ entryPoints: [fileURLToPath(new URL('./notifications-smoke.ts', import.meta.url))], outfile: bundle, bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron', 'sharp'], define: { 'import.meta.url': '__notificationImportMetaUrl' }, banner: { js: "const __notificationImportMetaUrl = require('node:url').pathToFileURL(__filename).href;" }, logLevel: 'warning' });
// Core resolves its default data directory during module initialization, before
// the bundled test body runs. Set isolation before Electron imports that bundle.
const env = { ...process.env, QUOTERN_DEV_ISOLATED: '1', QUOTERN_DATA_DIR: path.join(output, 'data'), QUOTERN_CONFIG_HOME: path.join(output, 'config-home'), QUOTERN_DESKTOP_USER_DATA: path.join(output, 'profile') }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, [bundle, desktop, output, String(await unusedPort())], { env, windowsHide: true, stdio: 'inherit' });
const deadline = setTimeout(() => { child.kill(); }, 125_000); deadline.unref();
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { clearTimeout(deadline); process.exitCode = code ?? 1; });
