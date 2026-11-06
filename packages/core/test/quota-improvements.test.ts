import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { evaluateQuotaAlerts } from '../src/quota/shared/quota-analysis.js';
import { createWindowStarter } from '../src/agent/window-start.js';
import { patchAgentPreferences } from '../src/agent/preferences.js';
import type { QuotaState } from '../src/quota/shared/quota.js';
import { validQuotaPatch, openQuotaStore } from '../src/quota/readers/quota-store.js';
import { accountReference } from '../src/account-reference.js';
import { codexWindowIdentityMatches, windowCommand } from '../src/agent/window-identity.js';

test('window request refuses third-party routing, changed identity and alternate authentication', () => {
  const config = { model_provider: 'openai', forced_login_method: 'chatgpt', cli_auth_credentials_store: 'file' };
  const auth = { auth_mode: 'chatgpt', tokens: { access_token: 'fixture', account_id: 'fixture-account' } };
  const expected = accountReference('openai', 'fixture-account');
  assert.equal(codexWindowIdentityMatches(config, auth, expected, {}), true);
  assert.equal(codexWindowIdentityMatches({ ...config, model_provider: 'custom' }, auth, expected, {}), false);
  assert.equal(codexWindowIdentityMatches({ ...config, model_providers: { openai: { base_url: 'https://example.test' } } }, auth, expected, {}), false);
  assert.equal(codexWindowIdentityMatches(config, auth, accountReference('openai', 'other'), {}), false);
  assert.equal(codexWindowIdentityMatches(config, { ...auth, auth_mode: 'apikey' }, expected, {}), false);
  assert.equal(codexWindowIdentityMatches(config, auth, expected, { OPENAI_BASE_URL: 'https://example.test' }), false);
  assert.equal(codexWindowIdentityMatches({ ...config, cli_auth_credentials_store: 'auto' }, auth, expected, {}), false);
});

test('Windows request launch preserves empty arguments and native or shim exit codes', { skip: process.platform !== 'win32' }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-window-argv-'));
  try {
    const script = join(root, 'args.cjs');
    await writeFile(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));process.exit(7);');
    const native = windowCommand(process.execPath, [script, '--tools', '', '--setting-sources', ''], root, process.env);
    assert.equal(native.executable, process.execPath);
    const direct = spawnSync(native.executable, native.args, { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(direct.status, 7);
    assert.deepEqual(JSON.parse(direct.stdout), ['--tools', '', '--setting-sources', '']);
    const shim = join(root, 'agent.cmd');
    await writeFile(shim, '@echo off\r\n"' + process.execPath + '" "' + script + '" %*\r\nexit /b %errorlevel%\r\n');
    const wrapped = windowCommand(shim, ['--tools', '', '--setting-sources', ''], root, process.env);
    const result = spawnSync(wrapped.executable, wrapped.args, { cwd: root, encoding: 'utf8', windowsHide: true });
    assert.equal(result.status, 7, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), ['--tools', '', '--setting-sources', '']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('depletion is distinct, deduplicated within a cycle and reset permits another event', () => {
  let value = evaluateQuotaAlerts(null, { at: 1, usedPercent: 80, resetsAt: 500 }, 'five-hour');
  value = evaluateQuotaAlerts(value.observation, { at: 2, usedPercent: 100, resetsAt: 500 }, 'five-hour');
  assert.ok(value.alerts.includes('depleted'));
  value = evaluateQuotaAlerts(value.observation, { at: 3, usedPercent: 100, resetsAt: 500 }, 'five-hour');
  assert.deepEqual(value.alerts, []);
  value = evaluateQuotaAlerts(value.observation, { at: 501, usedPercent: 0, resetsAt: 1000 }, 'five-hour');
  assert.deepEqual(value.alerts, ['reset']);
  assert.ok(evaluateQuotaAlerts(value.observation, { at: 502, usedPercent: 100, resetsAt: 1000 }, 'five-hour').alerts.includes('depleted'));
});
test('quota order and density survive storage, reject duplicate or malformed IDs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-layout-'));
  try {
    assert.equal(validQuotaPatch({ providerOrder: ['claude', 'codex@work'], compact: true }), true);
    assert.equal(validQuotaPatch({ providerOrder: ['claude', 'claude'] }), false);
    assert.equal(validQuotaPatch({ providerOrder: ['../../other'] }), false);
    const store = await openQuotaStore(root);
    await store.savePreferences({ ...store.preferences, compact: true, providerOrder: ['codex', 'claude'] });
    const loaded = await openQuotaStore(root);
    assert.equal(loaded.preferences.compact, true); assert.deepEqual(loaded.preferences.providerOrder, ['codex', 'claude']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('window startup needs prior evidence, opt-in and ownership; two runtimes attempt once', async () => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-window-start-'));
  let now = 1000, count = 0, owner = true;
  const state = (reset: number | null, used: number): QuotaState => ({ preferences: { thresholdAlerts: true, resetAlerts: true, showSparkline: true, paceModel: 'uniform', channels: {} }, notice: null,
    providers: [{ id: 'claude', label: 'Claude', status: 'ready', planLabel: null, fetchedAt: now, queriedAt: now, stale: false, message: null, windows: [{ id: 'five-hour', label: '5h', usedPercent: used, resetsAt: reset }], details: [], resetCredits: null, refreshing: false, nextRefreshAt: null, analyses: {}, service: null, provenance: { source: 'native', observer: 'claude', identityVerified: true, accountRef: 'fixture-account', observedAt: now } }] });
  const deps = { now: () => now, isOwner: async () => owner, execute: async () => { count++; throw new Error('uncertain'); }, isolated: false };
  const a = createWindowStarter(root, 'cli', deps), b = createWindowStarter(root, 'desktop', deps);
  try {
    await a(state(1010, 50)); now = 1020; await a(state(1010, 0)); assert.equal(count, 0);
    await patchAgentPreferences(root, { claudeWindowStart: true });
    await a(state(null, 0)); assert.equal(count, 0);
    now = 2000; await a(state(2010, 50)); now = 2020;
    owner = false; await a(state(2010, 0)); assert.equal(count, 0);
    owner = true; await Promise.all([a(state(2010, 0)), b(state(2010, 0))]); assert.equal(count, 1);
    await createWindowStarter(root, 'cli', deps)(state(2010, 0)); assert.equal(count, 1);
    now = 3000; await a(state(3010, 20)); now = 3020;
    const stale = state(3010, 0); stale.providers[0]!.stale = true; await a(stale); assert.equal(count, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
