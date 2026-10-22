import type { DemoSnapshot } from './types.js';

type Reader = (value: unknown) => unknown;
const fail = (): never => { throw new Error('演示快照格式无效或版本不兼容'); };
const text: Reader = v => typeof v === 'string' && v.length <= 2048 ? v : fail();
const number: Reader = v => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : fail();
const boolean: Reader = v => typeof v === 'boolean' ? v : fail();
const stamp: Reader = v => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : fail();
const day: Reader = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) ? v : fail();
const optional = (reader: Reader): Reader => v => v === undefined ? undefined : reader(v);
const nullable = (reader: Reader): Reader => v => v === null ? null : reader(v);
const literal = (...values: unknown[]): Reader => v => values.includes(v) ? v : fail();
const array = (reader: Reader): Reader => v => Array.isArray(v) && v.length <= 5_000_000 ? v.map(reader) : fail();
const object = (fields: Record<string, Reader>): Reader => v => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail();
  return Object.fromEntries(Object.entries(fields).flatMap(([key, reader]) => {
    const value = reader((v as Record<string, unknown>)[key]); return value === undefined ? [] : [[key, value]];
  }));
};
const record = (reader: Reader): Reader => v => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail();
  return Object.fromEntries(Object.entries(v).map(([key, value]) => [text(key), reader(value)]));
};
const pair = (reader: Reader): Reader => v => Array.isArray(v) && v.length === 2 ? [text(v[0]), reader(v[1])] : fail();
const tokens = { input_tokens: number, output_tokens: number, cached_input_tokens: number, cache_creation_input_tokens: number, reasoning_output_tokens: number };
const pricingFact = object({ ...tokens, id: text, timestamp: stamp, requestInputTokens: optional(number), serviceTier: optional(literal('standard', 'fast', 'flex', 'unknown')), cacheWrite5mTokens: optional(number), cacheWrite1hTokens: optional(number) });
const metrics = object({ version: literal(1), requestCount: number, requestCountComplete: boolean, cacheReadComplete: boolean, cacheWriteComplete: boolean, missingReasons: array(literal('legacy_data', 'unsupported_source', 'missing_fields', 'ambiguous_request', 'invalid_usage')) });
const bucket = object({ ...tokens, hour_start: stamp, source: text, model: text, project: text, collector: optional(text), total_tokens: number, conversation_count: number, reported_cost_usd: optional(number), token_quality: optional(literal('recorded', 'estimated', 'ledger', 'mixed')), local_metrics: optional(metrics), pricing_requests: optional(array(pricingFact)) });
const identity = { source: text, sessionId: text, id: text, timestamp: stamp };
const message = object({ ...identity, role: literal('user', 'assistant'), projectId: optional(text), projectLabel: optional(text), projectKind: optional(literal('repository', 'manifest', 'unconfirmed')), projectLegacyId: optional(text), replayKey: optional(text), seq: optional(number) });
const timing = object({ ...identity, kind: literal('user', 'activity', 'task-start', 'task-end', 'task-abort'), startTimestamp: optional(stamp), turnId: optional(text), durationMs: optional(number), seq: optional(number) });
const billing = object({ service: text, mode: literal('subscription', 'api', 'unknown'), accountRef: nullable(text), accountLabel: optional(text), evidence: literal('recorded', 'unknown') });
const observation = object({ ...identity, model: text, tokens: number, usageKnown: boolean, costUsd: nullable(number), costKind: literal('recorded', 'estimated', 'unknown'), costScope: optional(literal('session-total')), costIncomplete: optional(boolean), requestKnown: optional(boolean), costBasis: optional(literal('request-facts')), tokenParts: optional(object(tokens)), pricingFact: optional(pricingFact), billing, context: optional(object({ usedTokens: nullable(number), limitTokens: nullable(number), kind: literal('recorded', 'request-input', 'post-compaction'), observedAt: stamp })), projectLabel: optional(text), profileId: optional(text), parentId: optional(text), replayKey: optional(text) });
const family = literal('first', 'tokens', 'sessions', 'active-days', 'streak', 'monthly-full', 'monthly-active', 'cost', 'duration', 'agent-loyalty', 'multi-agent', 'project', 'records', 'annual');
const progressFields = { id: text, family, category: literal('milestones', 'consistency', 'exploration', 'memories'), groupId: text, title: text, description: text, target: number, value: number, unit: text, tier: number, eligible: boolean, achievedOn: nullable(day), scope: optional(text), scopeLabel: optional(text), period: optional(text), privateScope: optional(boolean) };
const projectSetting = object({ id: text, name: optional(text), confirmed: optional(boolean), ignored: optional(boolean), mergeInto: optional(text) });
const achievements = object({
  progress: array(object(progressFields)), earned: array(object({ ...progressFields, ruleVersion: literal(1), unlockedAt: stamp, seenAt: nullable(stamp), notifiedAt: nullable(stamp), historical: boolean, snapshot: object({ value: number, coverageFromDate: nullable(day), timeZone: text }) })),
  preferences: object({ showcaseIds: array(text), celebrationsEnabled: boolean }), unreadIds: array(text),
  records: array(object({ id: literal('longest-streak', 'most-active-month'), title: text, value: number, unit: text, achievedOn: nullable(day), period: optional(text) })),
  annual: array(object({ year: number, activeDays: number, activeMonths: number, tokens: number, costUsd: number, topSource: nullable(text), fromDate: nullable(day), toDate: nullable(day), complete: boolean })),
  summary: object({ activeDays: number, currentStreak: number, longestStreak: number, totalTokens: number, totalCostUsd: number, sessionCount: number, durationSeconds: number }),
  projects: optional(array(object({ id: text, label: text, kind: literal('repository', 'manifest', 'unconfirmed'), activeDays: number, confirmed: boolean, ignored: boolean, mergeInto: optional(text) }))), projectSettings: optional(array(projectSetting)),
  coverage: object({ fromDate: nullable(day), asOfDate: day, timeZone: text, missingSessionSources: array(text), projectSources: array(text) }),
});
const rates = { input: optional(number), output: optional(number), cache_read: optional(number), cache_write: optional(number) };
const modelMetadata = object({ display_name: optional(text), canonical_model_id: optional(text), release_date: optional(text), release_date_source: optional(text), context_window: optional(number), context_window_source: optional(text), featured: optional(boolean) });
const pricing = object({ exact: record(object(rates)), alias: optional(record(text)), sourceAlias: optional(record(record(text))), fuzzy: optional(array(object({ match: text, ref: text }))), default: optional(object(rates)), _meta: optional(object({ generated_at: optional(stamp), updated_at: optional(stamp) })), model_metadata: optional(record(modelMetadata)), subscription_models: optional(record(modelMetadata)), request_rules: optional(array(object({ model: text, source: text, serviceTier: optional(literal('standard', 'fast', 'flex', 'unknown')), effectiveFrom: optional(stamp), effectiveTo: optional(stamp), minInputTokens: optional(number), rates: object({ ...rates, cache_write_1h: optional(number), cache_write_5m: optional(number) }), reference: text }))) });
const snapshot = object({ schemaVersion: literal(1), readOnly: literal(true), exportedAt: stamp, referenceTime: stamp, collectSince: stamp, lastSyncAt: nullable(stamp), buckets: array(bucket), history: object({ messages: array(message), timingEvents: array(timing), observations: array(observation), titles: array(pair(object({ title: text, priority: number }))), codexParents: array(pair(text)), missingSources: array(text) }), achievements, pricing: object({ builtin: pricing, overlay: nullable(pricing) }) });

/** Rebuild every level: unknown fields are never copied into a published bundle/API. */
export function projectDemoSnapshot(value: unknown): DemoSnapshot {
  const result = snapshot(value) as DemoSnapshot;
  if (Date.parse(result.referenceTime) > Date.parse(result.exportedAt) || Date.parse(result.collectSince) > Date.parse(result.referenceTime)) return fail();
  return result;
}
