import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatSessionDuration, sessionMetricValue } from './session-metric-format.ts';

test('unavailable generation timing and unavailable session coverage render as a dash', () => {
  assert.equal(formatSessionDuration(null), '—');
  assert.equal(sessionMetricValue(null, 'messageCount'), null);
  assert.equal(sessionMetricValue({ sessionCount: 0, messageCount: 0, durationSeconds: 0, activeSeconds: null, complete: false, missingSources: ['cursor'] }, 'messageCount'), null);
  assert.equal(sessionMetricValue({ sessionCount: 0, messageCount: 0, durationSeconds: 0, activeSeconds: null, complete: true, missingSources: [] }, 'messageCount'), 0);
});

test('session durations retain hours beyond one day and format shorter spans', () => {
  assert.equal(formatSessionDuration(10141860), '2817h 11m');
  assert.equal(formatSessionDuration(3661), '1h 1m');
  assert.equal(formatSessionDuration(60), '1m');
  assert.equal(formatSessionDuration(15), '15s');
  assert.equal(formatSessionDuration(0), '0s');
});
