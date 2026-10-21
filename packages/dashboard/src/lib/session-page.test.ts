import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { SessionActivity, SessionActivitySnapshot } from 'quotern-core';
import { createSessionPageSearch, parseSessionPageSearch, selectSessionPageRange, sessionAttributionKey, sessionPageRows, sessionTimeRangeControl, updateSessionPageSearch } from './session-page.ts';

test('session navigation freezes the selected day and overview Agent scope', () => {
  const search = createSessionPageSearch({ days: 30, selectedDate: '2026-10-12', dateRange: { start: '2026-10-01', end: '2026-10-19' }, sources: ['codex', 'claude'] });
  assert.equal(search.start, '2026-10-12');
  assert.equal(search.end, '2026-10-12');
  assert.equal(search.days, 1);
  assert.deepEqual(search.scopeSources, ['codex', 'claude']);
});

test('notification session targets retain an exact source/id pair across URL restoration', () => {
  const search = parseSessionPageSearch({ sessionSource: 'codex', sessionId: 'session.一 & 2' });
  assert.equal(search.sessionSource, 'codex');
  assert.equal(search.sessionId, 'session.一 & 2');
  assert.equal(parseSessionPageSearch({ sessionSource: 'codex' }).sessionId, undefined);
  assert.equal(parseSessionPageSearch({ sessionSource: 'arbitrary', sessionId: 'id' }).sessionId, undefined);
});

test('session navigation preserves exact rolling instants through a serialized URL state', () => {
  const dateRange = { start: '2026-10-18', end: '2026-10-19', fromTime: '2026-10-18T02:14:00.000Z', toTime: '2026-10-19T02:14:00.000Z' };
  const search = createSessionPageSearch({ days: 1, selectedDate: null, dateRange, sources: [] });
  const restored = parseSessionPageSearch(JSON.parse(JSON.stringify(search)));
  assert.equal(restored.fromTime, dateRange.fromTime);
  assert.equal(restored.toTime, dateRange.toTime);
  assert.equal(restored.start, dateRange.start);
  assert.equal(restored.end, dateRange.end);
});

test('relative overview ranges become explicit calendar dates', () => {
  const search = createSessionPageSearch({ days: 7, selectedDate: null, dateRange: null, sources: [] }, new Date('2026-10-19T02:00:00Z'));
  assert.equal(search.start, '2026-10-13');
  assert.equal(search.end, '2026-10-19');
});

test('session URL validation normalizes invalid values without losing valid Unicode filters', () => {
  const search = parseSessionPageSearch({ days: -8, start: '2026-02-30', end: '2026-03-01', fromTime: 'bad', toTime: 'bad', page: -3, sort: 'invalid', sources: ['codex', 'codex', 1], project: '研究 / A&B', q: '小病灶' });
  assert.equal(search.days, 7);
  assert.equal(search.start, undefined);
  assert.equal(search.fromTime, undefined);
  assert.equal(search.page, 1);
  assert.equal(search.sort, 'recent');
  assert.deepEqual(search.sources, ['codex']);
  assert.equal(search.project, '研究 / A&B');
  assert.equal(search.q, '小病灶');
});

test('session sort direction survives URL restoration and changes reset pagination without broadening scope', () => {
  const previous = parseSessionPageSearch({ sort: 'tokens', direction: 'ascending', page: 4, q: '调研', sources: ['codex'], project: 'Quotern', scopeSources: ['codex'], group: 'billing-group' });
  const restored = parseSessionPageSearch(JSON.parse(JSON.stringify(previous)));
  assert.equal(restored.direction, 'ascending');
  const next = updateSessionPageSearch(restored, { sort: 'cost', direction: 'descending' });
  assert.equal(next.sort, 'cost');
  assert.equal(next.direction, 'descending');
  assert.equal(next.page, 1);
  assert.equal(next.q, previous.q);
  assert.equal(next.project, previous.project);
  assert.equal(next.group, previous.group);
  assert.deepEqual(next.scopeSources, previous.scopeSources);
  assert.deepEqual(next.sources, previous.sources);
  assert.equal(updateSessionPageSearch(restored, { q: '' }).direction, 'ascending');
  assert.equal(parseSessionPageSearch({}).direction, 'descending');
  assert.equal(parseSessionPageSearch({ direction: 'invalid' }).direction, 'descending');
});

