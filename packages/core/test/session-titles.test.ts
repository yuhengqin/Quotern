import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { appendFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanSessionTitle, extractSessionTitle, readCodexSessionIndex, readSessionTitleDatabase } from '../src/session-titles.js';

test('Codex name index observes rename-only appends and ignores partial or unnamed entries', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-title-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'session_index.jsonl');
  await writeFile(file, JSON.stringify({ id: 's', thread_name: '原名称' }) + '\n');
  assert.equal((await readCodexSessionIndex(file)).get('s'), '原名称');
  await appendFile(file, JSON.stringify({ id: 's', thread_name: '新名称' }) + '\n' + JSON.stringify({ id: 'raw', title: 'PRIVATE_PROMPT', first_user_message: 'PRIVATE_PROMPT' }) + '\n{');
  assert.deepEqual([...await readCodexSessionIndex(file)], [['s', '新名称']]);
});

test('title database projects named metadata only and does not modify the source', async t => {
  const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
  const dir = await mkdtemp(join(tmpdir(), 'quotern-title-db-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'state.sqlite'), db = new DatabaseSync(file);
  db.exec("CREATE TABLE threads (id TEXT, name TEXT, title TEXT, first_user_message TEXT); CREATE TABLE session (id TEXT, title TEXT)");
  db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?)').run('s', '命名会话', 'PRIVATE_PROMPT', 'PRIVATE_PROMPT');
  db.prepare('INSERT INTO threads VALUES (?, ?, ?, ?)').run('raw', null, 'PRIVATE_PROMPT', 'PRIVATE_PROMPT');
  db.prepare('INSERT INTO session VALUES (?, ?)').run('o', 'OpenCode 标题');
  db.close();
  const before = await readFile(file);
  assert.deepEqual([...readSessionTitleDatabase(file, 'codex')], [['s', '命名会话']]);
  assert.deepEqual([...readSessionTitleDatabase(file, 'opencode')], [['o', 'OpenCode 标题']]);
  assert.deepEqual(await readFile(file), before);
  assert.equal(extractSessionTitle('claude', { type: 'user', message: { content: 'PRIVATE_PROMPT' } }, 's'), null);
  assert.equal(cleanSessionTitle(' \u202e标题\n文本\u0000 '), '标题 文本');
});
