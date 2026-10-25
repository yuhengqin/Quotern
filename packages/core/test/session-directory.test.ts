import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { readSessionDirectory } from '../src/session-directory.js';
import { DatabaseSync } from 'node:sqlite';

function frame(text: string): Buffer {
  const bytes = Buffer.from(text), header = Buffer.alloc(12);
  header.set([0x28, 0xb5, 0x2f, 0xfd, 0xa0]);
  header.writeUInt32LE(bytes.length, 5);
  header.writeUIntLE((bytes.length << 3) | 1, 9, 3);
  return Buffer.concat([header, bytes]);
}
async function fixture(source: string, run: (root: string, path: string) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), 'quotern-session-directory-'));
  try {
    await mkdir(join(root, 'sessions'));
    const path = join(root, 'session.jsonl');
    await writeFile(join(root, 'sessions', `${source}.json`), JSON.stringify({ files: { [path]: { context: { sessionId: 's' } } } }));
    await run(root, path);
  } finally { await rm(root, { recursive: true, force: true }); }
}
test('directory lookup supports archived Codex and DSH zstd without persisting cwd', async () => {
  for (const source of ['codex', 'dsh']) await fixture(source, async (root, path) => {
    const record = source === 'codex' ? { type: 'session_meta', payload: { id: 's', cwd: 'C:/project' } } : { type: 'session', id: 's', cwd: 'C:/project' };
    await writeFile(path + (source === 'dsh' ? '.zstd' : '.zst'), frame(JSON.stringify(record) + '\n'));
    assert.equal(await readSessionDirectory(root, source, 's'), 'C:/project');
    assert.equal(await readSessionDirectory(root, source, 'other'), null);
  });
});
test('directory prefix budgets reject oversized windows and never search beyond huge lines', async () => {
  await fixture('codex', async (root, path) => {
    const record = JSON.stringify({ type: 'session_meta', payload: { id: 's', cwd: 'C:/late' } });
    await writeFile(path, 'x'.repeat(2 * 1024 * 1024) + '\n' + record + '\n');
    assert.equal(await readSessionDirectory(root, 'codex', 's'), null);
    const enormous = frame(record + '\n'); enormous.writeUInt32LE(0x70000000, 5);
    await rm(path); await writeFile(path + '.zst', enormous);
    assert.equal(await readSessionDirectory(root, 'codex', 's'), null);
  });
});
test('directory lookup validates every concatenated frame and stops at decoded byte budget', async () => {
  await fixture('dsh', async (root, path) => {
    const first = frame(JSON.stringify({ type: 'event' }) + '\n');
    const meta = frame(JSON.stringify({ type: 'session', id: 's', cwd: 'C:/project' }) + '\n');
    await writeFile(path + '.zstd', Buffer.concat([first, meta]));
    assert.equal(await readSessionDirectory(root, 'dsh', 's'), 'C:/project');
    const padding = frame('x'.repeat(100000) + '\n');
    await writeFile(path + '.zstd', Buffer.concat([...Array.from({ length: 12 }, () => padding), meta]));
    assert.equal(await readSessionDirectory(root, 'dsh', 's'), null);
    const largeLine = 'x'.repeat(4 * 1024 * 1024) + '\n';
    const metadata = JSON.stringify({ type: 'session', id: 's', cwd: 'C:/project' }) + '\n';
    await writeFile(path + '.zstd', zstdCompressSync(metadata + largeLine));
    assert.equal(await readSessionDirectory(root, 'dsh', 's'), 'C:/project');
    await writeFile(path + '.zstd', zstdCompressSync(largeLine + metadata));
    assert.equal(await readSessionDirectory(root, 'dsh', 's'), null);
  });
});

test('directory lookup uses later Codex turn metadata and the latest matching Claude record', async () => {
  await fixture('codex', async (root, path) => {
    await writeFile(path, [
      { type: 'session_meta', payload: { id: 's', cwd: 'C:/original' } },
      { type: 'turn_context', payload: { cwd: 'C:/latest-worktree' } },
    ].map(record => JSON.stringify(record)).join('\n'));
    assert.equal(await readSessionDirectory(root, 'codex', 's'), 'C:/latest-worktree');
  });
  await fixture('claude', async (root, path) => {
    await writeFile(path, [
      { sessionId: 's', cwd: 'C:/original' },
      { sessionId: 's', cwd: 'C:/latest-project' },
      { sessionId: 'different-session', cwd: 'C:/other-session' },
    ].map(record => JSON.stringify(record)).join('\n'));
    assert.equal(await readSessionDirectory(root, 'claude', 's'), 'C:/latest-project');
  });
});

