import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createDataBackup, restoreDataBackup, verifyDataBackup } from '../src/backup.js';
import * as backupModule from '../src/backup.js';
import { withDataTransaction } from '../src/data-transaction.js';
import { readSessionHistory, syncSessionSource } from '../src/session-collector.js';

const row = { hour_start: '2026-11-01T00:00:00Z', source: 'codex', model: 'test-model', project: 'sample', input_tokens: 10, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 10, conversation_count: 1 };
async function fixture(run: (root: string, dir: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'quotern-backup-')), dir = join(root, 'data');
  try {
    await mkdir(join(dir, 'queue'), { recursive: true });
    await writeFile(join(dir, 'config.json'), JSON.stringify({ statsSince: '2026-01-01T00:00:00Z', localCollectSince: '2026-01-01T00:00:00Z', deviceId: 'private-device', pricing: { url: 'https://secret@example.invalid' } }));
    await writeFile(join(dir, 'queue/2026-11.jsonl'), JSON.stringify(row) + '\n');
    await writeFile(join(dir, 'cursors.json'), JSON.stringify({ codex: {} }));
    await writeFile(join(dir, 'auth.json'), '{"secret":"must-not-export"}');
    await run(root, dir);
  } finally { await rm(root, { recursive: true, force: true }); }
}

async function collectSession(root: string, dir: string) {
  const input = join(root, 'codex.jsonl');
  const timestamp = '2026-11-01T00:00:00Z';
  await writeFile(input, [
    { type: 'session_meta', timestamp, payload: { id: 'backup-session', cwd: '/sample' } },
    { type: 'response_item', timestamp, payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'Check the generated files' }] } },
    { type: 'response_item', timestamp, payload: { type: 'function_call', name: 'functions.grep', call_id: 'scan', arguments: JSON.stringify({ path: '/sample/dist', pattern: 'example' }) } },
    { type: 'response_item', timestamp, payload: { type: 'function_call_output', call_id: 'scan', output: 'example result' } },
  ].map(value => JSON.stringify(value)).join('\n') + '\n');
  await syncSessionSource(dir, 'codex', { complete: true, inputs: [{ path: input, sessionId: 'backup-session', kind: 'jsonl' }] });
}

test('backup round trip preserves collected data, excludes credentials and restores exclusively', async () => fixture(async (root, dir) => {
  const backup = await createDataBackup(dir), summary = verifyDataBackup(backup);
  assert.equal(summary.fileCount, 3);
  assert.equal(JSON.stringify(backup).includes('secret'), false);
  const target = join(root, 'restored');
  await restoreDataBackup(backup, target);
  assert.equal(await readFile(join(target, 'queue/2026-11.jsonl'), 'utf8'), await readFile(join(dir, 'queue/2026-11.jsonl'), 'utf8'));
  await assert.rejects(restoreDataBackup(backup, target), /BACKUP_TARGET_EXISTS/);
  await assert.rejects(restoreDataBackup(backup, dir), /BACKUP_TARGET_EXISTS/);
}));

test('v1 preview derives actual usage dates and bounded sources from validated contents, not configuration', async () => fixture(async (root, dir) => {
  await collectSession(root, dir);
  await writeFile(join(dir, 'queue/2026-11.jsonl'), [row, { ...row, hour_start: '2026-11-03T12:00:00Z', source: 'claude' }, { ...row, source: 'x'.repeat(5000) }].map(value => JSON.stringify(value)).join('\n'));
  const backup = await createDataBackup(dir);
  const contents = (verifyDataBackup(backup) as unknown as { contents: { usageRows: number; from: string | null; to: string | null; sources: string[]; sourcesTruncated: boolean; categories: { kind: string; files: number }[] } }).contents;
  assert.equal(contents.usageRows, 3);
  assert.equal(contents.from, '2026-11-01T00:00:00.000Z');
  assert.equal(contents.to, '2026-11-03T12:00:00.000Z');
  assert.deepEqual(contents.sources, ['claude', 'codex']);
  assert.equal(contents.sourcesTruncated, true);
  assert.ok(contents.categories.some(value => value.kind === 'sessions' && value.files === 1));
  const empty = verifyDataBackup({ ...backup, files: backup.files.filter(file => file.path === 'config.json') }) as unknown as { contents: typeof contents };
  assert.equal(empty.contents.from, null); assert.equal(empty.contents.to, null); assert.equal(empty.contents.usageRows, 0);
}));

