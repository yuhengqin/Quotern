import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import electron from 'electron';
import { unusedPort } from './desktop-cdp.mjs';

const desktop = fileURLToPath(new URL('../', import.meta.url));
if (process.platform !== 'win32') throw new Error('This opt-in native acceptance harness requires Windows.');
const output = process.argv[2] ? path.resolve(process.argv[2]) : path.join(desktop, '../../.quotern-dev', `notification-native-${Date.now()}`);
const bundle = path.join(desktop, 'out/notifications-native-live.cjs');
await build({ entryPoints: [fileURLToPath(new URL('./notifications-native-live.ts', import.meta.url))], outfile: bundle, bundle: true, platform: 'node', target: 'node22', format: 'cjs', external: ['electron', 'sharp'], define: { 'import.meta.url': '__notificationImportMetaUrl' }, banner: { js: "const __notificationImportMetaUrl = require('node:url').pathToFileURL(__filename).href;" }, logLevel: 'warning' });
const appId = `dev.quotern.desktop.acceptance.${randomUUID()}`;
const env = { ...process.env, QUOTERN_DEV_ISOLATED: '1', QUOTERN_DATA_DIR: path.join(output, 'data'), QUOTERN_CONFIG_HOME: path.join(output, 'config-home'), QUOTERN_DESKTOP_USER_DATA: path.join(output, 'profile'), QUOTERN_NATIVE_APP_ID: appId }; delete env.ELECTRON_RUN_AS_NODE;
const registryKey = `HKCU\\Software\\Classes\\AppUserModelId\\${appId}`;
const run = promisify(execFile);
// Only register this unique test identity. Production uses its installer shortcut.
if (process.platform === 'win32') {
  await run('reg.exe', ['add', registryKey, '/v', 'DisplayName', '/t', 'REG_SZ', '/d', 'Quotern 通知验收', '/f'], { windowsHide: true });
  await run('reg.exe', ['add', registryKey, '/v', 'IconUri', '/t', 'REG_SZ', '/d', path.join(desktop, 'resources/icon.png'), '/f'], { windowsHide: true });
}
console.log(JSON.stringify({ output }));
const child = spawn(electron, [bundle, desktop, output, String(await unusedPort())], { env, windowsHide: true, stdio: 'inherit' });
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('close', async code => {
  if (process.platform === 'win32') await run('reg.exe', ['delete', registryKey, '/f'], { windowsHide: true }).catch(error => console.error('Owned notification identity cleanup failed:', error.message));
  process.exitCode = code ?? 1;
});
