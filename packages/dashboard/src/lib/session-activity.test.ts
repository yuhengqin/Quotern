import test from 'node:test';
import assert from 'node:assert/strict';
import type { SessionActivity } from 'quotern-core';
import { filterSessionActivity, sessionActivityPage } from './session-activity.ts';
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