test('protected restore persists current contents separately and retains the snapshot path after a restore conflict', async () => fixture(async (root, dir) => {
  const restore = (backupModule as unknown as { restoreDataBackupWithProtection: (backup: unknown, target: string, dir: string) => Promise<{ protection: { path: string }; restore: { ok: boolean; code?: string; target?: string } }> }).restoreDataBackupWithProtection;
  assert.equal(typeof restore, 'function');
  const backup = await createDataBackup(dir);
  await writeFile(join(dir, 'queue/2026-11.jsonl'), JSON.stringify({ ...row, input_tokens: 99 }) + '\n');
  const target = join(root, 'protected-restored');
  const result = await restore(backup, target, dir);
  assert.equal(result.restore.ok, true);
  const protection = JSON.parse(await readFile(result.protection.path, 'utf8'));
  assert.ok(protection.files.find((file: { path: string }) => file.path.startsWith('queue/')).content.includes('99'));
  assert.equal(await readFile(join(target, 'queue/2026-11.jsonl'), 'utf8'), backup.files.find(file => file.path.startsWith('queue/'))!.content);
  const conflict = await restore(backup, target, dir);
  assert.deepEqual(conflict.restore, { ok: false, code: 'BACKUP_TARGET_EXISTS' });
  verifyDataBackup(JSON.parse(await readFile(conflict.protection.path, 'utf8')));
}));

test('a failed protection write prevents creation of the restore target', async () => fixture(async (root, dir) => {
  const restore = (backupModule as unknown as { restoreDataBackupWithProtection: (backup: unknown, target: string, dir: string) => Promise<unknown> }).restoreDataBackupWithProtection;
  assert.equal(typeof restore, 'function');
  const backup = await createDataBackup(dir), target = join(root, 'should-not-exist');
  await writeFile(join(dir, 'backups'), 'occupied');
  await assert.rejects(restore(backup, target, dir), /BACKUP_PROTECTION_FAILED/);
  await assert.rejects(stat(target), { code: 'ENOENT' });
}));

test('backup round trip preserves the current collected session format and tool results', async () => fixture(async (root, dir) => {
  await collectSession(root, dir);
  const before = await readSessionHistory(dir, ['codex']);
  assert.ok(before.evidence.some(event => event.kind === 'tool' && event.operation?.kind === 'scan'));
  assert.ok(before.evidence.some(event => event.kind === 'tool-result' && event.operation?.kind === 'result'));
  const backup = await createDataBackup(dir);
  verifyDataBackup(backup);
  const target = join(root, 'sessions-restored');
  await restoreDataBackup(backup, target);
  assert.deepEqual(await readSessionHistory(target, ['codex']), before);
  assert.equal(await readFile(join(target, 'sessions/codex.json'), 'utf8'), await readFile(join(dir, 'sessions/codex.json'), 'utf8'));
}));

test('backup rejects malformed session operations even when their hashes are valid', async () => fixture(async (root, dir) => {
  await collectSession(root, dir);
  // A legacy version isolates nested validation from current-version compatibility.
  const sessionPath = join(dir, 'sessions/codex.json');
  const legacy = JSON.parse(await readFile(sessionPath, 'utf8'));
  legacy.version = 11;
  for (const file of Object.values(legacy.files) as { evidence: Record<string, { kind: string }> }[]) {
    file.evidence = Object.fromEntries(Object.entries(file.evidence).filter(([, event]) => event.kind !== 'tool-result'));
  }
  await writeFile(sessionPath, JSON.stringify(legacy));
  const original = await createDataBackup(dir);
  for (const malformed of [
    { kind: 'unsupported' }, { tool: { bad: true } }, { targetKey: [] }, { targetLabel: {} },
    { generated: 'yes' }, { outputChars: -1 }, { outputFingerprint: {} },
    { dispatchSource: 'unknown' }, { dispatchSessionId: {} }, { projectKey: {} },
  ]) {
    const backup = structuredClone(original);
    const member = backup.files.find(file => file.path === 'sessions/codex.json')!;
    const snapshot = JSON.parse(member.content);
    const file = Object.values(snapshot.files)[0] as { evidence: Record<string, { kind: string; operation: object }> };
    Object.assign(Object.values(file.evidence).find(event => event.kind === 'tool')!.operation, malformed);
    member.content = JSON.stringify(snapshot);
    member.bytes = Buffer.byteLength(member.content);
    member.sha256 = createHash('sha256').update(member.content).digest('hex');
    assert.throws(() => verifyDataBackup(backup), /BACKUP_CONTENT_INVALID/, JSON.stringify(malformed));
    const target = join(root, 'invalid-operation');
    await assert.rejects(restoreDataBackup(backup, target), /BACKUP_CONTENT_INVALID/);
    await assert.rejects(stat(target), { code: 'ENOENT' });
  }
}));

