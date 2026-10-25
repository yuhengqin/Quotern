import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { SessionActivity } from 'quotern-core';
import { buildSessionDetail, formatExactSessionNumber, sessionDetailExport } from './session-detail.ts';

type Model = NonNullable<SessionActivity['models']>[number];
const model = (tokens: number, cost: number | null = 1): Model => ({ model: 'model-a', tokens, costUsd: cost, knownCostUsd: cost ?? 0.25, costKind: cost == null ? 'mixed' : 'estimated', requests: 1, input_tokens: tokens - 30, cached_input_tokens: 10, cache_creation_input_tokens: 0, output_tokens: 15, reasoning_output_tokens: 5, serviceTiers: ['standard'] });
const row = (): SessionActivity => ({ source: 'codex', sessionId: 'root', sessionTitle: 'Root', projectLabel: 'repo', model: 'model-a', lastActivityAt: '2026-10-25T04:00:00Z', tokens: 100, costUsd: 1, costKind: 'estimated', sharePercent: 10, models: [model(100)], detailsComplete: true, billing: { service: 'openai', mode: 'subscription', accountRef: null, evidence: 'recorded' }, context: null,
  insights: { parentId: null, relationKind: 'unknown', relationConflict: false, orphan: false, agentRole: null, agentNickname: null, workingDirectory: 'private-directory', firstActivityAt: null, messageCount: 2, ownTokens: 100, ownCostUsd: 1, subagentTokens: 40, subagentCostUsd: 0.4, combinedTokens: 160, combinedCostUsd: 1.6, combinedKnownCostUsd: 1.6, descendantCount: 2, relatedUsage: [
    { source: 'codex', sessionId: 'child', tokens: 40, costUsd: 0.4, knownCostUsd: 0.4, costKind: 'estimated', relationKind: 'subagent', agentRole: null, agentNickname: null, models: [model(40, 0.4)], detailsComplete: true },
    { source: 'codex', sessionId: 'fork', tokens: 20, costUsd: 0.2, knownCostUsd: 0.2, costKind: 'estimated', relationKind: 'fork', agentRole: null, agentNickname: null, models: [{ ...model(20, 0.2), input_tokens: 0, cached_input_tokens: 0 }], detailsComplete: true },
  ], performance: { tokensPerSecond: 60.444, estimatedRequestCount: 3, estimatedDurationMs: 33403, ttftMs: 2790.5, ttftSampleCount: 4, kind: 'estimated' }, signals: { toolCalls: 0, editTurns: null, retryTurns: null, firstPass: null, errorCount: null, compactionCount: null, costPerEdit: null, tokensPerEdit: null, coverage: 'partial' }, resumeCommand: 'codex resume root' },
});

test('thread and own views drive totals, model rows and token parts from the same members', () => {
  const sample = row(), before = JSON.stringify(sample);
  const detail = buildSessionDetail(sample, 'thread');
  assert.equal(detail.scope, 'thread');
  assert.equal(detail.usage.tokens, 160);
  assert.equal(detail.usage.models[0].tokens, 160);
  assert.equal(detail.usage.parts.input_tokens, 80);
  assert.equal(detail.usage.parts.reasoning_output_tokens, 15);
  assert.equal(detail.usage.unclassifiedTokens, 0);
  assert.deepEqual(detail.groups.map(group => [group.kind, group.tokens]), [['own', 100], ['subagent', 40], ['fork', 20]]);
  assert.equal(buildSessionDetail(sample, 'own').usage.tokens, 100);
  assert.equal(buildSessionDetail(sample, 'own').usage.models[0].tokens, 100);
  assert.equal(JSON.stringify(sample), before, 'presentation must not mutate cached snapshots');
});

