import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as tokenUtils from './utils.ts';

const { formatCompactTokenCount } = tokenUtils;

test('Chinese Token units keep useful precision and promote rounded boundaries', () => {
  assert.equal(formatCompactTokenCount(187_200_000, 'chinese'), '1.872亿');
  assert.equal(formatCompactTokenCount(8_800_000, 'chinese'), '880万');
  assert.equal(formatCompactTokenCount(3_300_000_000, 'chinese'), '33亿');
  assert.equal(formatCompactTokenCount(9_999, 'chinese'), '9,999');
  assert.equal(formatCompactTokenCount(99_999_999, 'chinese'), '1亿');
  assert.equal(formatCompactTokenCount(999_999_999_999, 'chinese'), '1万亿');
});

test('international abbreviations remain available', () => {
  assert.equal(formatCompactTokenCount(187_200_000, 'international'), '187.2M');
  assert.equal(formatCompactTokenCount(8_800_000, 'international'), '8.8M');
  assert.equal(formatCompactTokenCount(3_300_000_000, 'international'), '3.3B');
});

test('Token unit preference defaults to Chinese and persists a valid choice', () => {
  const preference = tokenUtils as typeof tokenUtils & {
    getTokenUnitMode?: () => string;
    setTokenUnitMode?: (mode: string) => void;
  };
  const { getTokenUnitMode, setTokenUnitMode } = preference;
  assert.ok(getTokenUnitMode);
  assert.ok(setTokenUnitMode);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
    },
  });

  try {
    assert.equal(getTokenUnitMode(), 'chinese');
    setTokenUnitMode('international');
    assert.equal(getTokenUnitMode(), 'international');
    assert.equal(formatCompactTokenCount(187_200_000), '187.2M');
    stored.set('quotern-token-unit-mode', 'unexpected');
    assert.equal(getTokenUnitMode(), 'chinese');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
