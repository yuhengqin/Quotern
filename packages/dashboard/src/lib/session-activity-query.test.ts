import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionActivityQuery } from './session-activity-query.ts';

const range = { start: '2026-10-01', end: '2026-10-02', fromTime: '2026-10-01T12:00:00Z', toTime: '2026-10-02T12:00:00Z' };
const params = (query: string) => new URL(query, 'https://fixture.local').searchParams;

test('period detail links use the existing bounded source query even on runtimes ignoring new parameters', () => {
  const query = params(sessionActivityQuery(7, range, 'claude', { source: 'codex', sessionId: 'child', period: 'selected' }));
  assert.equal(query.get('sources'), 'codex');
  assert.equal(query.get('fromTime'), range.fromTime);
  assert.equal(query.get('toTime'), range.toTime);
  for (const field of ['sessionSource', 'sessionId', 'sessionPeriod']) assert.equal(query.has(field), false, `${field} would make old runtimes discard the parent bounds`);
});

test('notification lookup retains the collected-history identity and ordinary reads retain their scope', () => {
  const notification = params(sessionActivityQuery(7, null, '', { source: 'codex', sessionId: '子 & id' }));
  assert.equal(notification.get('sessionSource'), 'codex');
  assert.equal(notification.get('sessionId'), '子 & id');
  const ordinary = params(sessionActivityQuery(30, { start: '2026-10-01', end: '2026-10-02' }, 'claude,codex', undefined, true));
  assert.equal(ordinary.get('sources'), 'claude,codex');
  assert.equal(ordinary.get('fromDate'), '2026-10-01');
  assert.equal(ordinary.get('preview'), '6');
});
