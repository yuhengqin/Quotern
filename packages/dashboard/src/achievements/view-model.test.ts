import assert from 'node:assert/strict';
import { test } from 'node:test';
import { groupAchievements, closestAchievements, formatAchievementAmount } from './view-model.ts';
import * as viewModel from './view-model.ts';
import { buildAchievementShare } from './share-model.ts';
import type { AchievementSnapshot, AchievementProgress, EarnedAchievement } from 'quotern-core/achievements';

const badge = (id: string, target: number, value: number, eligible = false, overrides: Partial<AchievementProgress> = {}): AchievementProgress => ({ id, family: 'tokens', category: 'milestones', groupId: 'tokens', title: id, description: 'rule', target, value, unit: 'Token', tier: target, eligible, achievedOn: eligible ? '2026-09-01' : null, ...overrides });
const earned = (item: AchievementProgress): EarnedAchievement => ({ ...item, ruleVersion: 1, unlockedAt: '2026-09-01T00:00:00Z', seenAt: null, notifiedAt: null, historical: true, snapshot: { value: item.value, timeZone: 'Asia/Shanghai', coverageFromDate: '2026-01-01' } });
const snapshot = (progress: AchievementProgress[]): AchievementSnapshot => ({
  progress, earned: progress.filter(item => item.eligible).map(earned), records: [], annual: [], preferences: { showcaseIds: [], celebrationsEnabled: true }, unreadIds: [],
  summary: { activeDays: 20, currentStreak: 3, longestStreak: 7, totalTokens: 1234567, totalCostUsd: 1000.25, sessionCount: 100, durationSeconds: 36000 },
  coverage: { fromDate: '2026-01-01', asOfDate: '2026-10-14', timeZone: 'Asia/Shanghai', missingSessionSources: [], projectSources: ['claude', 'codex'] },
});

test('collection groups tiers around the highest owned badge and the next locked target', () => {
  const result = groupAchievements(snapshot([badge('tokens-100', 100, 250, true), badge('tokens-1000', 1000, 250), badge('tokens-200', 200, 250, true)]));
  assert.equal(result.length, 1);
  assert.equal(result[0]!.featured.id, 'tokens-200');
  assert.equal(result[0]!.next!.id, 'tokens-1000');
  assert.deepEqual(result[0]!.items.map(item => item.id), ['tokens-100', 'tokens-200', 'tokens-1000']);
  assert.equal(result[0]!.earnedCount, 2);
});

test('closest targets exclude finished historical months, spending/time and return at most three distinct groups', () => {
  const state = snapshot([
    badge('tokens-100', 100, 90),
    badge('active-days-30', 30, 29, false, { family: 'active-days', groupId: 'active-days' }),
    badge('streak-7', 7, 6, false, { family: 'streak', groupId: 'streak' }),
    badge('cost-1000', 1000, 999, false, { family: 'cost', groupId: 'cost' }),
    badge('monthly-full-2026-09', 30, 29, false, { family: 'monthly-full', groupId: 'monthly-full-2026-09', period: '2026-09' }),
    badge('sessions-100', 100, 50, false, { family: 'sessions', groupId: 'sessions' }),
  ]);
  assert.deepEqual(closestAchievements(state).map(item => item.id), ['active-days-30', 'tokens-100', 'streak-7']);
  assert.equal(formatAchievementAmount(36000, '秒'), '10');
});

test('share projection omits hidden money and project identity before anything reaches the export DOM', () => {
  const state = snapshot([
    badge('cost-1000', 1000, 1000.25, true, { family: 'cost', title: '千美元算力足迹', unit: 'USD', groupId: 'cost' }),
    badge('project-private-30', 30, 30, true, { family: 'project', groupId: 'project-private', scope: 'privatehash', scopeLabel: 'secret-repository', privateScope: true, unit: '天' }),
  ]);
  state.preferences.showcaseIds = state.earned.map(item => item.id);
  const projected = buildAchievementShare(state, { kind: 'showcase' });
  const raw = JSON.stringify(projected);
  assert.equal(raw.includes('1000.25'), false);
  assert.equal(raw.includes('secret-repository'), false);
  assert.equal(raw.includes('privatehash'), false);
  assert.equal(raw.includes('千美元'), false);
  assert.equal(projected.badges.length, 2);
  const visible = JSON.stringify(buildAchievementShare(state, { kind: 'showcase' }, { showCost: true, showProjects: true }));
  assert.equal(visible.includes('secret-repository'), true);
  assert.equal(visible.includes('1000.25'), true);
});

test('sharing a locked badge or empty shelf fails explicitly, while annual cards use the selected year', () => {
  const state = snapshot([badge('tokens-1000', 1000, 250)]);
  assert.throws(() => buildAchievementShare(state, { kind: 'single', id: 'tokens-1000' }));
  assert.throws(() => buildAchievementShare(state, { kind: 'showcase' }));
  state.annual = [{ year: 2025, activeDays: 12, activeMonths: 2, tokens: 999, costUsd: 88, topSource: 'codex', fromDate: '2025-01-01', toDate: '2025-02-01', complete: true }];
  const result = buildAchievementShare(state, { kind: 'annual', year: 2025 });
  assert.equal(result.title, '2025 年度足迹');
  assert.equal(JSON.stringify(result).includes('999'), true);
  assert.equal(JSON.stringify(result).includes('1000.25'), false);
});

