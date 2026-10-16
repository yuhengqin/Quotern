import test from 'node:test';
import assert from 'node:assert/strict';
import type { SessionActivity } from 'quotern-core';
import { filterSessionActivity, sessionActivityPage } from './session-activity.ts';

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
