import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractSessionMessage, type SessionFileContext } from '../src/session-sources.js';
import { syncSessionSource } from '../src/session-collector.js';

const projectMessage = (cwd: string) => extractSessionMessage('claude', { type: 'user', uuid: 'u', timestamp: '2026-10-14T00:00:00Z', cwd, message: { content: 'hello' } }, { sessionId: 's' }) as unknown as Record<string, unknown>;

test('project roots unify repository subdirectories and linked worktrees without merging independent clones', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-project-roots-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const repo = join(dir, 'one', 'app'), other = join(dir, 'two', 'app'), worktree = join(dir, 'branch');
  await mkdir(join(repo, '.git', 'worktrees', 'branch'), { recursive: true });
  await mkdir(join(repo, 'packages', 'core'), { recursive: true });
  await mkdir(join(other, '.git'), { recursive: true });
  await mkdir(join(worktree, 'src'), { recursive: true });
  await writeFile(join(repo, 'packages', 'core', 'package.json'), '{}');
  await writeFile(join(worktree, '.git'), 'gitdir: ' + join(repo, '.git', 'worktrees', 'branch') + '\n');
  await writeFile(join(repo, '.git', 'worktrees', 'branch', 'commondir'), '../..\n');
  const root = projectMessage(repo), child = projectMessage(join(repo, 'packages', 'core')), linked = projectMessage(join(worktree, 'src'));
  assert.equal(child.projectId, root.projectId);
  assert.equal(linked.projectId, root.projectId);
  assert.equal(linked.projectLabel, 'app');
  assert.equal(child.projectKind, 'repository');
  assert.match(String(child.projectLegacyId), /^[a-f0-9]{64}$/);
  assert.notEqual(projectMessage(other).projectId, root.projectId);
  assert.equal(JSON.stringify(child).includes(repo.replace(/\\/g, '\\\\')), false);
});

test('non-repository project roots use explicit manifests while ordinary working directories need confirmation', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-project-manifest-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const root = join(dir, 'research');
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'pyproject.toml'), '[project]\nname = "research"\n');
  const project = projectMessage(join(root, 'src'));
  assert.equal(project.projectId, projectMessage(root).projectId);
  assert.equal(project.projectLabel, 'research');
  assert.equal(project.projectKind, 'manifest');
  assert.equal(projectMessage(dir).projectKind, 'unconfirmed');
});

test('raw cwd identity preserves literal percent names and unifies Windows extended and UNC paths', () => {
  const extract = (cwd: string) => extractSessionMessage('claude', { type: 'user', uuid: 'u', timestamp: '2026-10-14T00:00:00Z', cwd, message: { content: 'hello' } }, { sessionId: 's' }) as unknown as Record<string, unknown>;
  assert.notEqual(extract('/work/team%20one/app').projectId, extract('/work/team one/app').projectId);
  assert.equal(extract('D:\\Work\\app').projectId, extract('\\\\?\\D:\\Work\\app').projectId);
  assert.equal(extract('\\\\server\\share\\app').projectId, extract('\\\\?\\UNC\\server\\share\\app').projectId);
  assert.notEqual(extract('/server/share/app').projectId, extract('\\\\server\\share\\app').projectId);
});

test('project evidence separates identical folder names and normalizes Windows path casing without storing cwd', () => {
  const at = '2026-10-14T00:00:00Z';
  const extract = (cwd: string) => extractSessionMessage('claude', { type: 'user', uuid: 'u', timestamp: at, cwd, message: { content: 'hello' } }, { sessionId: 's' }) as unknown as Record<string, unknown>;
  const first = extract('D:\\Work\\one\\app');
  const same = extract('d:/work/one/app/');
  const second = extract('D:\\Work\\two\\app');
  assert.match(String(first.projectId), /^[a-f0-9]{64}$/);
  assert.equal(first.projectLabel, 'app');
  assert.equal(first.projectId, same.projectId);
  assert.notEqual(first.projectId, second.projectId);
  assert.equal(extract('app').projectId, undefined);
  assert.equal(JSON.stringify(first).includes('Work'), false);
});

test('Codex project evidence follows session metadata and turn context before logical messages', () => {
  const context: SessionFileContext = { sessionId: 'file' };
  extractSessionMessage('codex', { type: 'session_meta', payload: { id: 's', cwd: '/home/me/one/app' } }, context);
  const one = extractSessionMessage('codex', { type: 'response_item', timestamp: '2026-10-14T00:00:00Z', payload: { type: 'message', role: 'user', id: 'u', content: 'hi' } }, context) as unknown as Record<string, unknown>;
  extractSessionMessage('codex', { type: 'turn_context', payload: { cwd: '/home/me/two/app' } }, context);
  const two = extractSessionMessage('codex', { type: 'response_item', timestamp: '2026-10-14T00:01:00Z', payload: { type: 'message', role: 'assistant', id: 'a', content: 'done' } }, context) as unknown as Record<string, unknown>;
  assert.equal(one.projectLabel, 'app');
  assert.match(String(one.projectId), /^[a-f0-9]{64}$/);
  assert.notEqual(one.projectId, two.projectId);
});

test('existing v4 session snapshots are enriched from unchanged logs for project achievements', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-project-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'input.jsonl');
  await writeFile(path, JSON.stringify({ type: 'user', uuid: 'u', timestamp: '2026-10-14T00:00:00Z', cwd: '/home/me/app', message: { content: 'hi' } }) + '\n');
  const discovered = { complete: true, inputs: [{ path, sessionId: 's', kind: 'jsonl' as const }] };
  await syncSessionSource(dir, 'claude', discovered);
  const cachePath = join(dir, 'sessions', 'claude.json');
  const cached = JSON.parse(await readFile(cachePath, 'utf8'));
  cached.version = 4;
  for (const file of Object.values(cached.files) as any[]) {
    delete file.context.projectId; delete file.context.projectLabel;
    for (const message of Object.values(file.messages) as any[]) { delete message.projectId; delete message.projectLabel; }
  }
  await writeFile(cachePath, JSON.stringify(cached));
  await syncSessionSource(dir, 'claude', discovered);
  const enriched = JSON.parse(await readFile(cachePath, 'utf8'));
  const file = Object.values(enriched.files)[0] as any;
  const message = Object.values(file.messages)[0] as any;
  assert.match(message.projectId, /^[a-f0-9]{64}$/);
  assert.equal(message.projectLabel, 'app');
  assert.equal(JSON.stringify(enriched).includes('/home/me/app'), false);
});
