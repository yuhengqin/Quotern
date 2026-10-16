import assert from 'node:assert/strict';
import test from 'node:test';
import { codexQuotaWindows } from './quota-provider-windows';
import { parseClaudeUsageResult } from '../main/claude-usage-parser';

test('Codex retains actual duration and named limits with stable distinct IDs', () => {
  const result = codexQuotaWindows({ rate_limit: { primary_window: { used_percent: 10, limit_window_seconds: 604800, reset_at: 100 } },
    additional_rate_limits: [{ limit_name: 'Model A', metered_feature: 'model-a', rate_limit: { primary_window: { used_percent: 90, limit_window_seconds: 18000 } } }] });
  assert.equal(result[0].durationSeconds, 604800);
  assert.equal(result[0].label, '7d');
  assert.equal(result[1].groupLabel, 'Model A');
  assert.notEqual(result[0].id, result[1].id);
});

test('Claude CLI model-scoped weeks remain distinct from account-wide totals', () => {
  const result = parseClaudeUsageResult(JSON.stringify({ result: 'Current week (all models): 20% used\nCurrent week (Fable): 80% used' }));
  assert.equal(result.sevenDay?.usedPercent, 20);
  assert.equal(result.windows?.length, 2);
  assert.equal(result.windows?.[1].groupLabel, 'Fable');
});