test('Codex uses its collected thread ledger cwd after a worktree handoff', async () => {
  await fixture('codex', async (root, path) => {
    const previous = process.env.CODEX_HOME;
    process.env.CODEX_HOME = root;
    try {
      await writeFile(path, JSON.stringify({ type: 'session_meta', payload: { id: 's', cwd: 'C:/original' } }) + '\n');
      const db = new DatabaseSync(join(root, 'state_5.sqlite'));
      try {
        db.exec('CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, cwd TEXT)');
        db.prepare('INSERT INTO threads VALUES (?, ?, ?)').run('s', path, 'C:/handed-off-worktree');
      } finally { db.close(); }
      assert.equal(await readSessionDirectory(root, 'codex', 's'), 'C:/handed-off-worktree');
      assert.equal(await readSessionDirectory(root, 'codex', 'not-collected'), null);
    } finally { if (previous === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = previous; }
  });
});

test('bounded tail lookup finds the latest directory and excludes another session', async () => {
  for (const source of ['codex', 'claude']) await fixture(source, async (root, path) => {
    const first = source === 'codex' ? { type: 'session_meta', payload: { id: 's', cwd: 'C:/original' } } : { sessionId: 's', cwd: 'C:/original' };
    const latest = source === 'codex' ? { type: 'turn_context', payload: { cwd: 'C:/latest' } } : { sessionId: 's', cwd: 'C:/latest' };
    const other = source === 'codex' ? { type: 'session_meta', payload: { id: 'other', cwd: 'C:/other' } } : { sessionId: 'other', cwd: 'C:/other' };
    await writeFile(path, JSON.stringify(first) + '\n' + ('{}\n'.repeat(400_000)) + JSON.stringify(latest) + '\n' + JSON.stringify(other) + '\n');
    assert.equal(await readSessionDirectory(root, source, 's'), 'C:/latest');
    assert.equal(await readSessionDirectory(root, source, 'other'), null);
  });
});

test('PI project lookup verifies the exact session header ID', async () => {
  await fixture('pi', async (root, path) => {
    await writeFile(path, JSON.stringify({ type: 'session', id: 's', cwd: 'C:/pi-project' }) + '\n');
    assert.equal(await readSessionDirectory(root, 'pi', 's'), 'C:/pi-project');
    assert.equal(await readSessionDirectory(root, 'pi', 'other'), null);
    await writeFile(path, JSON.stringify({ type: 'session', id: 'other', cwd: 'C:/wrong-project' }) + '\n');
    assert.equal(await readSessionDirectory(root, 'pi', 's'), null);
  });
});

test('ZCode directory lookup scopes a multi-session database to the selected session', async () => {
  await fixture('zcode', async (root) => {
    const path = join(root, 'sessions.sqlite');
    const db = new DatabaseSync(path);
    try {
      db.exec('CREATE TABLE session (id TEXT PRIMARY KEY, directory TEXT); CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT)');
      db.prepare('INSERT INTO session VALUES (?, ?)').run('s', 'C:/zcode-original');
      db.prepare('INSERT INTO session VALUES (?, ?)').run('other', 'C:/other-project');
      db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run('m1', 's', 1, JSON.stringify({ path: { cwd: 'C:/zcode-latest' } }));
      db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)').run('m2', 'other', 2, JSON.stringify({ path: { cwd: 'C:/unrelated-latest' } }));
    } finally { db.close(); }
    await writeFile(join(root, 'sessions', 'zcode.json'), JSON.stringify({ files: { [path]: { context: { sessionId: 'db-context-is-not-a-session' }, messages: { m1: { sessionId: 's' }, m2: { sessionId: 'other' } } } } }));
    assert.equal(await readSessionDirectory(root, 'zcode', 's'), 'C:/zcode-latest');
    assert.equal(await readSessionDirectory(root, 'zcode', 'other'), 'C:/unrelated-latest');
    assert.equal(await readSessionDirectory(root, 'zcode', 'absent'), null);
  });
});
