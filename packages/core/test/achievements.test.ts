import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateAchievements } from '../src/achievements/evaluate.js';
import type { AchievementFacts, AchievementDay } from '../src/achievements/types.js';

const day = (date: string, tokens = 1, costUsd = 0, sources: Record<string, number> = { codex: tokens }): AchievementDay => ({ date, tokens, costUsd, sources });
const facts = (overrides: Partial<AchievementFacts> = {}): AchievementFacts => ({ today: '2026-10-14', observedAt: '2026-10-14T08:00:00Z', timeZone: 'Asia/Shanghai', coverageFromDate: null, days: [], sessions: [], projects: [], missingSessionSources: [], ...overrides });
const progress = (input: AchievementFacts, id: string) => evaluateAchievements(input).progress.find(p => p.id === id)!;
const dates = (year: number, month: number, count: number) => Array.from({ length: count }, (_, i) => year + '-' + String(month).padStart(2, '0') + '-' + String(i + 1).padStart(2, '0'));

test('Token, cost and active-day awards unlock exactly at thresholds and keep earliest qualifying dates', () => {
  const input = facts({ days: [day('2026-10-01', 999999, 9.99), day('2026-10-02', 1, .01)] });
  assert.equal(progress(input, 'tokens-1000000').eligible, true);
  assert.equal(progress(input, 'tokens-1000000').achievedOn, '2026-10-02');
  assert.equal(progress(input, 'tokens-10000000').eligible, false);
  assert.equal(progress(input, 'cost-10').eligible, true);
  assert.equal(progress(input, 'active-days-7').value, 2);
  assert.equal(progress(input, 'first-record').achievedOn, '2026-10-01');
});

test('current streak permits today not used yet while historical badges survive a break through evaluation history', () => {
  const input = facts({ days: ['2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12', '2026-10-13'].map(d => day(d)) });
  assert.equal(evaluateAchievements(input).summary.currentStreak, 5);
  assert.equal(progress(input, 'streak-3').achievedOn, '2026-10-11');
  assert.equal(evaluateAchievements({ ...input, today: '2026-10-15' }).summary.currentStreak, 0);
  assert.equal(evaluateAchievements({ ...input, today: '2026-10-15' }).summary.longestStreak, 5);
});

test('February full-attendance uses leap-year length and only settles after the natural month closes', () => {
  const leap = dates(2024, 2, 29).map(d => day(d));
  const open = facts({ today: '2024-02-29', days: leap });
  assert.equal(progress(open, 'monthly-full-2024-02').target, 29);
  assert.equal(progress(open, 'monthly-full-2024-02').eligible, false);
  const closed = { ...open, today: '2024-03-01' };
  assert.equal(progress(closed, 'monthly-full-2024-02').eligible, true);
  assert.equal(progress(closed, 'monthly-full-2024-02').achievedOn, '2024-02-29');
  assert.equal(progress({ ...closed, days: leap.slice(0, 28) }, 'monthly-full-2024-02').eligible, false);
  assert.equal(progress(facts({ today: '2025-03-01', days: dates(2025, 2, 28).map(d => day(d)) }), 'monthly-full-2025-02').eligible, true);
});

test('a rolling thirty-day streak does not invent a complete natural month and twenty-day awards do not need month close', () => {
  const input = facts({ days: [...dates(2026, 9, 30).slice(14), ...dates(2026, 10, 14)].map(d => day(d)) });
  assert.equal(progress(input, 'streak-30').eligible, true);
  assert.equal(progress(input, 'monthly-full-2026-09').eligible, false);
  const twenty = facts({ today: '2026-10-20', days: dates(2026, 10, 20).map(d => day(d)) });
  assert.equal(progress(twenty, 'monthly-active-2026-10').eligible, true);
  assert.equal(progress(twenty, 'monthly-active-2026-10').achievedOn, '2026-10-20');
});

test('Agent loyalty counts distinct active days and multi-agent requires three days for every qualifying source', () => {
  const days = dates(2026, 9, 30).map((date, i) => day(date, 2, 0, { codex: 1, ...(i < 2 ? { claude: 1 } : {}), ...(i >= 27 ? { gemini: 1 } : {}) }));
  const input = facts({ days });
  assert.equal(progress(input, 'agent-loyalty-codex-30').eligible, true);
  assert.equal(progress(input, 'multi-agent-2').eligible, true);
  assert.equal(progress(input, 'multi-agent-2').achievedOn, '2026-09-30');
  assert.equal(progress(input, 'multi-agent-3').eligible, false);
  assert.equal(progress(input, 'multi-agent-3').value, 2);
});

test('scoped project awards cannot combine same-named directories', () => {
  const input = facts({ projects: [
    { id: 'a'.repeat(64), label: 'app', dates: dates(2026, 9, 30) },
    { id: 'b'.repeat(64), label: 'app', dates: dates(2026, 10, 14) },
  ] });
  assert.equal(progress(input, 'project-' + 'a'.repeat(64) + '-30').eligible, true);
  assert.equal(progress(input, 'project-' + 'b'.repeat(64) + '-30').eligible, false);
});

test('session and span milestones use distinct session facts and do not require complete source coverage', () => {
  const sessions = Array.from({ length: 10 }, (_, i) => ({ id: String(i), source: 'codex', firstAt: '2026-10-01T00:00:00Z', lastAt: '2026-10-01T01:00:00Z', durationSeconds: 3600 }));
  const input = facts({ sessions, missingSessionSources: ['cursor'] });
  assert.equal(progress(input, 'sessions-10').eligible, true);
  assert.equal(progress(input, 'duration-36000').eligible, true);
  assert.equal(progress(input, 'duration-360000').eligible, false);
  assert.equal(evaluateAchievements(input).summary.durationSeconds, 36000);
});

test('records and annual footprints preserve personal context and only close yearly awards after year end', () => {
  const input = facts({ today: '2026-01-01', days: [day('2025-12-30', 20, 1), day('2025-12-31', 30, 2), day('2026-01-01', 10, 1)] });
  const result = evaluateAchievements(input);
  assert.equal(result.records.find(r => r.id === 'longest-streak')!.value, 3);
  assert.equal(result.records.find(r => r.id === 'most-active-month')!.value, 2);
  assert.deepEqual(result.annual.find(a => a.year === 2025), { year: 2025, activeDays: 2, activeMonths: 1, tokens: 50, costUsd: 3, topSource: 'codex', fromDate: '2025-12-30', toDate: '2025-12-31', complete: true });
  assert.equal(progress(input, 'annual-2025').eligible, true);
  assert.equal(progress(input, 'annual-2026').eligible, false);
});

test('empty history shows locked targets in all non-scoped series without granting a phantom award', () => {
  const result = evaluateAchievements(facts());
  assert.equal(result.progress.some(p => p.eligible), false);
  assert.equal(result.progress.find(p => p.id === 'tokens-1000000')!.value, 0);
  assert.equal(result.summary.currentStreak, 0);
  assert.equal(result.annual[0]!.activeDays, 0);
});