test('annual badge captions identify the year of earning instead of presenting lifetime totals as annual usage', () => {
  const state = snapshot([badge('active-days-100', 100, 102, true, { family: 'active-days', title: '百日同行', unit: '天', achievedOn: '2025-12-20' })]);
  state.annual = [{ year: 2025, activeDays: 30, activeMonths: 1, tokens: 999, costUsd: 88, topSource: 'codex', fromDate: '2025-12-01', toDate: '2025-12-30', complete: true }];
  const result = buildAchievementShare(state, { kind: 'annual', year: 2025 });
  assert.equal(result.badges[0]!.subtitle, '2025-12-20 点亮');
  assert.equal(JSON.stringify(result).includes('102'), false);
});

test('collection aggregates Agent, project and month records into one card per family without dropping levels', () => {
  const state = snapshot([
    badge('agent-codex-30', 30, 44, true, { family: 'agent-loyalty', groupId: 'agent-codex', scope: 'codex', tier: 1 }),
    badge('agent-codex-100', 100, 44, false, { family: 'agent-loyalty', groupId: 'agent-codex', scope: 'codex', tier: 2 }),
    badge('agent-claude-30', 30, 26, false, { family: 'agent-loyalty', groupId: 'agent-claude', scope: 'claude', tier: 1 }),
    badge('project-a-30', 30, 5, false, { family: 'project', groupId: 'project-a', scope: 'a' }),
    badge('project-b-30', 30, 9, false, { family: 'project', groupId: 'project-b', scope: 'b' }),
    badge('month-09', 20, 20, true, { family: 'monthly-active', groupId: 'month-09', period: '2026-09' }),
    badge('month-10', 20, 10, false, { family: 'monthly-active', groupId: 'month-10', period: '2026-10' }),
  ]);
  const result = groupAchievements(state);
  assert.equal(result.length, 3);
  const agents = result.find(group => group.family === 'agent-loyalty')! as any;
  assert.equal(agents.records.length, 2);
  assert.equal(agents.items.length, 3);
  assert.equal(agents.earnedObjectCount, 1);
  assert.equal(agents.next.id, 'agent-claude-30');
});

test('closest targets show at most one object per series and skip expired monthly records', () => {
  const state = snapshot([
    badge('agent-codex', 30, 29, false, { family: 'agent-loyalty', groupId: 'agent-codex' }),
    badge('agent-claude', 30, 28, false, { family: 'agent-loyalty', groupId: 'agent-claude' }),
    badge('tokens', 100, 80), badge('sessions', 100, 70, false, { family: 'sessions', groupId: 'sessions' }),
  ]);
  assert.deepEqual(closestAchievements(state).map(item => item.id), ['agent-codex', 'tokens', 'sessions']);
});

test('recommended showcase chooses different series while explicit sharing preserves repeated series selections', () => {
  const state = snapshot([
    badge('agent-codex', 30, 30, true, { family: 'agent-loyalty', scope: 'codex', scopeLabel: 'codex' }),
    badge('agent-claude', 30, 30, true, { family: 'agent-loyalty', scope: 'claude', scopeLabel: 'claude' }),
    badge('tokens', 100, 100, true), badge('streak', 7, 7, true, { family: 'streak' }),
  ]);
  assert.equal(typeof (viewModel as any).recommendShowcase, 'function');
  const ids: string[] = (viewModel as any).recommendShowcase(state);
  assert.equal(ids.length, 3);
  assert.equal(new Set(ids.map(id => state.earned.find(item => item.id === id)!.family)).size, 3);
  state.preferences.showcaseIds = ['agent-codex', 'agent-claude'];
  const shared = buildAchievementShare(state, { kind: 'showcase' });
  assert.equal(shared.badges.length, 2);
  assert.equal(shared.badges[0]!.title, 'agent-codex · Codex');
  assert.equal(shared.badges[1]!.title, 'agent-claude · Claude');
});

test('project-family share privacy applies to older records even when their privateScope flag is absent', () => {
  const state = snapshot([badge('legacy-project', 30, 30, true, { family: 'project', scope: 'legacy-id', scopeLabel: 'confidential-project', title: '项目长跑' })]);
  assert.equal(JSON.stringify(buildAchievementShare(state, { kind: 'single', id: 'legacy-project' })).includes('confidential-project'), false);
  assert.equal(buildAchievementShare(state, { kind: 'single', id: 'legacy-project' }, { showCost: false, showProjects: true }).badges[0]!.title, '项目长跑 · confidential-project');
});

test('detail status filtering separates owned levels, current goals and expired periods', () => {
  const matches = (viewModel as any).achievementMatchesStatus;
  assert.equal(typeof matches, 'function');
  const owned = badge('owned', 30, 44, true), goal = badge('goal', 100, 44), expired = badge('old-month', 31, 20, false, { period: '2026-09' });
  assert.equal(matches(owned, 'current', '2026-10-15'), false);
  assert.equal(matches(goal, 'current', '2026-10-15'), true);
  assert.equal(matches(expired, 'current', '2026-10-15'), false);
  assert.equal(matches(expired, 'expired', '2026-10-15'), true);
  assert.equal(matches(owned, 'earned', '2026-10-15'), true);
  assert.equal(matches(goal, 'earned', '2026-10-15'), false);
});
