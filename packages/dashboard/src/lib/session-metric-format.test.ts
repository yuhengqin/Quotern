import assert from 'node:assert/strict';
import { test } from 'node:test';
import { formatSessionDuration, sessionMetricValue, formatSessionTokens, formatSessionUsd } from './session-metric-format.ts';
import { i18n, setActiveLocale } from 'quotern-i18n';
import { setTokenUnitMode } from './utils.ts';
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

test('session Token values follow the saved unit preference', async () => {
  const previousLocale = i18n.language;
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
    },
  });
  try {
    await setActiveLocale('zh-CN');
    setTokenUnitMode('localized');
    assert.equal(formatSessionTokens(3_684_765), '368.5万');
    setTokenUnitMode('international');
    assert.equal(formatSessionTokens(3_684_765), '3.7M');
    assert.equal(formatSessionTokens(0), '0');
    assert.equal(formatSessionTokens(null), '—');
  } finally {
    await setActiveLocale(previousLocale as 'zh-CN' | 'en' | 'ja' | 'ko');
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('session USD values follow the shared two-decimal cost contract without trailing zeroes', () => {
  for (const [value, expected] of [[1.422123456789, '$1.42'], [1.4, '$1.4'], [0, '$0'], [1234.56789, '$1,234.57']] as const) {
    assert.equal(formatSessionUsd(value, 'en'), expected);
  }
  assert.equal(formatSessionUsd(null, 'en'), '—');
  assert.equal(formatSessionUsd(undefined, 'en'), '—');
  assert.equal(formatSessionUsd(Number.NaN, 'en'), '—');
});

test('small nonzero session costs stay distinguishable from zero and unknown subtotals retain a lower bound', () => {
  assert.equal(formatSessionUsd(0.00000123, 'en'), '<$0.01');
  assert.equal(formatSessionUsd(0.0001, 'en'), '<$0.01');
  assert.equal(formatSessionUsd(-0.001, 'en'), '>-$0.01');
  assert.equal(formatSessionUsd(1.422123456789, 'en', { lowerBound: true }), '≥ $1.42');
  assert.equal(formatSessionUsd(0.00000123, 'en', { lowerBound: true }), '> $0');
});
