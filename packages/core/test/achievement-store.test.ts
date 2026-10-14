import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { AchievementStore } from '../src/achievements/store.js';
import type { AchievementFacts } from '../src/achievements/types.js';

const initialFacts = (): AchievementFacts => ({ today: '2026-10-14', observedAt: '2026-10-14T08:00:00Z', timeZone: 'Asia/Shanghai', coverageFromDate: '2025-01-01', days: [{ date: '2025-01-01', tokens: 1000000, costUsd: 10, sources: { codex: 1000000 } }], sessions: [], projects: [], missingSessionSources: [] });
async function directory(t: { after: (fn: () => unknown) => void }) {
  const dir = await mkdtemp(join(tmpdir(), 'quotern-achievements-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}

test('earned snapshots survive price changes and deleted history across independent store instances', async (t) => {
  const dir = await directory(t);
  let facts = initialFacts();
  const store = new AchievementStore(dir, async () => facts);
  const first = await store.read();
  const original = first.earned.find(item => item.id === 'cost-10')!;
  assert.equal(original.snapshot.value, 10);
  facts = { ...facts, days: [], coverageFromDate: null };
  const second = await new AchievementStore(dir, async () => facts).read();
  assert.deepEqual(second.earned.find(item => item.id === 'cost-10'), original);
  assert.equal(second.progress.find(item => item.id === 'tokens-1000000')!.eligible, true);
});

test('notice claims are shared, historical imports combine, seen state and preferences survive reopen', async (t) => {
  const dir = await directory(t), loader = async () => initialFacts();
  const one = new AchievementStore(dir, loader), two = new AchievementStore(dir, loader);
  const state = await one.read();
  const [a, b] = await Promise.all([one.update({ operation: 'claim-notice' }), two.update({ operation: 'claim-notice' })]);
  assert.equal([a, b].filter(result => result.notice!.ids.length > 0).length, 1);
  assert.equal([a, b].find(result => result.notice!.ids.length)!.notice!.historical, true);
  await one.update({ operation: 'seen', ids: ['tokens-1000000'] });
  await two.update({ operation: 'preferences', showcaseIds: ['tokens-1000000'], celebrationsEnabled: false });
  const reopened = await new AchievementStore(dir, loader).read();
  assert.equal(reopened.unreadIds.includes('tokens-1000000'), false);
  assert.deepEqual(reopened.preferences, { showcaseIds: ['tokens-1000000'], celebrationsEnabled: false });
  assert.equal(reopened.earned.length, state.earned.length);
});

test('showcase rejects locked badges, duplicates and more than three IDs without losing existing settings', async (t) => {
  const dir = await directory(t), store = new AchievementStore(dir, async () => initialFacts());
  await store.update({ operation: 'preferences', showcaseIds: ['first-record'] });
  await assert.rejects(store.update({ operation: 'preferences', showcaseIds: ['tokens-1000000000'] }));
  await assert.rejects(store.update({ operation: 'preferences', showcaseIds: ['first-record', 'first-record'] }));
  await assert.rejects(store.update({ operation: 'preferences', showcaseIds: ['first-record', 'tokens-1000000', 'cost-10', 'record-longest-streak'] }));
  assert.deepEqual((await store.read()).preferences.showcaseIds, ['first-record']);
});

test('record high watermarks survive a break while newly imported history can correct an earned date without another notice', async (t) => {
  const dir = await directory(t);
  let facts = initialFacts();
  const store = new AchievementStore(dir, async () => facts);
  await store.read(); await store.update({ operation: 'claim-notice' });
  facts = { ...facts, days: [{ date: '2024-01-01', tokens: 1000000, costUsd: 10, sources: { codex: 1000000 } }] };
  const backfilled = await store.read();
  assert.equal(backfilled.earned.find(item => item.id === 'tokens-1000000')!.achievedOn, '2024-01-01');
  assert.equal((await store.update({ operation: 'claim-notice' })).notice!.ids.includes('tokens-1000000'), false);
  facts = { ...facts, days: [] };
  assert.equal((await store.read()).records.find(record => record.id === 'longest-streak')!.value, 1);
});

test('corrupt persisted state is preserved and never silently reset', async (t) => {
  const dir = await directory(t), store = new AchievementStore(dir, async () => initialFacts());
  await store.read();
  const path = join(dir, 'achievements', 'state.json'), damaged = '{not json';
  await writeFile(path, damaged);
  await assert.rejects(store.read(), /原文件已保留/);
  assert.equal(await readFile(path, 'utf8'), damaged);
});

test('independent processes can only claim the same achievement notification once', async (t) => {
  const dir = await directory(t), input = initialFacts();
  await new AchievementStore(dir, async () => input).read();
  const moduleUrl = new URL('../src/achievements/store.js', import.meta.url).href;
  const source = 'import { AchievementStore } from ' + JSON.stringify(moduleUrl) + '; const facts=' + JSON.stringify(input) + '; const result=await new AchievementStore(' + JSON.stringify(dir) + ',async()=>facts).update({operation:"claim-notice"}); process.stdout.write(JSON.stringify(result.notice.ids));';
  const child = () => new Promise<string[]>((resolve, reject) => {
    const proc = spawn(process.execPath, ['--input-type=module', '-e', source], { windowsHide: true });
    let output = '', error = '';
    proc.stdout.on('data', chunk => { output += chunk; });
    proc.stderr.on('data', chunk => { error += chunk; });
    proc.once('error', reject);
    proc.once('exit', code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(error)));
  });
  const results = await Promise.all([child(), child(), child(), child()]);
  assert.equal(results.filter(ids => ids.length > 0).length, 1);
});

test('unconfirmed directories require confirmation; rename, ignore and restore persist without losing earned badges', async t => {
  const dir = await directory(t), id = 'a'.repeat(64);
  const facts = { ...initialFacts(), projects: [{ id, label: 'Admin', kind: 'unconfirmed', dates: Array.from({ length: 30 }, (_, i) => '2026-09-' + String(i + 1).padStart(2, '0')) }] } as AchievementFacts;
  const store = new AchievementStore(dir, async () => facts);
  assert.equal((await store.read()).earned.some(item => item.family === 'project'), false);
  await store.update({ operation: 'project', id, confirmed: true, name: '论文资料' } as any);
  const confirmed = await new AchievementStore(dir, async () => facts).read();
  assert.equal(confirmed.earned.find(item => item.family === 'project')!.scopeLabel, '论文资料');
  await store.update({ operation: 'project', id, ignored: true } as any);
  const ignored = await store.read();
  assert.equal(ignored.earned.some(item => item.family === 'project'), true);
  assert.equal((ignored as any).projects.find((item: any) => item.id === id).ignored, true);
  await store.update({ operation: 'project', id, ignored: false } as any);
  assert.equal((await store.read() as any).projects[0].ignored, false);
});

test('project merging unions dates and can be undone; aliases keep old showcase and notification state', async t => {
  const dir = await directory(t), root = 'a'.repeat(64), child = 'b'.repeat(64), other = 'c'.repeat(64);
  const dates = Array.from({ length: 30 }, (_, i) => '2026-09-' + String(i + 1).padStart(2, '0'));
  let facts: AchievementFacts = { ...initialFacts(), projects: [{ id: child, label: 'src', dates }] };
  const store = new AchievementStore(dir, async () => facts);
  await store.read();
  await store.update({ operation: 'project', id: child, confirmed: true } as any);
  await store.update({ operation: 'seen', ids: ['project-' + child + '-30'] });
  await store.update({ operation: 'preferences', showcaseIds: ['project-' + child + '-30'] });
  facts = { ...facts, projects: [{ id: root, label: 'app', dates, kind: 'repository', aliases: [child] }, { id: other, label: 'app', dates, kind: 'repository' }] as any };
  const migrated = await store.read();
  assert.deepEqual(migrated.preferences.showcaseIds, ['project-' + root + '-30']);
  assert.equal(migrated.unreadIds.includes('project-' + root + '-30'), false);
  assert.equal((await store.update({ operation: 'claim-notice' })).notice!.ids.includes('project-' + root + '-30'), false);
  await store.update({ operation: 'project', id: other, mergeInto: root } as any);
  const merged = await store.read();
  assert.equal(merged.earned.filter(item => item.family === 'project').length, 1);
  assert.equal(merged.progress.find(item => item.id === 'project-' + root + '-30')!.value, 30);
  await store.update({ operation: 'project', id: other, mergeInto: null, name: '另一个 app' } as any);
  const restored = await store.read();
  assert.equal(restored.earned.filter(item => item.family === 'project').length, 2);
  assert.equal(restored.earned.find(item => item.scope === other)!.scopeLabel, '另一个 app');
  await assert.rejects(store.update({ operation: 'project', id: root, mergeInto: other } as any).then(() => store.update({ operation: 'project', id: other, mergeInto: root } as any)), /循环/);
});

test('a later repository alias absorbs an existing manual merge without blocking reads or project settings', async t => {
  const dir = await directory(t), child = 'a'.repeat(64), root = 'b'.repeat(64);
  let facts: AchievementFacts = { ...initialFacts(), projects: [
    { id: child, label: 'src', kind: 'unconfirmed', dates: ['2026-09-01'] },
    { id: root, label: 'app', kind: 'repository', dates: ['2026-09-01'] },
  ] };
  const store = new AchievementStore(dir, async () => facts);
  await store.update({ operation: 'project', id: child, mergeInto: root, name: '组合项目' });
  facts = { ...facts, projects: [{ id: root, label: 'app', kind: 'repository', aliases: [child], dates: ['2026-09-01'] }] };
  const migrated = await store.read();
  assert.equal(migrated.projects!.length, 1);
  assert.equal(migrated.projectSettings![0]!.id, root);
  assert.equal(migrated.projectSettings![0]!.mergeInto, undefined);
  await store.update({ operation: 'project', id: root, name: '仓库项目', mergeInto: null });
  assert.equal((await store.read()).projects![0]!.label, '仓库项目');
});

test('current canonical repository evidence supersedes a previously catalogued unconfirmed subdirectory', async t => {
  const dir = await directory(t), child = 'a'.repeat(64), root = 'b'.repeat(64);
  const dates = Array.from({ length: 30 }, (_, i) => '2026-09-' + String(i + 1).padStart(2, '0'));
  let facts: AchievementFacts = { ...initialFacts(), projects: [{ id: child, label: 'src', dates }] };
  const store = new AchievementStore(dir, async () => facts);
  await store.read();
  facts = { ...facts, projects: [{ id: root, label: 'app', kind: 'repository', aliases: [child], dates }] };
  const migrated = await store.read(), project = migrated.projects!.find(item => item.id === root)!;
  assert.equal(project.kind, 'repository');
  assert.equal(project.confirmed, true);
  assert.equal(project.label, 'app');
  assert.equal(migrated.earned.some(item => item.id === 'project-' + root + '-30'), true);
});

test('undoing a merge restores each original earned date and snapshot instead of persisting the merged date', async t => {
  const dir = await directory(t), a = 'a'.repeat(64), b = 'b'.repeat(64);
  const dates = (month: string) => Array.from({ length: 30 }, (_, i) => month + '-' + String(i + 1).padStart(2, '0'));
  const facts: AchievementFacts = { ...initialFacts(), projects: [{ id: a, label: 'A', kind: 'repository', dates: dates('2026-09') }, { id: b, label: 'B', kind: 'repository', dates: dates('2026-08') }] };
  const store = new AchievementStore(dir, async () => facts);
  const original = (await store.read()).earned.filter(item => item.family === 'project');
  await store.update({ operation: 'project', id: a, mergeInto: b });
  assert.equal((await store.read()).earned.find(item => item.family === 'project')!.achievedOn, '2026-08-30');
  await store.update({ operation: 'project', id: a, mergeInto: null });
  const restored = (await store.read()).earned.filter(item => item.family === 'project');
  for (const item of original) {
    const after = restored.find(value => value.id === item.id)!;
    assert.equal(after.achievedOn, item.achievedOn);
    assert.deepEqual(after.snapshot, item.snapshot);
    assert.equal(after.unlockedAt, item.unlockedAt);
  }
});

test('a merged project displays the first qualifying union date without changing the separate original dates', async t => {
  const dir = await directory(t), a = 'a'.repeat(64), b = 'b'.repeat(64);
  const range = (month: string, start: number) => Array.from({ length: 15 }, (_, i) => month + '-' + String(start + i).padStart(2, '0'));
  const facts: AchievementFacts = { ...initialFacts(), projects: [
    { id: a, label: 'A', kind: 'repository', dates: [...range('2026-08', 1), ...range('2026-09', 1)] },
    { id: b, label: 'B', kind: 'repository', dates: [...range('2026-08', 16), ...range('2026-09', 16)] },
  ] };
  const store = new AchievementStore(dir, async () => facts);
  await store.read();
  await store.update({ operation: 'project', id: a, mergeInto: b });
  assert.equal((await store.read()).earned.find(item => item.family === 'project')!.achievedOn, '2026-08-30');
  await store.update({ operation: 'project', id: a, mergeInto: null });
  const restored = await store.read();
  assert.equal(restored.earned.find(item => item.scope === a)!.achievedOn, '2026-09-15');
  assert.equal(restored.earned.find(item => item.scope === b)!.achievedOn, '2026-09-30');
});
