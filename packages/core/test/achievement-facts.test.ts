import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAchievementFacts } from '../src/achievements/facts.js';
import type { QueueBucket } from '../src/types.js';
import type { SessionMessage } from '../src/session-metrics.js';

const row = (date: string, tokens: number, source = 'codex'): QueueBucket => ({ source, model: 'gpt-5', project: 'app', hour_start: date, input_tokens: tokens, output_tokens: 0, cached_input_tokens: 0, cache_creation_input_tokens: 0, reasoning_output_tokens: 0, total_tokens: 9999999, conversation_count: 1 });
const message = (id: string, timestamp: string, source = 'codex', sessionId = 's'): SessionMessage => ({ id, timestamp, source, sessionId, role: 'user' });
const now = new Date('2026-10-14T08:00:00Z');

test('achievement facts use latest bucket versions and five Token fields across full history, excluding invalid/future dates', () => {
  const facts = buildAchievementFacts([
    row('2025-01-01T00:00:00Z', 100), row('2025-01-01T00:00:00Z', 250),
    row('2026-10-13T16:00:00Z', 50), row('2026-10-13T17:00:00Z', 0),
    row('2026-10-15T00:00:00Z', 1000), row('invalid', 1000),
  ], [], ['cursor'], now);
  assert.equal(facts.coverageFromDate, '2025-01-01');
  assert.deepEqual(facts.days.map(d => [d.date, d.tokens]), [['2025-01-01', 250], ['2026-10-14', 50]]);
  assert.deepEqual(facts.days[1]!.sources, { codex: 50 });
  assert.deepEqual(facts.missingSessionSources, ['cursor']);
});

test('achievement facts namespace sessions, deduplicate final message snapshots and keep honest span totals', () => {
  const facts = buildAchievementFacts([], [
    message('u', '2026-10-13T15:59:00Z'), message('a', '2026-10-13T16:01:00Z'),
    message('a', '2026-10-13T16:02:00Z'), message('u', '2026-10-13T15:59:00Z', 'claude'),
    message('bad', 'invalid'), message('future', '2027-01-01T00:00:00Z'),
  ], [], now);
  assert.equal(facts.sessions.length, 2);
  assert.equal(facts.sessions.find(s => s.source === 'codex')!.durationSeconds, 180);
  assert.equal(facts.sessions.find(s => s.source === 'claude')!.durationSeconds, 0);
});

test('project active dates use hashed identities instead of merging equal display labels', () => {
  const first = 'a'.repeat(64), second = 'b'.repeat(64);
  const facts = buildAchievementFacts([], [
    { ...message('u', '2026-10-12T00:00:00Z'), projectId: first, projectLabel: 'app' },
    { ...message('a', '2026-10-12T00:01:00Z'), projectId: first, projectLabel: 'app' },
    { ...message('v', '2026-10-13T00:00:00Z', 'claude'), projectId: second, projectLabel: 'app' },
    message('unknown', '2026-10-13T00:01:00Z'),
  ], [], now);
  assert.deepEqual(facts.projects.map(p => [p.id, p.dates]), [[first, ['2026-10-12']], [second, ['2026-10-13']]]);
});
