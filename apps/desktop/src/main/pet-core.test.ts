import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DEFAULT_PET_SETTINGS,
  clampPetBounds,
  normalizePetSettings,
  petDockTarget,
  petPointerRegion,
  petWindowSize,
  toPetStats,
} from './pet-core.js';

test('invalid persisted pet preferences fall back safely', () => {
  assert.deepEqual(normalizePetSettings({ visible: true, character: '../bad', size: 'huge', botColor: 'x' }), {
    ...DEFAULT_PET_SETTINGS,
    visible: true,
  });
});

test('a persisted edge dock preference survives reload', () => {
  assert.equal(normalizePetSettings({ docked: true }).docked, true);
  assert.equal(normalizePetSettings({ docked: 'yes' }).docked, false);
});

test('pet stays on the selected display after size or display changes', () => {
  const work = { x: -1920, y: 0, width: 1920, height: 1040 };
  assert.deepEqual(clampPetBounds({ x: -9999, y: 2000 }, petWindowSize('medium'), work), {
    x: -1920,
    y: 1040 - petWindowSize('medium').height,
  });
});

test('right edge docking leaves a reachable handle and undocks on hover', () => {
  const work = { x: 100, y: 20, width: 1000, height: 700 };
  const size = petWindowSize('small');
  const sprite = Math.min(size.width, size.height - 138) - 8;
  const inset = (size.width - sprite) / 2;
  const resting = { x: work.x + work.width - inset - sprite + 12, y: 300 };
  assert.deepEqual(petDockTarget({ x: work.x + work.width - size.width - 12, y: 300 }, size, work, false), {
    x: work.x + work.width - size.width - 12,
    y: 300,
    docked: false,
  });
  assert.deepEqual(petDockTarget(resting, size, work, false), {
    x: work.x + work.width - inset - 30,
    y: 300,
    docked: true,
  });
  assert.deepEqual(petDockTarget(resting, size, work, true), {
    x: work.x + work.width - size.width,
    y: 300,
    docked: true,
  });
});

test('revealed pet stays out while the pointer crosses transparent space near the screen edge', () => {
  const work = { x: 0, y: 0, width: 1920, height: 1040 };
  const size = petWindowSize('medium');
  const revealed = { x: work.width - size.width, y: 500, ...size };
  const spriteY = revealed.y + 190;
  const gapPoint = { x: work.width - 12, y: spriteY };
  assert.deepEqual(petPointerRegion(gapPoint, revealed, work, 138, true, true), {
    overSprite: false,
    hovering: true,
  });
  const tucked = { ...revealed, x: petDockTarget(revealed, size, work, false, true).x };
  assert.equal(petPointerRegion(gapPoint, tucked, work, 138, true, false).hovering, true);
  const sliding = { ...revealed, x: Math.round((revealed.x + tucked.x) / 2) };
  assert.equal(petPointerRegion(gapPoint, sliding, work, 138, true, true).hovering, true);
  assert.equal(petPointerRegion({ x: work.width - 12, y: 100 }, revealed, work, 138, true, true).hovering, false);
});

test('stats use real daily, model, and complete session evidence', () => {
  const stats = toPetStats(
    { todayTokens: 50, todayCostUsd: 0.02, totalTokens: 1000, totalCostUsd: 1 },
    { days: [
      { date: '2026-10-14', tokens: 100 },
      { date: '2026-10-15', tokens: 50 },
    ] },
    { models: [{ model: 'gpt-test', tokens: 100, pct: 50, source: 'codex' }] },
    '2026-10-15',
    { sessionCount: 1, complete: true },
  );
  assert.equal(stats.todayTokens, 50);
  assert.equal(stats.conversations, 1);
  assert.equal(stats.last7dTokens, 150);
  assert.deepEqual(stats.topModels, [{ name: 'gpt-test', tokens: 100, percent: 50, source: 'codex' }]);
});

test('rolling windows exclude older active days when the daily series is sparse', () => {
  const stats = toPetStats(
    {},
    { days: [
      { date: '2026-08-01', tokens: 900 },
      { date: '2026-09-14', tokens: 400 },
      { date: '2026-10-07', tokens: 100 },
      { date: '2026-10-09', tokens: 20 },
      { date: '2026-10-15', tokens: 50 },
    ] },
    {},
    '2026-10-15',
  );
  assert.equal(stats.last7dTokens, 70);
  assert.equal(stats.last7dActiveDays, 2);
  assert.equal(stats.last30dTokens, 170);
  assert.equal(stats.last30dAvgPerDay, 6);
});
