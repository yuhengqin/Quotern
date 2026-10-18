import assert from 'node:assert/strict';
import test from 'node:test';

import {
  i18n,
  registerMessages,
  setActiveLocale,
  translate,
} from '../dist/index.js';

test('registered flat keys interpolate synchronously with a fixed language', () => {
  registerMessages({
    'zh-CN': { 'test.greeting': '你好，{{name}}' },
    en: { 'test.greeting': 'Hello, {{name}}' },
    ja: { 'test.greeting': 'こんにちは、{{name}}' },
    ko: { 'test.greeting': '안녕하세요, {{name}}' },
  });

  assert.equal(i18n.isInitialized, true);
  assert.equal(translate('en', 'test.greeting', { name: 'Ada' }), 'Hello, Ada');
  assert.equal(translate('ja', 'test.greeting', { name: 'Ada' }), 'こんにちは、Ada');
  assert.equal(translate('ko', 'test.greeting', { name: 'Ada' }), '안녕하세요, Ada');
  assert.equal(translate('en', 'test.greeting', { name: 'Ada', lng: 'ja' }), 'Hello, Ada');
});

test('later catalogs merge and missing locale entries fall back to Simplified Chinese', () => {
  registerMessages({
    'zh-CN': { 'test.first': '第一条', 'test.fallback': '后备：{{count}}' },
    en: { 'test.first': 'First' },
    ja: { 'test.first': '一つ目' },
    ko: { 'test.first': '첫 번째' },
  });
  registerMessages({
    'zh-CN': { 'test.second': '第二条' },
    en: { 'test.second': 'Second' },
    ja: { 'test.second': '二つ目' },
    ko: { 'test.second': '두 번째' },
  });

  assert.equal(translate('en', 'test.first'), 'First');
  assert.equal(translate('en', 'test.second'), 'Second');
  assert.equal(translate('en', 'test.fallback', { count: 3 }), '后备：3');
});

test('active locale changes through the shared instance', async () => {
  await setActiveLocale('ja');
  assert.equal(i18n.language, 'ja');
  await setActiveLocale('zh-CN');
});
