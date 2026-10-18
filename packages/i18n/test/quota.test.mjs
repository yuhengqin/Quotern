import test from 'node:test';
import assert from 'node:assert/strict';
import { localizeQuotaWindowLabel, localizeQuotaDetail, localizeQuotaPaceLabel, localizeQuotaPaceDescription } from '../dist/quota.js';

test('fixed quota labels use semantic period and provider identity', () => {
  const window = { id: 'account:18000', label: '5h', periodSeconds: 18000 };
  assert.equal(localizeQuotaWindowLabel('en', 'codex', window), '5-hour limit');
  assert.equal(localizeQuotaWindowLabel('ja', 'codex', { ...window, groupLabel: 'Opus' }), 'Opus モデル 5 時間の上限');
  assert.equal(localizeQuotaWindowLabel('ko', 'cursor', { id: 'cursorModels', label: 'Cursor' }), 'Cursor 모델 한도');
  assert.equal(localizeQuotaWindowLabel('en', 'custom', { id: 'custom', label: 'My pool' }), 'My pool');
});

test('quota value kind and pace use stable semantics', () => {
  assert.deepEqual(localizeQuotaDetail('en', { id: 'chat-completions', label: '聊天与代码补全', text: '无限', valueKind: 'unlimited' }), { label: 'Chat and code completions', text: 'Unlimited' });
  const pace = { paceDifference: -14, paceBasis: 'automatic' };
  assert.equal(localizeQuotaPaceLabel('en', pace), 'Using faster');
  assert.equal(localizeQuotaPaceDescription('en', { usedPercent: 54 }, pace), '54% used; 40% expected based on past usage.');
});
