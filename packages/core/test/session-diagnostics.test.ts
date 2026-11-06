import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichSessionInsights, extractSessionEvidence } from '../src/session-insights.js';
import type { SessionActivity } from '../src/session-observation.js';
import { sessionDispatches } from '../src/session-dispatch.js';

const clock = (n: number) => new Date(Date.UTC(2026, 10, 6, 10, 0, n)).toISOString();
const row = (id = 'parent', source = 'claude'): SessionActivity => ({ source, sessionId: id, projectLabel: 'repo', model: 'test', lastActivityAt: clock(50), tokens: 1000, costUsd: null, costKind: 'unknown', context: null, sharePercent: null, billing: { service: 'unknown', mode: 'unknown', accountRef: null, evidence: 'unknown' } });
const call = (id: string, name: string, input: unknown, n: number) => ({ type: 'assistant', timestamp: clock(n), cwd: 'C:/private/repo', message: { content: [{ type: 'tool_use', id, name, input }] } });
const result = (id: string, content: unknown, n: number) => ({ type: 'user', timestamp: clock(n), message: { content: [{ type: 'tool_result', tool_use_id: id, content }] } });
const facts = (records: Record<string, unknown>[]) => { const context = { sessionId: 'parent' }; return records.flatMap(record => extractSessionEvidence('claude', record, context)); };
const findings = (r: SessionActivity): { code: string; count: number; evidence: unknown[] }[] => Reflect.get(r.insights!, 'diagnostics')?.findings ?? [];

test('repeated reads and large/repeated outputs retain bounded evidence, never raw content', () => {
  const events = facts([call('a', 'Read', { file_path: 'C:/private/repo/src/app.ts' }, 1), result('a', 'PRIVATE_OUTPUT'.repeat(2000), 2), call('b', 'Read', { file_path: 'C:/private/repo/src/app.ts' }, 3), result('b', 'PRIVATE_OUTPUT'.repeat(2000), 4)]);
  const r = row(); enrichSessionInsights([r], [], [...events, ...events]);
  assert.ok(findings(r).some(f => f.code === 'repeated-read' && f.count === 1));
  assert.ok(findings(r).some(f => f.code === 'large-output'));
  assert.ok(findings(r).some(f => f.code === 'repeated-output' && f.count === 1));
  assert.ok(!JSON.stringify(events).includes('PRIVATE_OUTPUT'));
  assert.ok(!JSON.stringify(events.filter(e => e.kind !== 'metadata')).includes('C:/private'));
});

test('read ranges and intervening writes are not treated as avoidable repeated reads', () => {
  const r = row();
  enrichSessionInsights([r], [], facts([call('a', 'Read', { file_path: 'a.ts', offset: 1, limit: 20 }, 1), call('b', 'Read', { file_path: 'a.ts', offset: 21, limit: 20 }, 2), call('c', 'Edit', { file_path: 'a.ts', old_string: 'secret' }, 3), call('d', 'Read', { file_path: 'a.ts', offset: 1, limit: 20 }, 4)]));
  assert.ok(!findings(r).some(f => f.code === 'repeated-read'));
});

test('generated-directory scans are flagged only for observed targets, not exclusion patterns', () => {
  const r = row();
  enrichSessionInsights([r], [], facts([call('a', 'Grep', { path: 'repo/node_modules', pattern: 'secret' }, 1), call('b', 'Bash', { command: 'rg pattern src -g "!node_modules/**"' }, 2)]));
  assert.equal(findings(r).find(f => f.code === 'generated-scan')?.count, 1);
});

test('cross-tool dispatch uses explicit returned identity without adding it to same-source totals', () => {
  const parent = row(), child = row('12345678-abcd-4abc-9abc-123456789abc', 'codex'); child.tokens = 300;
  const events = facts([call('exec', 'Bash', { command: 'codex exec --json "PRIVATE_PROMPT"' }, 1), result('exec', '{"type":"thread.started","thread_id":"12345678-abcd-4abc-9abc-123456789abc"}', 2)]);
  enrichSessionInsights([parent, child], [], events);
  const links = Reflect.get(parent.insights!, 'dispatches');
  assert.equal(links?.[0]?.sessionId, child.sessionId);
  assert.equal(links[0].evidence, 'recorded');
  assert.equal(links[0].tokens, 300);
  assert.equal(parent.insights?.combinedTokens, 1000);
  assert.ok(!JSON.stringify(events).includes('PRIVATE_PROMPT'));
});

test('time and project correlation stays inferred; ambiguous targets remain unlinked', () => {
  const parent = row(), child = row('child', 'codex');
  const events = facts([call('exec', 'Bash', { command: 'codex exec "do work"' }, 1)]);
  const context = { sessionId: 'child' };
  events.push(...extractSessionEvidence('codex', { type: 'session_meta', timestamp: clock(2), payload: { id: 'child', cwd: 'C:/private/repo' } }, context));
  enrichSessionInsights([parent, child], [], events);
  assert.equal(Reflect.get(parent.insights!, 'dispatches')?.[0]?.evidence, 'inferred');
  const other = row('other', 'codex');
  events.push(...extractSessionEvidence('codex', { type: 'session_meta', timestamp: clock(3), payload: { id: 'other', cwd: 'C:/private/repo' } }, { sessionId: 'other' }));
  enrichSessionInsights([parent, child, other], [], events);
  assert.deepEqual(Reflect.get(parent.insights!, 'dispatches'), []);
});

test('dispatch keeps partially priced target costs as a known subtotal', () => {
  const parent = row(), child = row('child', 'antigravity');
  child.costUsd = 1;
  child.models = [{ costUsd: 1 }, { costUsd: null }] as NonNullable<SessionActivity['models']>;
  const links = sessionDispatches(parent, [{ source: 'claude', sessionId: 'parent', id: 'tool:a', kind: 'tool', timestamp: clock(1), operation: { kind: 'command', tool: 'Bash', dispatchSource: 'antigravity', dispatchSessionId: 'child' } }], [], [child]);
  assert.equal(links[0]?.source, 'antigravity');
  assert.equal(links[0]?.costUsd, null);
  assert.equal(links[0]?.knownCostUsd, 1);
});
