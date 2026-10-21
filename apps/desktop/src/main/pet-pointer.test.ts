import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createPetCursorSampler } from './pet-pointer.js';

const bounds = { x: 100, y: 200, width: 400, height: 254 };
const cursor = { x: 270, y: 390 };

test('hover emits local coordinates once, including when the window moves under a stationary pointer', () => {
  const sample = createPetCursorSampler();
  assert.deepEqual(sample(bounds, cursor, true, false), { x: 170, y: 190 });
  assert.equal(sample(bounds, cursor, true, false), undefined);
  assert.deepEqual(sample({ ...bounds, x: 110 }, cursor, true, false), { x: 160, y: 190 });
  assert.deepEqual(sample({ ...bounds, x: 110, width: 450 }, cursor, true, false), { x: 160, y: 190 });
});

test('leaving emits one reset and distant cursor movement does not stream IPC', () => {
  const sample = createPetCursorSampler();
  assert.equal(sample(bounds, cursor, false, false), undefined);
  sample(bounds, cursor, true, false);
  assert.equal(sample(bounds, { x: 900, y: 900 }, false, false), null);
  assert.equal(sample(bounds, { x: 950, y: 950 }, false, false), undefined);
});

test('capture suppresses samples and release refreshes the same coordinates', () => {
  const sample = createPetCursorSampler();
  sample(bounds, cursor, true, false);
  assert.equal(sample(bounds, cursor, true, true), undefined);
  assert.equal(sample(bounds, { x: 900, y: 900 }, false, true), undefined);
  assert.deepEqual(sample(bounds, cursor, true, false), { x: 170, y: 190 });
});

test('capture ending outside explicitly clears the previous hover coordinates', () => {
  const sample = createPetCursorSampler();
  sample(bounds, cursor, true, false);
  sample(bounds, cursor, true, true);
  assert.equal(sample(bounds, { x: 900, y: 900 }, false, false), null);
  assert.equal(sample(bounds, { x: 950, y: 950 }, false, false), undefined);
});
