import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasCustomOpenCodeConfiguration,
  parseOpenCodeCredentials,
} from './opencode-subscription';

test('accepts OpenCode Go credentials from auth.json but rejects BYOK tokens', () => {
  assert.deepEqual(parseOpenCodeCredentials({ go: { token: 'opencode-go-credential-1234567890' } }), {
    token: 'opencode-go-credential-1234567890',
  });
  assert.equal(parseOpenCodeCredentials({ apiKey: 'sk-byok-token-1234567890' }), null);
  assert.equal(parseOpenCodeCredentials({ token: 'opencode-go-credential-0987654321' }), null);
  assert.equal(parseOpenCodeCredentials({ go: { token: '' } }), null);
  assert.equal(parseOpenCodeCredentials(null), null);
});

test('accepts only the official OpenCode API hosts', () => {
  assert.equal(hasCustomOpenCodeConfiguration({}), false);
  assert.equal(hasCustomOpenCodeConfiguration({ OPENCODE_BASE_URL: 'https://opencode.ai/' }), false);
  assert.equal(hasCustomOpenCodeConfiguration({ OPENCODE_BASE_URL: 'https://proxy.example/v1' }), true);
  assert.equal(hasCustomOpenCodeConfiguration({ OPENCODE_BASE_URL: 'not a url' }), true);
});