test('unknown costs and missing categories remain unknown while known subtotals survive', () => {
  const sample = row(), child = sample.insights!.relatedUsage![0];
  child.costUsd = null; child.knownCostUsd = 0.25; child.models = [{ ...model(40, null), cached_input_tokens: null }];
  const detail = buildSessionDetail(sample, 'thread');
  assert.equal(detail.usage.costUsd, null);
  assert.equal(detail.usage.knownCostUsd, 1.45);
  assert.equal(detail.usage.models[0].costUsd, null);
  assert.equal(detail.usage.parts.cached_input_tokens, null);
  assert.equal(detail.usage.parts.cache_creation_input_tokens, 0);
  assert.equal(detail.usage.unclassifiedTokens, null);
});

test('session-level recorded costs are not added to model estimates twice', () => {
  const sample = row(); sample.costUsd = 5; sample.costKind = 'recorded'; sample.unallocatedCostUsd = 5; sample.insights!.ownCostUsd = 5;
  const detail = buildSessionDetail(sample, 'own');
  assert.equal(detail.usage.costUsd, 5);
  assert.equal(detail.usage.unallocatedCostUsd, 5);
  assert.equal(detail.usage.models[0].costUsd, 1, 'model estimate stays available with the allocation explanation');
  assert.equal(detail.usage.costKind, 'recorded');
});

test('old runtimes fall back to own details without pretending incomplete members form a thread', () => {
  const sample = row(); delete sample.insights!.relatedUsage;
  const detail = buildSessionDetail(sample, 'thread');
  assert.equal(detail.threadAvailable, false);
  assert.equal(detail.scope, 'own');
  assert.equal(detail.usage.tokens, 100);
  assert.equal(detail.legacyCombined?.tokens, 160);
});

test('missing model data cannot become zero token categories and unmatched usage remains visible', () => {
  const sample = row(); sample.models = []; sample.detailsComplete = false;
  const detail = buildSessionDetail(sample, 'own');
  assert.equal(detail.usage.parts.input_tokens, null);
  assert.equal(detail.usage.missingModelTokens, 100);
  const partial = row(); partial.models![0].tokens = 90;
  assert.equal(buildSessionDetail(partial, 'own').usage.missingModelTokens, 10);
});

test('unconfirmed relations and same IDs in different sources are kept as separate contributions', () => {
  const sample = row(); sample.insights!.relatedUsage!.push({ ...sample.insights!.relatedUsage![0], source: 'claude', relationKind: 'unknown' }); sample.insights!.descendantCount++;
  const detail = buildSessionDetail(sample, 'thread');
  assert.equal(detail.usage.tokens, 200);
  assert.equal(detail.groups.find(group => group.kind === 'unknown')?.tokens, 40);
});

test('exact values and copied details retain source precision and exclude private directories', () => {
  assert.equal(formatExactSessionNumber(0.0000000123456789, 'en'), '0.0000000123456789');
  assert.equal(formatExactSessionNumber(1234567, 'en'), '1,234,567');
  assert.equal(formatExactSessionNumber(null, 'en'), '—');
  const sample = row(); sample.insights!.ownCostUsd = 1.234567891234;
  const exported = JSON.parse(sessionDetailExport(sample, 'own', { fromDate: '2026-10-25', toDate: '2026-10-25', kind: 'selected' }));
  assert.equal(exported.usage.costUsd, 1.234567891234);
  assert.equal(exported.performance.ttftMs, 2790.5);
  assert.equal(exported.range.kind, 'selected');
  assert.equal(JSON.stringify(exported).includes('private-directory'), false);
});

test('copied attribution follows the selected scope and retains exact task timing', () => {
  const sample = row(); sample.taskSeconds = 119.125; sample.taskTimingKind = 'recorded';
  const own = JSON.parse(sessionDetailExport(sample, 'own', undefined));
  assert.deepEqual(own.attribution.map((group: { kind: string }) => group.kind), ['own']);
  assert.equal(own.taskSeconds, 119.125);
  assert.equal(own.taskTimingKind, 'recorded');
  const thread = JSON.parse(sessionDetailExport(sample, 'thread', undefined));
  assert.deepEqual(thread.attribution.map((group: { kind: string }) => group.kind), ['own', 'subagent', 'fork']);
  assert.equal(thread.attribution.reduce((total: number, group: { tokens: number }) => total + group.tokens, 0), thread.usage.tokens);
});
