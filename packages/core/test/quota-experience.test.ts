import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { evaluateQuotaAlerts } from '../src/quota/shared/quota-analysis.js';
import { validQuotaPatch } from '../src/quota/readers/quota-store.js';
import { readAgentActivities, reduceAgentActivity } from '../src/agent/activity.js';
import { patchAgentPreferences } from '../src/agent/preferences.js';
import { agentHookScript } from '../src/agent/hook.js';
import { createWindowStarter, readWindowStartStatus } from '../src/agent/window-start.js';
import type { QuotaState } from '../src/quota/shared/quota.js';
import { DEFAULT_QUOTA_PREFERENCES } from '../src/quota/shared/quota.js';
import { QuotaManager, type QuotaReader, type QuotaNotification } from '../src/quota/readers/quota-manager.js';
import { markQuotaEvidence, markQuotaIdentity } from '../src/quota/readers/quota-identity.js';

test('custom account thresholds keep baseline, reset and per-cycle deduplication', () => {
  const account = `claude:${'a'.repeat(64)}`;
  assert.equal(validQuotaPatch({ accountAlerts: { [account]: { level: 'custom', thresholds: [85, 95] } } }), true);
  for (const thresholds of [[0], [100], [85,85], [1.5], [], [1,2,3,4,5,6]]) assert.equal(validQuotaPatch({ accountAlerts: { [account]: { level: 'custom', thresholds } } }), false);
  let sample = { at: 1000, usedPercent: 80, resetsAt: 2000 };
  const first = evaluateQuotaAlerts(null, sample, 'five-hour', [85]);
  assert.deepEqual(first.alerts, []);
  sample = { ...sample, at: 1010, usedPercent: 86 };
  const crossed = evaluateQuotaAlerts(first.observation, sample, 'five-hour', [85]);
  assert.deepEqual(crossed.alerts, ['threshold-85']);
  const again = evaluateQuotaAlerts(crossed.observation, { ...sample, at: 1020, usedPercent: 87 }, 'five-hour', [85]);
  assert.deepEqual(again.alerts, []);
  assert.deepEqual(evaluateQuotaAlerts(again.observation, { at: 2001, usedPercent: 0, resetsAt: 3000 }, 'five-hour', [85]).alerts, ['reset']);
  assert.deepEqual(evaluateQuotaAlerts(first.observation, { ...sample, at: 1010, usedPercent: 99 }, 'five-hour', []).alerts, []);
});

test('verified duplicates share custom thresholds and produce one notification across directories', async t => {
  let now = 1000, used = 10;
  const ref = 'a'.repeat(64), notices: QuotaNotification[] = [];
  const readers: QuotaReader[] = ['codex', 'codex@one', 'codex@two'].map(key => ({ id: 'codex', key, label: 'Codex', interval: 180, read: async () => markQuotaEvidence(markQuotaIdentity({ status: 'ready', fetchedAt: now, fiveHour: { usedPercent: used, resetsAt: 2000, windowDurationMins: 300 } }, 'same-private-account'), { source: 'native', observer: 'fixture', observedAt: now, identityVerified: true, accountRef: ref }) }));
  const manager = new QuotaManager({ readers, now: () => now, notify: value => notices.push(value), store: { preferences: { ...structuredClone(DEFAULT_QUOTA_PREFERENCES), accountAlerts: { [`codex:${ref}`]: { level: 'custom', thresholds: [85] } } }, history: {}, notice: null, async savePreferences() {}, async saveHistory() {} } });
  t.after(() => manager.dispose());
  await manager.refresh('manual'); now++; used = 86; await manager.refresh('manual');
  assert.equal(notices.length, 1); assert.equal(notices[0]?.kind, 'threshold-85');
  now++; used = 95; await manager.refresh('manual'); assert.equal(notices.length, 1);
  await manager.setPreferences({ accountAlerts: { [`codex:${ref}`]: { level: 'off' } } });
  now++; used = 99; await manager.refresh('manual'); now++; used = 100; await manager.refresh('manual'); assert.equal(notices.length, 1);
});

