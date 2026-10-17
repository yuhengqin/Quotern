import assert from 'node:assert/strict';
import test from 'node:test';
import type { QuotaAnalysis, QuotaProviderState, QuotaWindow } from '../../shared/quota';
import { normalizeQuotaSnapshot } from '../../shared/quota-analysis';
import { mapGrokBilling } from '../../shared/grok-subscription';
import { commonQuotaResetAt, isQuotaStatusOnly, quotaDisplayDetails, quotaForecasts, quotaTrendWindows, sortQuotaWindows } from './quota-presentation';

const window = (id: string, resetsAt: number | null, timeKind?: 'reset' | 'expiry'): QuotaWindow => ({ id, label: id, usedPercent: 40, resetsAt, timeKind });

test('groups only providers without quota readings, benefits or reset-credit information as status rows', () => {
  const empty = { windows: [], details: [], resetCredits: null };
  assert.equal(isQuotaStatusOnly(empty), true);
  assert.equal(isQuotaStatusOnly({ ...empty, windows: [{ ...window('weekly', null), usedPercent: 100 }] }), false);
  assert.equal(isQuotaStatusOnly({ ...empty, details: [{ id: 'completions', label: '代码补全', text: '无限', resetsAt: null }] }), false);
  assert.equal(isQuotaStatusOnly({ ...empty, resetCredits: 0 }), false);
  assert.equal(isQuotaStatusOnly({ ...empty, resetCredits: 3 }), false);
});

test('combines reset times only when every displayed pool has the same exact reset timestamp', () => {
  assert.equal(commonQuotaResetAt([window('a', 1_900_000_000), window('b', 1_900_000_000)]), 1_900_000_000);
  assert.equal(commonQuotaResetAt([window('a', 1_900_000_000), window('b', 1_900_000_001)]), null);
  assert.equal(commonQuotaResetAt([window('a', 1_900_000_000), window('b', null)]), null);
  assert.equal(commonQuotaResetAt([window('a', 1_900_000_000)]), null);
  assert.equal(commonQuotaResetAt([]), null);
});

test('never labels expiration or invalid timestamps as a shared reset', () => {
  assert.equal(commonQuotaResetAt([window('a', 1_900_000_000), window('b', 1_900_000_000, 'expiry')]), null);
  assert.equal(commonQuotaResetAt([window('a', 1_900_000_000, 'expiry'), window('b', 1_900_000_000, 'expiry')]), null);
  for (const invalid of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(commonQuotaResetAt([window('a', invalid), window('b', invalid)]), null);
  }
});

const now = 1_900_000_000;
const period = (id: string, label: string, seconds: number | null): QuotaWindow => ({ ...window(id, now + 7200), label, durationSeconds: seconds });
const forecast = (etaAt: number): QuotaAnalysis => ({ etaAt, paceDifference: null, paceBasis: 'uniform', trend: [] });

test('orders calendar limits from month to week to day to hours without mutating data or unrelated model order', () => {
  const windows = [period('five-hour', '5h', 18000), period('monthly', '月限额', null), period('daily', '日限额', 86400), period('weekly', '7d', 604800)];
  assert.deepEqual(sortQuotaWindows(windows).map((w: QuotaWindow) => w.id), ['monthly', 'weekly', 'daily', 'five-hour']);
  assert.deepEqual(windows.map(w => w.id), ['five-hour', 'monthly', 'daily', 'weekly']);
  const models = [period('flash', '模型额度', 18000), period('pro', '模型额度', 18000)];
  assert.deepEqual(sortQuotaWindows(models), models);
});

test('retains a long-cycle forecast when it can run out before the short-cycle reset, and selects one earliest forecast per scope', () => {
  const windows = [period('five-hour', '5h', 18000), period('weekly', '7d', 604800)];
  const eta = quotaForecasts('kimi', windows, { 'five-hour': forecast(now + 1800), weekly: forecast(now + 600) }, now);
  assert.deepEqual([...eta], [['weekly', now + 600]]);
});

test('does not extrapolate a long-cycle forecast across a short-cycle reset or exhausted pool', () => {
  const short = period('five-hour', '5h', 18000), long = { ...period('weekly', '7d', 604800), resetsAt: now + 4 * 86400 };
  const select = quotaForecasts;
  assert.equal(select('kimi', [short, long], { weekly: forecast(now + 10800) }, now).size, 0);
  assert.equal(select('kimi', [{ ...short, usedPercent: 100 }, long], { weekly: forecast(now + 600) }, now).size, 0);
  assert.equal(select('kimi', [{ ...short, resetsAt: null }, long], { weekly: forecast(now + 600) }, now).size, 0);
  assert.equal(select('kimi', [short], { 'five-hour': forecast(now - 1) }, now).size, 0);
});

