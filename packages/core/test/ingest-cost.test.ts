import assert from 'node:assert/strict';
import test from 'node:test';

import { aggregateForIngest } from '../src/aggregate.js';
import type { QueueBucket } from '../src/types.js';

function makeRow(
  partial: Partial<QueueBucket> & Pick<QueueBucket, 'source' | 'model'>,
): QueueBucket {
  return {
    hour_start: '2026-07-09T10:00:00.000Z',
    project: 'unknown',
    input_tokens: 100,
    output_tokens: 50,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 150,
    conversation_count: 1,
    ...partial,
  };
}

test('aggregateForIngest sums reported_cost_usd across matching buckets', () => {
  const buckets = aggregateForIngest([
    makeRow({
      source: 'cursor',
      model: 'composer-1',
      reported_cost_usd: 0.05,
    }),
    makeRow({
      source: 'cursor',
      model: 'composer-1',
      reported_cost_usd: 0.02,
      input_tokens: 10,
      output_tokens: 5,
      total_tokens: 15,
    }),
  ]);

  assert.equal(buckets.length, 1);
  assert.equal(buckets[0]!.reported_cost_usd, 0.07);
  assert.equal(buckets[0]!.input_tokens, 110);
});

test('aggregateForIngest merges across projects and omits project from ingest', () => {
  const buckets = aggregateForIngest([
    makeRow({
      source: 'claude',
      model: 'claude-opus-4-6',
      project: 'quotern',
      input_tokens: 100,
      output_tokens: 50,
      total_tokens: 150,
    }),
    makeRow({
      source: 'claude',
      model: 'claude-opus-4-6',
      project: 'docs-site',
      input_tokens: 200,
      output_tokens: 100,
      total_tokens: 300,
    }),
  ]);

  assert.equal(buckets.length, 1);
  assert.equal(buckets[0]!.total_tokens, 450);
  assert.equal('project' in buckets[0]!, false);

});
