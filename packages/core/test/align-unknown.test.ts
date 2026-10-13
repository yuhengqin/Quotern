import assert from 'node:assert/strict';
import test from 'node:test';

import { alignUnknownIntoDominant } from '../src/queue/align-unknown.js';
import type { QueueBucket } from '../src/types.js';

function row(partial: Partial<QueueBucket> & Pick<QueueBucket, 'model'>): QueueBucket {
  return {
    hour_start: '2026-08-21T02:00:00.000Z',
    source: 'codex',
    project: 'ATQQ/alipay-service',
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    total_tokens: 0,
    conversation_count: 0,
    ...partial,
  };
}

test('alignUnknownIntoDominant folds unknown into the largest known model', () => {
  const aligned = alignUnknownIntoDominant([
    row({ model: 'unknown', input_tokens: 10, output_tokens: 2, total_tokens: 12, conversation_count: 1 }),
    row({ model: 'gpt-4o', input_tokens: 20, output_tokens: 3, total_tokens: 23, conversation_count: 1 }),
    row({ model: 'gpt-4o-mini', input_tokens: 30, output_tokens: 4, total_tokens: 34, conversation_count: 1 }),
  ]);
  const byModel = new Map(aligned.map((bucket) => [bucket.model, bucket]));
  assert.equal(byModel.has('unknown'), false);
  assert.equal(byModel.get('gpt-4o')?.total_tokens, 23);
  assert.equal(byModel.get('gpt-4o-mini')?.total_tokens, 46);
  assert.equal(byModel.get('gpt-4o-mini')?.conversation_count, 2);
});

test('alignUnknownIntoDominant retracts a previously queued unknown row', () => {
  const aligned = alignUnknownIntoDominant(
    [
      row({ model: 'unknown', input_tokens: 10, total_tokens: 10, conversation_count: 1 }),
      row({ model: 'deepseek-v4-flash', input_tokens: 5, total_tokens: 5, conversation_count: 1 }),
    ],
    { retractUnknown: true },
  );
  const byModel = new Map(aligned.map((bucket) => [bucket.model, bucket]));
  assert.equal(byModel.get('unknown')?.total_tokens, 0);
  assert.equal(byModel.get('unknown')?.conversation_count, 0);
  assert.equal(byModel.get('deepseek-v4-flash')?.total_tokens, 15);
});

test('alignUnknownIntoDominant leaves unknown alone without a known model', () => {
  const unknown = row({ model: 'unknown', total_tokens: 76, conversation_count: 1 });
  const aligned = alignUnknownIntoDominant([unknown]);
  assert.equal(aligned.length, 1);
  assert.equal(aligned[0]?.model, 'unknown');
  assert.equal(aligned[0]?.total_tokens, 76);
});

test('alignUnknownIntoDominant folds other sources the same way', () => {
  const aligned = alignUnknownIntoDominant([
    row({
      source: 'claude',
      model: 'unknown',
      total_tokens: 10,
      conversation_count: 1,
    }),
    row({
      source: 'claude',
      model: 'claude-opus-4-6',
      total_tokens: 20,
      conversation_count: 1,
    }),
  ]);
  assert.equal(aligned.find((bucket) => bucket.model === 'unknown'), undefined);
  assert.equal(aligned.find((bucket) => bucket.model === 'claude-opus-4-6')?.total_tokens, 30);
});

test('every-code unknown borrows the nearest Codex dominant model', () => {
  const aligned = alignUnknownIntoDominant(
    [
      row({
        source: 'every-code',
        hour_start: '2026-08-21T02:00:00.000Z',
        model: 'unknown',
        total_tokens: 40,
        conversation_count: 1,
      }),
    ],
    {
      contextBuckets: [
        row({
          source: 'codex',
          hour_start: '2026-08-21T01:30:00.000Z',
          model: 'gpt-5.4',
          total_tokens: 100,
        }),
        row({
          source: 'codex',
          hour_start: '2026-08-21T03:00:00.000Z',
          model: 'gpt-5.6-sol',
          total_tokens: 80,
        }),
      ],
    },
  );
  assert.equal(aligned.find((bucket) => bucket.model === 'unknown'), undefined);
  assert.equal(aligned.find((bucket) => bucket.model === 'gpt-5.4')?.source, 'every-code');
  assert.equal(aligned.find((bucket) => bucket.model === 'gpt-5.4')?.total_tokens, 40);
});

test('every-code unknown stays when no Codex context exists', () => {
  const aligned = alignUnknownIntoDominant([
    row({
      source: 'every-code',
      model: 'unknown',
      total_tokens: 40,
      conversation_count: 1,
    }),
  ]);
  assert.equal(aligned[0]?.model, 'unknown');
  assert.equal(aligned[0]?.total_tokens, 40);
});
