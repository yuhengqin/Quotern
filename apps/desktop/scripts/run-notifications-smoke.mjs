import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { unusedPort } from './desktop-cdp.mjs';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const outputArg = process.argv.slice(2).find(arg => !arg.startsWith('--'));
const output = outputArg ? path.resolve(outputArg) : path.join(desktop, '../../.quotern-dev', `notifications-acceptance-${Date.now()}`);
const bundle = path.join(desktop, 'out/notifications-smoke.cjs');
const fixture = fileURLToPath(new URL('./renderer-fixture.mjs', import.meta.url));
await build({ entryPoints: [fileURLToPath(new URL('./notifications-smoke.ts', import.meta.url))], outfile: bundle, bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['sharp'], plugins: [{ name: 'renderer-fixture-external', setup(build) { build.onResolve({ filter: /^\.\/renderer-fixture\.mjs$/ }, args => path.resolve(args.resolveDir, args.path) === fixture ? { path: fixture, external: true } : undefined); } }], define: { 'import.meta.url': '__notificationImportMetaUrl' }, banner: { js: "const __notificationImportMetaUrl = require('node:url').pathToFileURL(__filename).href;" }, logLevel: 'warning' });
// Core resolves its default data directory during module initialization, before
// the bundled test body runs. Set isolation before Node imports that bundle.
const target = path.join(desktop, 'src-tauri/target');
const triple = process.arch === 'arm64' ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc';
const executable = [process.env.QUOTERN_TEST_DESKTOP_EXECUTABLE, path.join(target, triple, 'release/Quotern.exe'), path.join(target, 'release/Quotern.exe'), path.join(target, 'debug/Quotern.exe')].find(file => file && existsSync(file));
if (process.platform === 'win32' && !executable) throw Error('Build the desktop host executable before running notifications smoke');
const env = { ...process.env, HOME: output, USERPROFILE: output, APPDATA: output, QUOTERN_DEV_ISOLATED: '1', QUOTERN_DATA_DIR: path.join(output, 'data'), QUOTERN_CONFIG_HOME: path.join(output, 'config-home'), QUOTERN_DESKTOP_USER_DATA: path.join(output, 'profile'), ...(executable && { QUOTERN_DESKTOP_EXECUTABLE: executable }) };
const child = spawn(process.execPath, [bundle, desktop, output, String(await unusedPort()), ...(process.argv.includes('--actions-only') ? ['--actions-only'] : [])], { env, windowsHide: true, stdio: 'inherit' });
const deadline = setTimeout(() => { child.kill(); }, 125_000); deadline.unref();
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('exit', code => { clearTimeout(deadline); process.exitCode = code ?? 1; });
