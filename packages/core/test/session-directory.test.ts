import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zstdCompressSync } from 'node:zlib';
import { readSessionDirectory } from '../src/session-directory.js';

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
