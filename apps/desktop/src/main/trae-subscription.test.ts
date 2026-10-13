import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasCustomTraeConfiguration,
  parseTraeCredentials,
} from './trae-subscription';

test('accepts TRAE IDE session tokens but rejects BYOK API keys', () => {
  assert.deepEqual(parseTraeCredentials({ token: 'trae-ide-session-jwt-1234567890' }), {
    token: 'trae-ide-session-jwt-1234567890',
  });
  assert.deepEqual(parseTraeCredentials({ accessToken: 'trae-cn-session-token-1234567890' }), {
    token: 'trae-cn-session-token-1234567890',
  });
  assert.equal(parseTraeCredentials({ apiKey: 'sk-byok-trae-key-1234567890' }), null);
  assert.equal(parseTraeCredentials({ token: 'short' }), null);
  assert.equal(parseTraeCredentials(null), null);
});

test('accepts only the official TRAE API hosts', () => {
  assert.equal(hasCustomTraeConfiguration({}), false);
  assert.equal(hasCustomTraeConfiguration({ TRAE_BASE_URL: 'https://api.trae.ai/' }), false);
  assert.equal(hasCustomTraeConfiguration({ TRAE_BASE_URL: 'https://api.trae.com.cn' }), false);
  assert.equal(hasCustomTraeConfiguration({ TRAE_BASE_URL: 'https://proxy.example/v1' }), true);
});
