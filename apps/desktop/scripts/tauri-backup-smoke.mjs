import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchProbe, wait } from './desktop-cdp.mjs';

const root = await mkdtemp(join(tmpdir(), 'quotern-tauri-backup-'));
const executable = resolve(process.argv[2] || 'apps/desktop/src-tauri/target/debug/Quotern.exe');
const probe = await launchProbe(executable, root, { webview2: true });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
try {
  const client = await probe.connect(page => page.url.includes('tauri.localhost'));
  for (let retry = 0; retry < 150; retry++) {
    if (await client.evaluate('Boolean(window.tud?.api)')) break;
    await wait(100);
  }
  assert.equal((await client.evaluate("window.tud.api.request('/health')")).status, 200);
  const queue = join(root, 'data', 'queue');
  await mkdir(queue, { recursive: true });
  const files = new Map();
  for (const month of ['01', '02']) {
    const row = JSON.stringify({
      hour_start: '2026-' + month + '-01T12:00:00.000Z', source: 'codex', model: 'synthetic',
      project: '备份🧪', input_tokens: 5, output_tokens: 10, cached_input_tokens: 0, cache_creation_input_tokens: 0,
    });
    const contents = Buffer.from(row + ' '.repeat(34 * 1024 * 1024) + '\n');
    const file = '2026-' + month + '.jsonl';
    files.set(file, sha256(contents));
    await writeFile(join(queue, file), contents);
  }
  const target = join(root, 'restored');
  const call = (action) => client.evaluate(`(async () => {
    const path = '/functions/tud-local-admin/backup';
    const capabilities = (await window.tud.api.request(path)).body.data;
    const action = ${JSON.stringify(action)};
    const input = action === 'create' ? {action} : {action, backup: window.__reviewBackup};
    if (action === 'restore-protected') input.target = ${JSON.stringify(target)};
    const {status, body} = await window.tud.api.request(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Quotern-Local-Admin': capabilities.token },
      body: JSON.stringify(input)
    });
    if (action === 'create' && status === 200) {
      window.__reviewBackup = body.data.backup;
      return {status, fingerprint: body.data.summary.fingerprint, rawBytes: body.data.summary.bytes};
    }
    return {status, ...body.data};
  })()`);
  const created = await call('create');
  assert.equal(created.status, 200);
  assert.ok(created.rawBytes > 64 * 1024 * 1024);
  const verified = await call('verify');
  assert.equal(verified.status, 200);
  assert.equal(verified.fingerprint, created.fingerprint);
  const restored = await call('restore-protected');
  assert.equal(restored.status, 200);
  assert.equal(restored.restore.ok, true);
  assert.equal(restored.restore.summary.fingerprint, created.fingerprint);
  await access(restored.protection.path);
  for (const [file, expected] of files) assert.equal(sha256(await readFile(join(target, 'queue', file))), expected);
  assert.equal((await client.evaluate("window.tud.api.request('/health')")).status, 200);
  console.log(JSON.stringify({ rawBytes: created.rawBytes, fingerprint: created.fingerprint, restored: true }));
} finally {
  await probe.close();
}
await assert.rejects(access(join(root, 'data', 'tud.pid')), { code: 'ENOENT' });
