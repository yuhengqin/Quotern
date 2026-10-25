import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSessionPageSearch } from './session-page.ts';
import { sessionListQuery, paginationItems, parsePageJump } from './session-list-query.ts';

test('list queries distinguish scope from filters and serialize pagination and exact instants', () => {
  const query = new URL(sessionListQuery(parseSessionPageSearch({ days: 7, page: 4, pageSize: 24, scopeSources: ['codex'], sources: ['claude'], q: '你好 & A', project: '项目', model: 'model-a', group: 'billing', sort: 'cost', direction: 'ascending' }),
    { start: '2026-10-01', end: '2026-10-02', fromTime: '2026-10-01T12:00:00Z', toTime: '2026-10-02T12:00:00Z' }), 'http://local');
  assert.equal(query.pathname, '/functions/tud-session-list');
  assert.equal(query.searchParams.get('page'), '4');
  assert.equal(query.searchParams.get('pageSize'), '24');
  assert.equal(query.searchParams.get('sources'), 'codex');
  assert.equal(query.searchParams.get('filterSources'), 'claude');
  assert.equal(query.searchParams.get('q'), '你好 & A');
  assert.equal(query.searchParams.get('project'), '项目');
  assert.equal(query.searchParams.get('group'), 'billing');
  assert.equal(query.searchParams.get('sort'), 'cost');
  assert.equal(query.searchParams.get('fromTime'), '2026-10-01T12:00:00Z');
  assert.equal(query.searchParams.has('fromDate'), false);
  assert.equal(new URL(sessionListQuery(parseSessionPageSearch({ page: 4 }), null, true), 'http://local').searchParams.get('format'), 'export');
});

test('large pagination always reaches first and last pages with bounded intermediate buttons', () => {
  assert.deepEqual(paginationItems(2, 1), [1, 2]);
  assert.deepEqual(paginationItems(30, 15), [1, 'ellipsis', 14, 15, 16, 'ellipsis', 30]);
  assert.deepEqual(paginationItems(30, 1), [1, 2, 3, 'ellipsis', 30]);
  assert.deepEqual(paginationItems(30, 30), [1, 'ellipsis', 28, 29, 30]);
});

test('jump navigation rejects invalid numbers and normalizes valid out-of-range input', () => {
  assert.equal(parsePageJump('', 10), null);
  assert.equal(parsePageJump('2.5', 10), null);
  assert.equal(parsePageJump('-1', 10), null);
  assert.equal(parsePageJump('99', 10), 10);
  assert.equal(parsePageJump('0', 10), 1);
  assert.equal(parsePageJump('4', 10), 4);
});
