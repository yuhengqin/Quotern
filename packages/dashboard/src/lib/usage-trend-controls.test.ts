import assert from 'node:assert/strict';
import test from 'node:test';
import { formatTrendDateRange, formatTrendPointLabels, getTrendAxisTicks, getTrendControls, getTrendDateRange } from './usage-trend-controls.ts';

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

test('weekly labels distinguish the calendar week from a clipped reporting period', () => {
  assert.deepEqual(formatTrendPointLabels({ key: '2026-09-14', fromDate: '2026-09-19', toDate: '2026-09-20' }, 'weekly'), {
    axisLabel: '09/14–20', tooltipLabel: '2026/09/19 – 09/20', partialWeek: true,
  });
  assert.deepEqual(formatTrendPointLabels({ key: '2026-10-12', fromDate: '2026-10-12', toDate: '2026-10-18' }, 'weekly'), {
    axisLabel: '10/12–18', tooltipLabel: '2026/10/12 – 10/18', partialWeek: false,
  });
});

test('weekly date ranges cross month and year boundaries without timezone drift', () => {
  assert.equal(formatTrendPointLabels({ key: '2026-09-28', fromDate: '2026-09-28', toDate: '2026-10-04' }, 'weekly').axisLabel, '09/28–10/04');
  assert.deepEqual(formatTrendPointLabels({ key: '2026-12-28', fromDate: '2027-01-01', toDate: '2027-01-01' }, 'weekly'), {
    axisLabel: '12/28–01/03', tooltipLabel: '2027/01/01', partialWeek: true,
  });
  assert.equal(formatTrendPointLabels({ key: '2026-12-28', fromDate: '2026-12-28', toDate: '2027-01-03' }, 'weekly').tooltipLabel, '2026/12/28 – 2027/01/03');
});

test('shared axis ticks retain both endpoints and thin the same periods to fit narrow cards', () => {
  const points = Array.from({ length: 13 }, (_, i) => {
    const key = new Date(Date.UTC(2026, 6, 20 + i * 7)).toISOString().slice(0, 10);
    const toDate = new Date(Date.UTC(2026, 6, 26 + i * 7)).toISOString().slice(0, 10);
    return { key, fromDate: key, toDate };
  });
  assert.deepEqual(getTrendAxisTicks(points, 'weekly', false, 680), ['07/20–26', '08/10–16', '08/31–09/06', '09/21–27', '10/12–18']);
  assert.deepEqual(getTrendAxisTicks(points, 'weekly', false, 300), ['07/20–26', '10/12–18']);
  assert.deepEqual(getTrendAxisTicks(points.slice(0, 1), 'weekly', false, 300), ['07/20–26']);
  assert.deepEqual(getTrendAxisTicks([], 'weekly', false, 300), []);
});

test('non-weekly labels retain their existing date and hour formats', () => {
  const point = { key: '2026-10-18T09', fromDate: '2026-10-18', toDate: '2026-10-18' };
  assert.equal(formatTrendPointLabels(point, 'hourly', true).axisLabel, '09:00');
  assert.equal(formatTrendPointLabels(point, 'hourly', false).axisLabel, '10-18 09:00');
  assert.equal(formatTrendPointLabels({ ...point, key: '2026-10-18' }, 'daily').axisLabel, '10-18');
  assert.equal(formatTrendPointLabels({ ...point, key: '2026-10' }, 'monthly').axisLabel, '2026-10');
});
