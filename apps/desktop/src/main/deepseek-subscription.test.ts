import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasCustomDeepSeekConfiguration,
  parseDeepSeekCredentials,
} from './deepseek-subscription';

test('accepts DeepSeek tokens from common credential fields but rejects BYOK markers', () => {
  assert.deepEqual(parseDeepSeekCredentials({ api_key: 'sk-deepseek-1234567890abcdef' }), {
    token: 'sk-deepseek-1234567890abcdef',
  });
  assert.deepEqual(parseDeepSeekCredentials({ auth: { token: 'sk-deepseek-abcdef1234567890' } }), {
    token: 'sk-deepseek-abcdef1234567890',
  });
  assert.equal(parseDeepSeekCredentials({ apiKey: '' }), null);
  assert.equal(parseDeepSeekCredentials(null), null);
});

test('accepts only the official DeepSeek API host', () => {
  assert.equal(hasCustomDeepSeekConfiguration({}), false);
  assert.equal(hasCustomDeepSeekConfiguration({ DEEPSEEK_BASE_URL: 'https://api.deepseek.com/' }), false);
  assert.equal(hasCustomDeepSeekConfiguration({ DEEPSEEK_BASE_URL: 'https://proxy.example/v1' }), true);
});
