import assert from 'node:assert/strict';
import test from 'node:test';
import {
  hasCustomMiniMaxConfiguration,
  parseMiniMaxCredentials,
} from './minimax-subscription';

test('accepts only MiniMax Coding Plan keys with the official sk-cp- prefix', () => {
  assert.deepEqual(parseMiniMaxCredentials('sk-cp-global-prod-token-1234567890'), {
    token: 'sk-cp-global-prod-token-1234567890',
    region: 'global',
  });
  assert.deepEqual(parseMiniMaxCredentials({ apiKey: 'sk-cp-cn-account-token-9876543210' }), {
    token: 'sk-cp-cn-account-token-9876543210',
    region: 'mainland',
  });
  assert.equal(parseMiniMaxCredentials('sk-pay-as-you-go-key-1234'), null);
  assert.equal(parseMiniMaxCredentials('sk-cp-'), null);
  assert.equal(parseMiniMaxCredentials({ apiKey: 'sk-other-token' }), null);
  assert.equal(parseMiniMaxCredentials(null), null);
});

test('accepts only the official MiniMax Code API domains', () => {
  assert.equal(hasCustomMiniMaxConfiguration({}), false);
  assert.equal(hasCustomMiniMaxConfiguration({ MINIMAX_CODE_BASE_URL: 'https://api.minimax.io/' }), false);
  assert.equal(hasCustomMiniMaxConfiguration({ MINIMAX_CODE_BASE_URL: 'https://api.minimaxi.com' }), false);
  assert.equal(hasCustomMiniMaxConfiguration({ MINIMAX_CODE_BASE_URL: 'https://proxy.example/v1' }), true);
});