test('backup validation rejects hash corruption, traversal, duplicate members and invalid structures', async () => fixture(async (_root, dir) => {
  const original = await createDataBackup(dir);
  for (const mutate of [
    (b: typeof original) => { b.files[0]!.content += ' '; },
    (b: typeof original) => { b.files[0]!.path = '../config.json'; },
    (b: typeof original) => { b.files.push(b.files[0]!); },
    (b: typeof original) => { b.files[0]!.bytes = 1_000_000_000; },
    (b: typeof original) => { b.schemaVersion = 2 as 1; },
    (b: typeof original) => { const file = b.files.find(f => f.path === 'config.json')!; file.content = '{"pricing":{"url":"credential"}}'; file.bytes = Buffer.byteLength(file.content); file.sha256 = createHash('sha256').update(file.content).digest('hex'); },
  ]) { const copy = structuredClone(original); mutate(copy); assert.throws(() => verifyDataBackup(copy), /BACKUP_/); }
}));

test('backup waits for an entire cooperating collection transaction', async () => fixture(async (_root, dir) => {
  let entered!: () => void, finish!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), gate = new Promise<void>(resolve => { finish = resolve; });
  const writer = withDataTransaction(dir, async () => {
    await writeFile(join(dir, 'queue/2026-11.jsonl'), JSON.stringify({ ...row, input_tokens: 20, total_tokens: 20 }) + '\n');
    entered(); await gate;
    await writeFile(join(dir, 'cursors.json'), '{"codex":{"checkpoint":20}}');
  });
  await started;
  let completed = false;
  const pending = createDataBackup(dir).then(backup => { completed = true; return backup; });
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(completed, false, 'snapshot must not read partially updated collection files');
  finish(); await writer;
  const backup = await pending;
  assert.ok(backup.files.find(file => file.path === 'cursors.json')!.content.includes('checkpoint'));
}));

test('valid hashes do not make malformed stored structures restorable', async () => fixture(async (root, dir) => {
  const original = await createDataBackup(dir);
  for (const [path, value] of [
    ['sessions/codex.json', { version: 11, source: 'codex', complete: true, files: { x: null } }],
    ['sessions/codex.json', { version: 11, source: 'codex', complete: true, files: { x: { context: {}, messages: { x: null } } } }],
    ['achievements/state.json', { version: 1, earned: [], preferences: {} }],
    ['cursors.json', { codex: { files: { x: null } } }],
  ] as const) {
    const backup = structuredClone(original), content = JSON.stringify(value);
    backup.files = backup.files.filter(file => file.path !== path);
    backup.files.push({ path, content, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex') });
    assert.throws(() => verifyDataBackup(backup), /BACKUP_CONTENT_INVALID/);
    await assert.rejects(restoreDataBackup(backup, join(root, 'invalid')), /BACKUP_CONTENT_INVALID/);
  }
}));

test('backup refuses linked source directories', async () => fixture(async (root, dir) => {
  const outside = join(root, 'outside'); await mkdir(outside);
  await writeFile(join(outside, 'codex.json'), '{"source":"codex","version":11,"files":{}}');
  await symlink(outside, join(dir, 'sessions'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(createDataBackup(dir), /BACKUP_LINK/);
}));

test('Desktop backup retains its separate quota store without replacing CLI quota history', async () => fixture(async (root, dir) => {
  const desktopQuotaDirectory = join(root, 'electron', 'quota');
  await mkdir(desktopQuotaDirectory, { recursive: true });
  const history = { 'codex:account:five-hour': [{ at: 1000, usedPercent: 20, resetsAt: 2000 }] };
  await writeFile(join(desktopQuotaDirectory, 'history.json'), JSON.stringify(history));
  await mkdir(join(dir, 'quota'));
  await writeFile(join(dir, 'quota/history.json'), '{}');
  const backup = await createDataBackup(dir, { desktopQuotaDirectory });
  const restored = join(root, 'desktop-restored');
  await restoreDataBackup(backup, restored);
  assert.deepEqual(JSON.parse(await readFile(join(restored, 'desktop/quota/history.json'), 'utf8')), history);
  assert.equal(await readFile(join(restored, 'quota/history.json'), 'utf8'), '{}');
  assert.equal(verifyDataBackup(await createDataBackup(restored)).fileCount, 5);
}));