test('clearing list filters resets the page but retains the overview and attribution scope', () => {
  const search = parseSessionPageSearch({ days: 30, scopeSources: ['pi', 'omp'], group: '["openai","api",null]', q: 'model', sources: ['pi'], project: 'app', sort: 'cost', page: 8 });
  const cleared = updateSessionPageSearch(search, { q: '', sources: [], project: '' });
  assert.equal(cleared.page, 1);
  assert.equal(cleared.group, search.group);
  assert.deepEqual(cleared.scopeSources, ['pi', 'omp']);
  assert.equal(cleared.sort, 'cost');
  assert.equal(updateSessionPageSearch(cleared, { page: 2 }).page, 2);
});

test('attribution navigation keeps exact source/session references and never broadens a missing group', () => {
  const rows = [{ source: 'pi', sessionId: 'shared' }, { source: 'omp', sessionId: 'shared' }] as SessionActivity[];
  const group = { service: 'openai', mode: 'api', accountRef: null, sessionRefs: [{ source: 'pi', sessionId: 'shared' }] } as SessionActivitySnapshot['billing'][number];
  const snapshot = { sessions: rows, billing: [group] } as SessionActivitySnapshot;
  assert.deepEqual(sessionPageRows(snapshot, sessionAttributionKey(group)), [rows[0]]);
  assert.deepEqual(sessionPageRows(snapshot, 'missing'), []);
  assert.deepEqual(sessionPageRows({ ...snapshot, billing: [{ ...group, sessionRefs: undefined }] }, sessionAttributionKey(group)), []);
  assert.equal(sessionPageRows(snapshot), rows);
});

test('changing a session time preset clears inherited bounds but keeps list and attribution filters', () => {
  const previous = parseSessionPageSearch({ days: 1, start: '2026-10-18', end: '2026-10-19', fromTime: '2026-10-18T02:14:00.000Z', toTime: '2026-10-19T02:14:00.000Z', scopeSources: ['codex'], group: 'billing-group', q: '病灶', sources: ['codex'], project: 'thesis', sort: 'cost', page: 4 });
  const next = selectSessionPageRange(previous, 'last-30-days');
  assert.equal(next.range, 'last-30-days');
  assert.equal(next.days, 30);
  assert.equal(next.start, undefined);
  assert.equal(next.fromTime, undefined);
  assert.equal(next.page, 1);
  assert.equal(next.q, '病灶');
  assert.equal(next.project, 'thesis');
  assert.equal(next.sort, 'cost');
  assert.equal(next.group, 'billing-group');
  assert.deepEqual(next.scopeSources, ['codex']);
  assert.deepEqual(next.sources, ['codex']);
  const rolling = selectSessionPageRange(next, 'last-24-hours');
  assert.equal(rolling.range, 'last-24-hours');
  assert.equal(rolling.days, 1);
  assert.equal(rolling.start, undefined);
});

test('a custom session range survives refresh and clears prior rolling instants', () => {
  const previous = parseSessionPageSearch({ range: 'last-24-hours', days: 1 });
  const next = selectSessionPageRange(previous, { start: '2026-10-12', end: '2026-10-18' });
  const restored = parseSessionPageSearch(JSON.parse(JSON.stringify(next)));
  assert.equal(restored.range, 'custom');
  assert.equal(restored.days, 7);
  assert.equal(restored.start, '2026-10-12');
  assert.equal(restored.end, '2026-10-18');
  assert.equal(restored.fromTime, undefined);
  assert.deepEqual(sessionTimeRangeControl(restored).customRange, { start: '2026-10-12', end: '2026-10-18' });
});

test('the shared time control identifies inherited historical days and exact rolling windows', () => {
  const now = new Date('2026-10-19T02:00:00Z');
  const historical = parseSessionPageSearch({ days: 1, start: '2026-10-18', end: '2026-10-18' });
  assert.deepEqual(sessionTimeRangeControl(historical, now).customRange, { start: '2026-10-18', end: '2026-10-18' });
  const weekly = createSessionPageSearch({ days: 7, selectedDate: null, dateRange: null, sources: [] }, now);
  assert.deepEqual(sessionTimeRangeControl(weekly, now), { value: 'last-7-days', customRange: null });
  const instant = parseSessionPageSearch({ days: 1, start: '2026-10-18', end: '2026-10-19', fromTime: '2026-10-18T02:14:00Z', toTime: '2026-10-19T02:14:00Z' });
  assert.deepEqual(sessionTimeRangeControl(instant, now), { value: 'last-24-hours', customRange: null });
});