test('activity metadata preserves explicit tool and waiting events, without prompt/tool contents', async t => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-activity-')); t.after(() => rm(root, { recursive: true, force: true }));
  const start = reduceAgentActivity(null, { session_id: 'one', hook_event_name: 'UserPromptSubmit', cwd: 'C:\\work\\Example', prompt: 'private' }, 'claude', 1000)!;
  const tool = reduceAgentActivity(start, { session_id: 'one', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'private' } }, 'claude', 1060)!;
  assert.equal(tool.project, 'Example'); assert.equal(tool.startedAt, 1000); assert.equal(tool.state, 'tool-running');
  const result = reduceAgentActivity(tool, { session_id: 'one', hook_event_name: 'PostToolUse', tool_name: 'Bash' }, 'claude', 1070)!;
  assert.equal(result.state, 'tool-result'); assert.doesNotMatch(JSON.stringify(result), /private|success/);
  assert.equal(reduceAgentActivity(result, { session_id: 'one', hook_event_name: 'PermissionRequest', tool_name: 'Edit' }, 'claude', 1080)?.state, 'approval-requested');
  await patchAgentPreferences(root, { claudePane: true });
  const dir = join(root, 'integrations', 'observations'); await mkdir(dir);
  await writeFile(join(dir, 'a'.repeat(64) + '.json'), JSON.stringify(result));
  assert.equal((await readAgentActivities(root, 1200))[0]?.stale, true);
  const script = join(root, 'fixture.cjs'); await writeFile(script, agentHookScript());
  for (let index = 0; index < 513; index++) await writeFile(join(dir, index.toString(16).padStart(64, '0') + '.json'), JSON.stringify({ ...result, observedAt: 1 }));
  for (const [name, project] of [['d','EarlierOne'],['e','EarlierTwo']]) await writeFile(join(dir, name!.repeat(64) + '.json'), JSON.stringify({ ...result, project, sessionId: project, observedAt: Date.now() / 1000 - 10 }));
  const run = spawnSync(process.execPath, [script, root, 'claude'], { input: JSON.stringify({ session_id: 'standalone', hook_event_name: 'PreToolUse', cwd: '/work/Project', tool_name: 'Read', tool_input: { file: 'secret' } }), encoding: 'utf8', windowsHide: true });
  assert.equal(run.status, 0, run.stderr); assert.deepEqual(JSON.parse(run.stdout), {});
  const rows = await readAgentActivities(root); assert.ok(rows.some(row => row.project === 'Project' && row.state === 'tool-running'));
  assert.ok(rows.some(row => row.project === 'EarlierOne')); assert.ok(rows.some(row => row.project === 'EarlierTwo'));
  assert.doesNotMatch(JSON.stringify(rows), /secret|tool_input/);
});

test('window status reports waiting and completed requests without claiming confirmed activation', async t => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-window-state-')); t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'tud.pid'), JSON.stringify({ pid: process.pid, kind: 'cli' }));
  await patchAgentPreferences(root, { claudeWindowStart: true });
  let now = 1000;
  const state = { providers: [{ id: 'claude', status: 'ready', stale: false, refreshing: false, fetchedAt: now, provenance: { source: 'native', identityVerified: true, accountRef: 'fixture' }, windows: [{ id: 'five-hour', usedPercent: 50, resetsAt: 1010 }] }] } as QuotaState;
  const run = createWindowStarter(root, 'cli', { now: () => now, isOwner: async () => true, isolated: false, execute: async () => {} });
  await run(state);
  assert.equal((await readWindowStartStatus(root, state, now))[0]?.reason, 'waiting-reset');
  now = 1020; state.providers[0]!.fetchedAt = now; state.providers[0]!.windows[0]!.usedPercent = 0; await run(state);
  const status = (await readWindowStartStatus(root, state, now))[0]!;
  assert.equal(status.reason, 'already-attempted'); assert.equal(status.last?.outcome, 'completed');
  assert.doesNotMatch(JSON.stringify(status), /fixture|"known"|"attempted":/);
  assert.ok((await readFile(join(root, 'integrations/window-start.json'), 'utf8')).includes('completed'));
});
