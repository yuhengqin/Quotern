import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatSessionDuration, sessionMetricValue } from './session-metric-format.ts';
import type { SessionMetrics } from 'quotern-core';

const emptyMetrics: SessionMetrics = { sessionCount: 0, messageCount: 0, durationSeconds: 0, activeSeconds: null, complete: true, missingSources: [], taskSeconds: 0, taskTimingKind: 'empty', estimatedTaskSources: [], missingTaskSources: [] };

test('unavailable generation timing and unavailable session coverage render as a dash', () => {
  assert.equal(formatSessionDuration(null), '—');
  assert.equal(sessionMetricValue(null, 'messageCount'), null);
  assert.equal(sessionMetricValue({ ...emptyMetrics, complete: false, missingSources: ['cursor'] }, 'messageCount'), null);
  assert.equal(sessionMetricValue(emptyMetrics, 'messageCount'), 0);
});

test('available task timing remains visible when no logical message falls inside the date range', () => {
  assert.equal(sessionMetricValue({ ...emptyMetrics, complete: false, taskSeconds: 30, taskTimingKind: 'recorded' }, 'taskSeconds'), 30);
  assert.equal(sessionMetricValue({ ...emptyMetrics, taskSeconds: null, taskTimingKind: 'unavailable' }, 'taskSeconds'), null);
});

test('session durations retain hours beyond one day and format shorter spans', () => {
  assert.equal(formatSessionDuration(10141860), '2817h 11m');
  assert.equal(formatSessionDuration(3661), '1h 1m');
  assert.equal(formatSessionDuration(60), '1m');
  assert.equal(formatSessionDuration(15), '15s');
  assert.equal(formatSessionDuration(0), '0s');
});
