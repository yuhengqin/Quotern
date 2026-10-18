import assert from 'node:assert/strict';
import test from 'node:test';
import { NATIVE_MESSAGES, nativeText } from './native-messages';

test('all native locales include the same keys and interpolation variables', () => {
  const reference = NATIVE_MESSAGES['zh-CN'];
  const expectedKeys = Object.keys(reference).sort();
  const variables = (message: string) => [...message.matchAll(/\{\{(\w+)\}\}/g)].map(match => match[1]).sort();
  for (const locale of ['en', 'ja', 'ko'] as const) {
    const messages = NATIVE_MESSAGES[locale];
    assert.deepEqual(Object.keys(messages).sort(), expectedKeys, `${locale} native keys`);
    for (const key of expectedKeys) {
      assert.deepEqual(variables(messages[key as keyof typeof messages]), variables(reference[key as keyof typeof reference]), `${locale}:${key} variables`);
    }
  }
});

test('notification copy formats a full translated sentence', () => {
  assert.equal(nativeText('en', 'native.quota.thresholdTitle', {
    provider: 'Codex', window: '5h', percent: 90,
  }), 'Codex 5h: 90% used');
});
