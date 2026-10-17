import assert from 'node:assert/strict';
import { test } from 'node:test';
import { i18n, setActiveLocale } from 'quotern-i18n';
import * as tokenUtils from './utils.ts';

const { formatCompactTokenCount } = tokenUtils;

test('localized Token units follow the interface language and promote rounded boundaries', async () => {
  const previousLocale = i18n.language;
  try {
    await setActiveLocale('zh-CN');
    assert.equal(formatCompactTokenCount(187_200_000, 'localized'), '1.872亿');
    assert.equal(formatCompactTokenCount(8_800_000, 'localized'), '880万');
    assert.equal(formatCompactTokenCount(3_300_000_000, 'localized'), '33亿');
    assert.equal(formatCompactTokenCount(9_999, 'localized'), '9,999');
    assert.equal(formatCompactTokenCount(99_999_999, 'localized'), '1亿');
    assert.equal(formatCompactTokenCount(999_999_999_999, 'localized'), '1万亿');

    await setActiveLocale('ja');
    assert.equal(formatCompactTokenCount(187_200_000, 'localized'), '1.872億');
    assert.equal(formatCompactTokenCount(1_000_000_000_000, 'localized'), '1兆');

    await setActiveLocale('ko');
    assert.equal(formatCompactTokenCount(187_200_000, 'localized'), '1.872억');
    assert.equal(formatCompactTokenCount(1_000_000_000_000, 'localized'), '1조');

    await setActiveLocale('en');
    assert.equal(formatCompactTokenCount(187_200_000, 'localized'), '187.2M');
  } finally {
    await setActiveLocale(previousLocale as 'zh-CN' | 'en' | 'ja' | 'ko');
  }
});

test('international abbreviations remain available', () => {
  assert.equal(formatCompactTokenCount(187_200_000, 'international'), '187.2M');
  assert.equal(formatCompactTokenCount(8_800_000, 'international'), '8.8M');
  assert.equal(formatCompactTokenCount(3_300_000_000, 'international'), '3.3B');
});

test('Token unit preference defaults to localized and migrates the old Chinese choice', async () => {
  const preference = tokenUtils as typeof tokenUtils & {
    getTokenUnitMode?: () => string;
    setTokenUnitMode?: (mode: string) => void;
  };
  const { getTokenUnitMode, setTokenUnitMode } = preference;
  assert.ok(getTokenUnitMode);
  assert.ok(setTokenUnitMode);
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const previousLocale = i18n.language;
  const stored = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
    },
  });

  try {
    assert.equal(getTokenUnitMode(), 'localized');
    stored.set('quotern-token-unit-mode', 'chinese');
    assert.equal(getTokenUnitMode(), 'localized');
    await setActiveLocale('ko');
    assert.equal(formatCompactTokenCount(187_200_000), '1.872억');
    setTokenUnitMode('international');
    assert.equal(getTokenUnitMode(), 'international');
    assert.equal(formatCompactTokenCount(187_200_000), '187.2M');
    stored.set('quotern-token-unit-mode', 'unexpected');
    assert.equal(getTokenUnitMode(), 'localized');
  } finally {
    await setActiveLocale(previousLocale as 'zh-CN' | 'en' | 'ja' | 'ko');
    if (previous) Object.defineProperty(globalThis, 'localStorage', previous);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
