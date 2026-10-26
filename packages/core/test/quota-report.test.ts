import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { projectQuotaReport } from '../src/quota/report.js';
import { createQuotaSnapshotPublisher, readQuotaReport } from '../src/quota/snapshot.js';
import { normalizeQuotaSnapshot } from '../src/quota/shared/quota-analysis.js';
import { DEFAULT_QUOTA_PREFERENCES, type QuotaState } from '../src/quota/shared/quota.js';
import { createQuotaRuntime } from '../src/quota/runtime.js';
import { SUBSCRIPTION_CHANNELS } from '../src/quota/shared/subscription-channels.js';
import { mapDeepSeekBalance } from '../src/quota/shared/deepseek-subscription.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const now = 1792800000;
function fixture(): QuotaState {
  const provider = normalizeQuotaSnapshot('codex', 'private user@example.com', { status: 'ready', message: 'Bearer secret', fetchedAt: now,
    windows: [{ id: 'weekly', label: 'C:/private/auth.json', usedPercent: 30, resetsAt: now + 1000, durationSeconds: 604800 }] });
  provider.analyses.weekly = { etaAt: now + 500, paceDifference: 12, paceBasis: 'uniform', trend: [] };
  return { providers: [provider], notice: 'secret', preferences: { ...DEFAULT_QUOTA_PREFERENCES, profiles: [{ id: 'private', provider: 'codex', directory: 'C:/private', label: 'email', enabled: true }] } };
}

test('public quota report whitelists data and invalidates stale or reset forecasts', () => {
  const state = fixture();
  const fresh = projectQuotaReport(state, 'cli', now);
  assert.equal(fresh.providers[0].windows[0].forecast?.etaAt, now + 500);
  assert.doesNotMatch(JSON.stringify(fresh), /private|secret|Bearer|example|auth.json|preferences|notice/);
  const reset = projectQuotaReport(state, 'cli', now + 1001);
  assert.equal(reset.providers[0].windows[0].stale, true);
  assert.equal(reset.providers[0].windows[0].forecast, null);
  assert.equal(projectQuotaReport(state, 'cli', now + 1801).providers[0].stale, true);
});

test('snapshot readers select a single runtime and never create or repair missing/corrupt files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'quotern-snapshots-'));
  try {
    assert.equal((await readQuotaReport(dir, { now })).availability, 'missing');
    assert.deepEqual(await readdir(dir), []);
    const cli = createQuotaSnapshotPublisher(dir, 'cli');
    const desktop = createQuotaSnapshotPublisher(dir, 'desktop');
    await Promise.all([cli.publish(projectQuotaReport(fixture(), 'cli', now)), desktop.publish(projectQuotaReport(fixture(), 'desktop', now + 1))]);
    assert.equal((await readQuotaReport(dir, { now: now + 2 })).runtime, 'desktop');
    assert.equal((await readQuotaReport(dir, { runtime: 'cli', now })).runtime, 'cli');
    const stale = await readQuotaReport(dir, { runtime: 'cli', now: now + 1801 });
    assert.equal(stale.providers[0].windows[0].forecast, null);
    const file = path.join(dir, 'quota-snapshots', 'cli.json');
    await writeFile(file, '{broken');
    assert.equal((await readQuotaReport(dir, { runtime: 'cli', now })).availability, 'invalid');
    assert.equal(await readFile(file, 'utf8'), '{broken');
    await writeFile(file, 'x'.repeat(1024 * 1024 + 1));
    assert.equal((await readQuotaReport(dir, { runtime: 'cli', now })).availability, 'invalid');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('snapshot validation strips unknown fields and rejects invalid numeric windows', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'quotern-snapshot-validation-'));
  try {
    const publisher = createQuotaSnapshotPublisher(dir, 'cli');
    const value = projectQuotaReport(fixture(), 'cli', now);
    await publisher.publish(value);
    const file = path.join(dir, 'quota-snapshots', 'cli.json');
    const raw = JSON.parse(await readFile(file, 'utf8'));
    raw.credentials = 'Bearer secret'; raw.providers[0].email = 'private@example.com';
    await writeFile(file, JSON.stringify(raw));
    assert.doesNotMatch(JSON.stringify(await readQuotaReport(dir, { now })), /secret|private|credentials|email/);
    raw.providers[0].windows[0].usedPercent = 'NaN';
    await writeFile(file, JSON.stringify(raw));
    assert.equal((await readQuotaReport(dir, { now })).availability, 'invalid');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('reports preserve zero balances and explicit unlimited/exhausted pools without inventing percentages', () => {
  const value = fixture();
  value.providers = [normalizeQuotaSnapshot('deepseek', 'DeepSeek', { status: 'ready', fetchedAt: now,
    ...mapDeepSeekBalance({ balance_infos: [{ currency: 'CNY', total_balance: '0', granted_balance: '0', topped_up_balance: '0' }] }) }),
    normalizeQuotaSnapshot('copilot', 'Copilot', { status: 'ready', fetchedAt: now,
      limits: [{ id: 'chat', label: 'private-label', unlimited: true }, { id: 'completions', label: 'secret-label', unlimited: true, exhausted: true }] })];
  const report = projectQuotaReport(value, 'cli', now) as any;
  assert.equal(report.providers[0].windows[0].usedPercent, null);
  assert.deepEqual(report.providers[0].windows[0].balance, { currency: 'CNY', remaining: 0 });
  assert.equal(report.providers[1].details[0].valueKind, 'unlimited');
  assert.equal(report.providers[1].details[1].valueKind, 'exhausted');
  assert.doesNotMatch(JSON.stringify(report), /private-label|secret-label/);
});

test('runtime publishes an empty snapshot after all channels are disabled, including after restart', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'quotern-snapshot-disabled-'));
  const disabled = Object.fromEntries(SUBSCRIPTION_CHANNELS.map(c => [c.id, false]));
  let runtime: Awaited<ReturnType<typeof createQuotaRuntime>> | undefined;
  const waitForEmpty = async () => {
    for (let i = 0; i < 100; i++) {
      const report = await readQuotaReport(dir, { runtime: 'cli' });
      if (report.availability === 'ready' && report.providers.length === 0) return;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail('disabled providers remained in published snapshot');
  };
  try {
    const publisher = createQuotaSnapshotPublisher(dir, 'cli');
    await publisher.publish(projectQuotaReport(fixture(), 'cli'));
    runtime = await createQuotaRuntime({ directory: path.join(dir, 'quota'), snapshot: { directory: dir, runtime: 'cli' }, fetch: async () => { throw new Error('no provider requests allowed'); } });
    await runtime.setPreferences({ channels: disabled });
    await waitForEmpty();
    runtime.dispose();
    await publisher.publish(projectQuotaReport(fixture(), 'cli'));
    runtime = await createQuotaRuntime({ directory: path.join(dir, 'quota'), snapshot: { directory: dir, runtime: 'cli' }, fetch: async () => { throw new Error('no provider requests allowed'); } });
    await runtime.refresh('manual');
    await waitForEmpty();
  } finally { runtime?.dispose(); await rm(dir, { recursive: true, force: true }); }
});

