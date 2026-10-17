import assert from 'node:assert/strict';
import test from 'node:test';

import { isLocalePreference, normalizeLocale, resolveLocale } from '../src/locale.ts';

test('normalizes supported system locale variants and falls back on unknown input', () => {
  assert.equal(normalizeLocale(' en-GB '), 'en');
  assert.equal(normalizeLocale('ja_JP'), 'ja');
  assert.equal(normalizeLocale('ko-KR'), 'ko');
  assert.equal(normalizeLocale('zh-Hans-CN'), 'zh-CN');
  assert.equal(normalizeLocale('fr-FR'), 'en');
  assert.equal(normalizeLocale(null), 'en');
});

test('accepts only persisted locale preference values', () => {
  assert.equal(isLocalePreference('system'), true);
  assert.equal(isLocalePreference('zh-CN'), true);
  assert.equal(isLocalePreference('en'), true);
  assert.equal(isLocalePreference('EN'), false);
  assert.equal(isLocalePreference('en-US'), false);
});

test('system resolution skips unsupported languages and respects explicit preference', () => {
  assert.equal(resolveLocale('system', ['fr-FR', 'ja-JP', 'en-US']), 'ja');
  assert.equal(resolveLocale('system', ['de-DE', 'ko-KR']), 'ko');
  assert.equal(resolveLocale('system', ['fr-FR']), 'en');
  assert.equal(resolveLocale('system', []), 'en');
  assert.equal(resolveLocale('en', ['ja-JP']), 'en');
});

test('POSIX locale environment suffixes do not hide a supported language', () => {
  assert.equal(normalizeLocale('en_US.UTF-8'), 'en');
  assert.equal(resolveLocale('system', ['C.UTF-8', 'ko_KR.UTF-8']), 'ko');
});
