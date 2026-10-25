import test from 'node:test';
import assert from 'node:assert/strict';
import { enrichSessionInsights, extractSessionEvidence, sessionsToCsv } from '../src/session-insights.js';
import type { SessionActivity } from '../src/session-observation.js';

const row = (sessionId: string, tokens: number | null, costUsd: number | null): SessionActivity => ({ source: 'codex', sessionId, tokens, costUsd, projectLabel: 'repo', model: 'test', lastActivityAt: '2026-10-22T10:00:00Z', costKind: costUsd === null ? 'unknown' : 'estimated', billing: { service: 'unknown', mode: 'unknown', accountRef: null, evidence: 'unknown' }, context: null, sharePercent: null });
test('thread totals retain own amounts, unknown child cost, typed forks and orphan sessions', () => {
  const rows = [row('root', 100, 1), row('child', 40, null), row('fork', 20, 0.2), row('orphan', 5, 0.1)];
  enrichSessionInsights(rows, [], [
    { source: 'codex', sessionId: 'child', id: 'm1', timestamp: rows[0]!.lastActivityAt, kind: 'metadata', parentId: 'root', relationKind: 'subagent' },
    { source: 'codex', sessionId: 'fork', id: 'm2', timestamp: rows[0]!.lastActivityAt, kind: 'metadata', parentId: 'root', relationKind: 'fork' },
    { source: 'codex', sessionId: 'orphan', id: 'm3', timestamp: rows[0]!.lastActivityAt, kind: 'metadata', parentId: 'absent', relationKind: 'subagent' },
  ]);
  assert.equal(rows[0]!.tokens, 100);
  assert.equal(rows[0]!.insights?.combinedTokens, 160);
  assert.equal(rows[0]!.insights?.subagentTokens, 40);
  assert.equal(rows[0]!.insights?.combinedCostUsd, null);
  assert.equal(rows[0]!.insights?.combinedKnownCostUsd, 1.2);
  assert.equal(rows[2]!.insights?.relationKind, 'fork');
  assert.equal(rows[3]!.insights?.orphan, true);
});
test('cycles are disconnected rather than dropping sessions or inflating totals', () => {
  const rows = [row('a', 10, 1), row('b', 20, 2)];
  enrichSessionInsights(rows, [], rows.map((r, i) => ({ source: r.source, sessionId: r.sessionId, id: r.sessionId, timestamp: r.lastActivityAt, kind: 'metadata' as const, parentId: i ? 'a' : 'b', relationKind: 'subagent' as const })));
  assert.equal(rows.reduce((sum, r) => sum + r.tokens!, 0), 30);
  assert.ok(rows.every(r => r.insights?.relationConflict));
});
test('detail usage keeps every typed descendant once without recursive insights or local metadata', () => {
  const rows = [row('root', 100, 1), row('child', 40, null), row('fork', 20, 0.2), row('grandchild', 5, 0), row('other', 3, 0.1)];
  rows[1]!.sessionTitle = 'Review';
  const parents = ['root', 'root', 'child', 'root'];
  enrichSessionInsights(rows, [], rows.slice(1).map((r, index) => ({ source: r.source, sessionId: r.sessionId, id: r.sessionId, timestamp: r.lastActivityAt, kind: 'metadata', parentId: parents[index], relationKind: index === 1 ? 'fork' : index === 3 ? 'unknown' : 'subagent', workingDirectory: 'C:/private-project' })));
  const related = Reflect.get(rows[0]!.insights!, 'relatedUsage');
  assert.ok(Array.isArray(related), 'details need a descendant usage snapshot even when only the root is returned');
  assert.deepEqual(related.map(member => member.sessionId).sort(), ['child', 'fork', 'grandchild', 'other']);
  assert.equal(related.find(member => member.sessionId === 'child')!.costUsd, null);
  assert.equal(related.find(member => member.sessionId === 'grandchild')!.costUsd, 0);
  assert.equal(related.find(member => member.sessionId === 'fork')!.relationKind, 'fork');
  assert.equal(related.find(member => member.sessionId === 'child')!.sessionTitle, 'Review');
  assert.ok(related.every(member => !('insights' in member) && !('workingDirectory' in member) && !('resumeCommand' in member)));
  assert.ok(!JSON.stringify(related).includes('private-project'));
  assert.deepEqual(Reflect.get(rows[2]!.insights!, 'relatedUsage'), []);
});
test('Codex nested spawn metadata and conflicting parent evidence retain typed lineage',()=>{
  const context={sessionId:'child'},timestamp='2026-10-22T10:00:00Z';
  const events=extractSessionEvidence('codex',{type:'session_meta',timestamp,payload:{id:'child',source:{subagent:{thread_spawn:{parent_thread_id:'root',agent_role:'reviewer',agent_nickname:'Ada'}}}}},context);
  const rows=[row('root',10,1),row('child',20,2)];enrichSessionInsights(rows,[],events);
  assert.equal(rows[1]!.insights?.relationKind,'subagent');assert.equal(rows[1]!.insights?.agentRole,'reviewer');
  assert.equal(rows[0]!.insights?.subagentTokens,20);
  const conflict=extractSessionEvidence('codex',{type:'session_meta',timestamp,payload:{id:'child',forked_from_id:'other',parent_thread_id:'root'}},context);
  enrichSessionInsights(rows,[],conflict);assert.equal(rows[1]!.insights?.relationConflict,true);
  assert.equal(rows[0]!.insights?.combinedTokens,10);
  assert.deepEqual(extractSessionEvidence('codex',{type:'session_meta',timestamp:1e30,payload:{id:'child'}},context),[]);
});
test('native TTFT deduplicates turn ids and does not invent throughput from task duration', () => {
  const context = { sessionId: 's' };
  const record = { type: 'event_msg', timestamp: '2026-10-22T10:00:00Z', payload: { type: 'task_complete', turn_id: 'turn', duration_ms: 5000, time_to_first_token_ms: 250 } };
  const facts = [...extractSessionEvidence('codex', record, context), ...extractSessionEvidence('codex', record, context)];
  const rows = [row('s', 100, 1)];
  enrichSessionInsights(rows, [], facts);
  assert.equal(rows[0]!.insights?.performance.ttftMs, 250);
  assert.equal(rows[0]!.insights?.performance.ttftSampleCount, 1);
  assert.equal(rows[0]!.insights?.performance.tokensPerSecond, null);
});
test('tool calls deduplicate by stable id, retain unknown retry state and never retain inputs', () => {
  const context = { sessionId: 's', insightTurnId: 'turn' };
  const record = { type: 'response_item', timestamp: '2026-10-22T10:00:00Z', payload: { type: 'function_call', call_id: 'tool', name: 'functions.apply_patch', arguments: 'PRIVATE_CONTENT' } };
  const facts = [...extractSessionEvidence('codex', record, context), ...extractSessionEvidence('codex', record, context)];
  const rows = [row('s', 100, 1)];
  enrichSessionInsights(rows, [], facts);
  assert.equal(rows[0]!.insights?.signals.toolCalls, 1);
  assert.equal(rows[0]!.insights?.signals.editTurns, 1);
  assert.equal(rows[0]!.insights?.signals.retryTurns, null);
  assert.equal(rows[0]!.insights?.signals.firstPass, null);
  assert.ok(!JSON.stringify(facts).includes('PRIVATE_CONTENT'));
});
test('CSV quotes formula cells, preserves unknown money, and omits local directories', () => {
  const rows = [row('s', 10, null)];
  rows[0]!.sessionTitle = '=HYPERLINK("bad")';
  enrichSessionInsights(rows, [], [{ source: 'codex', sessionId: 's', id: 'meta', timestamp: rows[0]!.lastActivityAt, kind: 'metadata', workingDirectory: 'C:/PRIVATE_DIRECTORY' }]);
  const csv = sessionsToCsv(rows);
  assert.ok(csv.includes("'=HYPERLINK"));
  assert.ok(csv.includes('cost_kind'));
  assert.ok(!csv.includes('PRIVATE_DIRECTORY'));
  assert.ok(!csv.includes('NaN'));
});
test('Claude streaming blocks use final output and completion while rejecting an absent first block',()=>{
  const context={sessionId:'s'},clock=(s:number)=>`2026-10-22T10:00:0${s}Z`;
  extractSessionEvidence('claude',{type:'user',uuid:'u',timestamp:clock(0),message:{content:'private prompt'}},context);
  const partial={type:'assistant',parentUuid:'u',requestId:'r',apiBlockIndex:0,timestamp:clock(1),message:{id:'m',model:'x',usage:{output_tokens:100},stop_reason:null}};
  const facts=[...extractSessionEvidence('claude',partial,context),...extractSessionEvidence('claude',{...partial,apiBlockIndex:1,timestamp:clock(3),message:{...partial.message,usage:{output_tokens:600},stop_reason:'end_turn'}},context)];
  const rows=[row('s',1000,1)];rows[0]!.source='claude';enrichSessionInsights(rows,[],facts);
  assert.equal(rows[0]!.insights?.performance.tokensPerSecond,200);
  assert.equal(rows[0]!.insights?.performance.estimatedRequestCount,1);
});
test('Codex throughput requires output markers and deduplicates repeated cumulative snapshots',()=>{
  const context={sessionId:'s'};
  extractSessionEvidence('codex',{type:'turn_context',timestamp:'2026-10-22T10:00:00Z',payload:{turn_id:'t',model:'m'}},context);
  extractSessionEvidence('codex',{type:'response_item',timestamp:'2026-10-22T10:00:02Z',payload:{type:'message',role:'assistant'}},context);
  const count={type:'event_msg',timestamp:'2026-10-22T10:00:03Z',payload:{type:'token_count',info:{last_token_usage:{output_tokens:600},total_token_usage:{total_tokens:1000}}}};
  const facts=[...extractSessionEvidence('codex',count,context),...extractSessionEvidence('codex',count,context)];
  const rows=[row('s',1000,1)];enrichSessionInsights(rows,[],facts);
  assert.equal(rows[0]!.insights?.performance.tokensPerSecond,300);
  assert.equal(rows[0]!.insights?.performance.estimatedRequestCount,1);
});
