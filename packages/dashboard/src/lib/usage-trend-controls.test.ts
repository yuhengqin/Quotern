import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTrendDateRange, getTrendControls, getTrendDateRange } from './usage-trend-controls.ts';

test('a selected day overrides a long dashboard range and only offers hourly trends', () => {
  const range = getTrendDateRange(90, '2026-10-17', null, '2026-10-18');
  assert.deepEqual(range, { start: '2026-10-17', end: '2026-10-17' });
  const controls = getTrendControls(range, 'monthly');
  assert.deepEqual(controls.options, ['hourly']);
  assert.equal(controls.selection, 'auto');
  assert.equal(controls.granularity, 'hourly');
});

test('hourly exploration is limited to seven days and invalid selections return to auto', () => {
  const week = getTrendControls({ start: '2026-10-12', end: '2026-10-18' }, 'hourly');
  assert.deepEqual(week.options, ['hourly', 'daily']);
  assert.equal(week.granularity, 'hourly');
  const quarter = getTrendControls(getTrendDateRange(90, null, null, '2026-10-18'), 'hourly');
  assert.deepEqual(quarter.options, ['daily', 'weekly', 'monthly']);
  assert.equal(quarter.selection, 'auto');
  assert.equal(quarter.granularity, 'daily');
});

test('coarse intervals require multiple calendar buckets and longer ranges default to weeks', () => {
  assert.deepEqual(getTrendControls({ start: '2026-10-01', end: '2026-10-18' }, 'auto').options, ['daily', 'weekly']);
  const controls = getTrendControls({ start: '2026-05-01', end: '2026-10-18' }, 'auto');
  assert.equal(controls.granularity, 'weekly');
  assert.ok(controls.options.includes('monthly'));
  assert.equal(getTrendControls({ start: '2026-09-28', end: '2026-10-18' }, 'monthly').granularity, 'monthly');
});

test('date labels collapse a single date and identify today without repeating the date', () => {
  assert.equal(formatTrendDateRange({ start: '2026-10-18', end: '2026-10-18' }, '2026-10-18', '今天'), '今天 · 2026-10-18');
  assert.equal(formatTrendDateRange({ start: '2026-10-17', end: '2026-10-17' }, '2026-10-18', '今天'), '2026-10-17');
  const range = getTrendDateRange(90, null, { start: '2026-10-01', end: '2026-10-07' }, '2026-10-18');
  assert.equal(formatTrendDateRange(range, '2026-10-18', '今天'), '2026-10-01 – 2026-10-07');
  assert.deepEqual(getTrendDateRange(90, null, null, '2026-10-18'), { start: '2026-07-21', end: '2026-10-18' });
});