test('coalesced publication retains the newest state and leaves no temporary files', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'quotern-snapshot-concurrent-'));
  try {
    const publisher = createQuotaSnapshotPublisher(dir, 'cli');
    await Promise.all(Array.from({ length: 50 }, (_, i) => publisher.publish(projectQuotaReport(fixture(), 'cli', now + i))));
    await publisher.flush();
    assert.equal((await readQuotaReport(dir, { now: now + 50 })).generatedAt, now + 49);
    assert.deepEqual(await readdir(path.join(dir, 'quota-snapshots')), ['cli.json']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('snapshot directory failures reject the batch and allow a later explicit publication', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'quotern-snapshot-failure-'));
  // Isolate the broken publisher: the regression otherwise leaves endless filesystem work.
  const source = `
    import assert from 'node:assert/strict';
    import { writeFile, unlink } from 'node:fs/promises';
    import { createQuotaSnapshotPublisher, readQuotaReport } from ${JSON.stringify(new URL('../src/quota/snapshot.js', import.meta.url).href)};
    const directory = ${JSON.stringify(dir)};
    const collision = ${JSON.stringify(path.join(dir, 'quota-snapshots'))};
    const report = ${JSON.stringify(projectQuotaReport(fixture(), 'cli', now))};
    await writeFile(collision, 'directory collision');
    const publisher = createQuotaSnapshotPublisher(directory, 'cli');
    const deadline = setTimeout(() => { console.error('PUBLISH_STILL_PENDING'); process.exit(2); }, 2000);
    await assert.rejects(publisher.publish(report), error => ['EEXIST', 'ENOTDIR'].includes(error.code));
    await publisher.flush();
    await unlink(collision);
    await publisher.publish({ ...report, generatedAt: report.generatedAt + 1 });
    assert.equal((await readQuotaReport(directory, { now: report.generatedAt + 1 })).generatedAt, report.generatedAt + 1);
    clearTimeout(deadline);
  `;
  try {
    await promisify(execFile)(process.execPath, ['--input-type=module', '-e', source], { timeout: 5000 });
    assert.deepEqual(await readdir(path.join(dir, 'quota-snapshots')), ['cli.json']);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
