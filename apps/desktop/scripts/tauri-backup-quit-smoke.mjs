import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, cp, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { launchProbe, wait } from './desktop-cdp.mjs';

assert.equal(process.platform, 'win32');
const host = resolve(process.argv[2] || 'apps/desktop/src-tauri/target/release/Quotern.exe');
const raw = process.argv.includes('--raw');
const closeMain = process.argv.includes('--close-main');
const root = await mkdtemp(join(tmpdir(), 'quotern-backup-quit-'));
const app = join(root, 'app');
const data = join(root, 'state');
const target = join(data, 'restored');
const paused = join(root, 'write-started');
const release = join(root, 'allow-write');
const sha256 = content => createHash('sha256').update(content).digest('hex');

await mkdir(app);
const installedHost = join(app, basename(host));
await copyFile(host, installedHost);
await copyFile(join(dirname(host), 'quotern-node.exe'), join(app, 'quotern-node.exe'));
await cp(join(dirname(host), 'node'), join(app, 'node'), { recursive: true });
const runtime = join(app, 'node', 'quotern-desktop-runtime.cjs');
const lastFile = 'queue/2026-11.jsonl';
// Pause an actual restore write inside the isolated copy of the bundled runtime.
const fixture = [
  "const fs = require('node:fs');",
  "const files = require('node:fs/promises');",
  "const { setTimeout: wait } = require('node:timers/promises');",
  "const original = files.writeFile;",
  "files.writeFile = async function (file, ...args) {",
  "  if (file === " + JSON.stringify(join(target, ...lastFile.split('/'))) + ") {",
  "    await original(" + JSON.stringify(paused) + ", 'waiting');",
  "    while (!fs.existsSync(" + JSON.stringify(release) + ")) await wait(25);",
  "  }",
  "  return original(file, ...args);",
  "};",
].join('\n');
await writeFile(join(app, 'node', 'slow-restore.cjs'), fixture);
await writeFile(runtime, "require('./slow-restore.cjs');\n" + await readFile(runtime, 'utf8'));

const row = JSON.stringify({
  hour_start: '2026-11-01T12:00:00.000Z', source: 'codex', model: 'fixture', project: 'restore',
  input_tokens: 100, output_tokens: 10, cached_input_tokens: 0, cache_creation_input_tokens: 0,
}) + '\n';
const contents = {
  'config.json': JSON.stringify({ statsSince: '2026-11-01T00:00:00.000Z' }) + '\n',
  [lastFile]: row,
};
const backup = {
  schemaVersion: 1,
  createdAt: new Date().toISOString(),
  files: Object.entries(contents).map(([path, content]) => ({ path, content, bytes: Buffer.byteLength(content), sha256: sha256(content) })),
};
const probe = await launchProbe(installedHost, data, { webview2: true });
const until = async (check, description) => {
  for (let attempt = 0; attempt < 160; attempt++) {
    if (await check()) return;
    await wait(100);
  }
  throw new Error('Timeout waiting for ' + description);
};
const childExited = once(probe.child, 'exit');
const marker = join(target, '.backup-restore-incomplete');
try {
  const page = await probe.connect(target => target.url.includes('tauri.localhost'));
  await until(() => page.evaluate('Boolean(window.tud?.api)'), 'desktop bridge');
  const path = '/functions/tud-local-admin/backup';
  let token;
  await until(async () => {
    const response = await page.evaluate("window.tud.api.request(" + JSON.stringify(path) + ")");
    token = response.body?.data?.token;
    return typeof token === 'string' && token.length > 0;
  }, 'backup capability');
  const init = { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Quotern-Local-Admin': token },
    body: JSON.stringify({ action: 'restore-protected', backup, target }) };
  const operation = raw
    ? 'window.__TAURI_INTERNALS__.invoke("desktop_request", { channel: "tud:api-request", args: ' + JSON.stringify([path, init]) + ' })'
    : 'window.tud.api.request(' + JSON.stringify(path) + ', ' + JSON.stringify(init) + ')';
  await page.evaluate('window.restoreResult = ' + operation + '.then(r => r, e => String(e)); true');
  await until(async () => {
    if (existsSync(paused)) return true;
    assert.equal(probe.child.exitCode, null);
    return false;
  }, 'the last restore write');
  assert.ok(existsSync(marker));
  await page.evaluate('window.tud.quit(); true').catch(() => {});
  if (closeMain) {
    await wait(250);
    await page.evaluate('window.tud.close(); true').catch(() => {});
    await until(async () => (await probe.pages().catch(() => [])).length === 0, 'the last window to close');
  }
  // The ordinary sidecar shutdown would have forced a kill after eight seconds.
  await wait(9_000);
  assert.equal(probe.child.exitCode, null, 'Quit must wait for the active restore');
  await writeFile(release, 'continue');
  await until(() => probe.child.exitCode !== null, 'graceful exit');
  assert.deepEqual(await childExited, [0, null]);
  assert.equal(existsSync(marker), false);
  for (const [path, expected] of Object.entries(contents)) {
    assert.equal(await readFile(join(target, ...path.split('/')), 'utf8'), expected);
  }
  assert.ok((await readdir(join(data, 'data', 'backups'))).some(name => name.startsWith('before-restore-') && name.endsWith('.json')));
  assert.equal(existsSync(join(data, 'data', 'tud.pid')), false);
  console.log(JSON.stringify({ transport: raw ? 'direct' : 'chunked', closeMain, waitedPastOldTimeout: true, completed: true }));
} finally {
  await writeFile(release, 'continue');
  await probe.close();
  assert.equal(dirname(await realpath(app)), await realpath(root));
  await rm(app, { recursive: true, force: true, maxRetries: 3 });
}