test('Grok billing cycles share the session constraint even without a named month period', () => {
  const snapshot = mapGrokBilling({ config: { usagePeriods: [
    { type: 'SESSION', start: now - 10800, end: now + 7200, usagePercent: 40 },
    { type: 'BILLING', start: now - 26 * 86400, end: now + 4 * 86400, usagePercent: 80 },
  ] } });
  const { windows } = normalizeQuotaSnapshot('grok', 'Grok', snapshot);
  assert.deepEqual(windows.map(w => w.id), ['session', 'billing']);
  assert.equal(quotaForecasts('grok', windows, { billing: forecast(now + 10800) }, now).size, 0);
  assert.equal(quotaForecasts('grok', windows.map(w => w.id === 'session' ? { ...w, usedPercent: 100 } : w), { billing: forecast(now + 600) }, now).size, 0);
  assert.equal(quotaForecasts('grok', windows.map(w => w.id === 'session' ? { ...w, resetsAt: null } : w), { billing: forecast(now + 600) }, now).size, 0);
});

test('keeps independent model and feature forecasts separate from account forecasts', () => {
  const windows = [period('account:18000', '5h', 18000),
    { ...period('model:opus:weekly', '7d', 604800), groupLabel: 'Opus' },
    { ...period('feature:review:604800', '7d', 604800), groupLabel: 'Review' },
    { ...period('feature:review:18000', '5h', 18000), groupLabel: 'Review' }];
  const analyses = Object.fromEntries(windows.map(w => [w.id, forecast(now + (w.id.endsWith('604800') ? 900 : 600))]));
  assert.deepEqual([...quotaForecasts('codex', windows, analyses, now).keys()], ['account:18000', 'model:opus:weekly', 'feature:review:18000']);
  const models = ['pro', 'flash'].map(id => ({ ...period(id, '模型额度', 18000), groupLabel: id }));
  assert.equal(quotaForecasts('antigravity', models, Object.fromEntries(models.map(w => [w.id, forecast(now + 600)])), now).size, 2);
});

test('only merges explicitly unlimited Copilot chat and completions, preserving finite, unknown and exhausted entries', () => {
  const details: QuotaProviderState['details'] = [
    { id: 'chat', label: 'Chat', text: '无限', valueKind: 'unlimited', resetsAt: null },
    { id: 'completions', label: '内联建议', text: '无限', valueKind: 'unlimited', resetsAt: null },
  ];
  const select = quotaDisplayDetails;
  assert.deepEqual(select('copilot', details), [{ id: 'chat-completions', label: '聊天与代码补全', text: '无限', valueKind: 'unlimited', resetsAt: null }]);
  for (const text of ['50%', '未知', '已用尽']) {
    assert.equal(select('copilot', [details[0], { ...details[1], text, valueKind: text === '已用尽' ? 'exhausted' : undefined }]).length, 2);
  }
  assert.equal(select('copilot', [details[0]]).length, 1);
  assert.equal(select('cursor', details).length, 2);
  assert.deepEqual(details.map(d => d.label), ['Chat', '内联建议']);
});

test('selects only the shortest cycle in one pool, independently of history availability', () => {
  const windows = [period('monthly', '月限额', null), period('weekly', '7d', 604800), period('daily', '日限额', 86400), period('five-hour', '5h', 18000)];
  assert.deepEqual([...quotaTrendWindows('kimi', windows)], ['five-hour']);
  assert.deepEqual([...quotaTrendWindows('kimi', windows.slice(0, 3))], ['daily']);
  assert.deepEqual([...quotaTrendWindows('kimi', windows.slice(0, 2))], ['weekly']);
  assert.deepEqual([...quotaTrendWindows('kimi', windows.slice(0, 1))], ['monthly']);
  assert.deepEqual(windows.map(w => w.id), ['monthly', 'weekly', 'daily', 'five-hour']);
});

test('keeps independent model pools and Codex feature pools separate for trends', () => {
  const models = ['pro', 'flash', 'sonnet'].map(id => ({ ...period(id, '模型额度', 18000), groupLabel: id }));
  assert.deepEqual([...quotaTrendWindows('antigravity', models)], ['pro', 'flash', 'sonnet']);
  assert.deepEqual([...quotaTrendWindows('cursor', [period('cursorModels', 'Cursor', null), period('otherModels', 'Other', null)])], ['cursorModels', 'otherModels']);
  const windows = [period('account:604800', '7d', 604800), period('account:18000', '5h', 18000),
    { ...period('feature:review:604800', '7d', 604800), groupLabel: 'Review' },
    { ...period('feature:review:18000', '5h', 18000), groupLabel: 'Review' },
    { ...period('model:opus:weekly', '7d', 604800), groupLabel: 'Opus' }];
  assert.deepEqual([...quotaTrendWindows('codex', windows)], ['account:18000', 'feature:review:18000', 'model:opus:weekly']);
});

test('uses actual cycle duration and does not hide eligible tied or unknown independent pools', () => {
  const windows = [period('a', '5h', 5400), period('b', '2h', 7200), { ...period('balance', '余额', null), analysisEligible: false }];
  assert.deepEqual([...quotaTrendWindows('codex', windows)], ['a']);
  assert.deepEqual([...quotaTrendWindows('codex', [period('a', '5h', 18000), period('b', '5h', 18000)])], ['a', 'b']);
  assert.deepEqual([...quotaTrendWindows('grok', [period('billing', '周期', null), period('session', '5h', 18000)])], ['session']);
  assert.deepEqual([...quotaTrendWindows('grok', [period('billing', '周期', null)])], ['billing']);
  assert.deepEqual([...quotaTrendWindows('kimi', [])], []);
});
