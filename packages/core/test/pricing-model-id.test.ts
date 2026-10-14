import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolvePricingModelId, type PricingData } from '../src/pricing/matcher.js';

const data: PricingData = {
  exact: {
    'openai/gpt-6.1-sol': { input: 2 },
    'openai/gpt-6.1-sol-fast': { input: 4 },
    'anthropic/claude-opus-5-5': { input: 4 },
    'anthropic/claude-opus-5-5-20260922': { input: 4 },
    'alibaba/qwen3': { input: 1 },
    'alibaba-cn/qwen3': { input: 1 },
  },
  alias: { 'opus-5.5': 'anthropic/claude-opus-5-5' },
  sourceAlias: {
    codex: { auto: 'openai/gpt-6.1-sol' },
    claude: { auto: 'anthropic/claude-opus-5-5' },
  },
  fuzzy: [{ match: 'gpt', ref: 'openai/gpt-6.1-sol' }],
  default: { input: 2 },
};

const resolve = (model: string, source?: string) => resolvePricingModelId(model, data, source);

for (const [model, source, expected] of [
  ['openai/gpt-6.1-sol', 'codex', 'openai/gpt-6.1-sol'],
  ['GPT-6.1-SOL', 'codex', 'openai/gpt-6.1-sol'],
  ['gpt-6-1-sol', 'codex', 'openai/gpt-6.1-sol'],
  ['gpt-6.1-sol-high', 'codex', 'openai/gpt-6.1-sol'],
  ['gpt-6.1-sol-high-fast', 'codex', 'openai/gpt-6.1-sol-fast'],
  ['gpt-6.1-sol-fast', 'codex', 'openai/gpt-6.1-sol-fast'],
  ['Claude Opus 5.5', 'claude', 'anthropic/claude-opus-5-5'],
  ['opus-5.5', 'pi', 'anthropic/claude-opus-5-5'],
  ['auto', 'claude', 'anthropic/claude-opus-5-5'],
  ['auto', 'codex', 'openai/gpt-6.1-sol'],
  ['anthropic/claude-opus-5-5-20260922', 'claude', 'anthropic/claude-opus-5-5-20260922'],
  ['alibaba-cn/qwen3', 'pi', 'alibaba-cn/qwen3'],
  ['qwen3', 'pi', null],
  ['future-gpt-99', 'codex', null],
  ['gpt-6.1-sol-flex', 'codex', null],
  ['unknown', 'pi', null],
] as const) {
  test(`resolves ${source}/${model} without guessing model identity`, () => {
    assert.equal(resolve(model, source), expected);
  });
}
