import test from 'node:test';
import assert from 'node:assert/strict';
import type { SessionActivity } from 'quotern-core';
import { filterSessionActivity, relatedSessionActivity, sessionActivityPage } from './session-activity.ts';
import * as activity from './session-activity.ts';

test('session search combines source and named metadata while pages remain bounded after filtering', () => {
  const rows = Array.from({ length: 308 }, (_, i) => ({ source: i % 2 ? 'claude' : 'codex', sessionId: `session-${i}`, projectLabel: 'Quotern', model: 'model', sessionTitle: `任务 ${i}` } as SessionActivity));
  assert.equal(sessionActivityPage(rows, 1).rows.length, 12);
  assert.equal(sessionActivityPage(rows, 26).rows.length, 8);
  assert.deepEqual(filterSessionActivity(rows, 'session-307', 'claude'), [rows[307]]);
  assert.equal(filterSessionActivity(rows, 'session-307', 'codex').length, 0);
  const filtered = filterSessionActivity(rows, '任务 100', 'all');
  assert.equal(sessionActivityPage(filtered, 26).page, 1);
  assert.equal(sessionActivityPage(filtered, 26).rows[0], rows[100]);
  assert.equal(sessionActivityPage([], 26).pages, 1);
});

test('session browser filters projects and sorts known costs ahead of unknown without mutating input', () => {
  const rows = [{ source: 'claude', sessionId: 'a', projectLabel: 'A', model: 'one', lastActivityAt: '2026-10-18T01:00Z', costUsd: null }, { source: 'codex', sessionId: 'b', projectLabel: 'B', model: 'two', lastActivityAt: '2026-10-18T00:00Z', costUsd: 0 }] as SessionActivity[];
  const filtered = (filterSessionActivity as any)(rows, '', 'all', 'B');
  assert.deepEqual(filtered, [rows[1]]);
  const sort = (activity as any).sortSessionActivity;
  assert.equal(typeof sort, 'function');
  assert.deepEqual(sort(rows, 'cost').map((r: SessionActivity) => r.sessionId), ['b', 'a']);
  assert.equal(rows[0].sessionId, 'a');
});

test('session filter options follow search and the other filter, with counts across every page', () => {
  const rows = [
    ...Array.from({ length: 13 }, (_, i) => ({ source: 'codex', sessionId: `a-${i}`, projectLabel: 'A', sessionTitle: '调研' })),
    { source: 'claude', sessionId: 'b', projectLabel: 'B', sessionTitle: '调研' },
    { source: 'codex', sessionId: 'c', projectLabel: 'C', sessionTitle: '实现' },
    { source: 'claude', sessionId: 'd', projectLabel: 'A', sessionTitle: '调研' },
  ] as SessionActivity[];
  const facets = activity.sessionActivityFacets;
  assert.deepEqual(facets(rows, ' 调研 ', 'all', ''), {
    sources: [{ value: 'claude', count: 2 }, { value: 'codex', count: 13 }],
    projects: [{ value: 'A', count: 14 }, { value: 'B', count: 1 }],
  });
  assert.deepEqual(facets(rows, '调研', 'codex', 'A'), {
    sources: [{ value: 'claude', count: 1 }, { value: 'codex', count: 13 }],
    projects: [{ value: 'A', count: 13 }],
  });
  assert.deepEqual(facets(rows, '实现', 'claude', 'B'), {
    sources: [{ value: 'claude', count: 0 }],
    projects: [{ value: 'B', count: 0 }],
  });
  assert.deepEqual(facets(rows, '无匹配', 'all', ''), { sources: [], projects: [] });
});

test('related sessions use exact source and session references even when session attribution is mixed', () => {
  const rows = [
    { source: 'pi', sessionId: 'shared', billing: { service: 'mixed' } },
    { source: 'omp', sessionId: 'shared', billing: { service: 'openai' } },
    { source: 'pi', sessionId: 'other', billing: { service: 'openai' } },
  ] as SessionActivity[];
  assert.deepEqual(relatedSessionActivity(rows, { sessionRefs: [{ source: 'pi', sessionId: 'shared' }, { source: 'pi', sessionId: 'shared' }] }), [rows[0]]);
  assert.deepEqual(relatedSessionActivity(rows, { sessionRefs: [] }), []);
  assert.deepEqual(relatedSessionActivity(rows, {}), []);
});
