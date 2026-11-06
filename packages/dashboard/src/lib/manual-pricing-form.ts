import type { ModelPricingRates } from 'quotern-core';

export const manualRateFields = ['input', 'output', 'cache_read', 'cache_write'] as const;
export type ManualRateField = typeof manualRateFields[number];
export type ManualRateDraft = Record<ManualRateField, string>;
export const emptyManualRateDraft = (): ManualRateDraft => ({ input: '', output: '', cache_read: '', cache_write: '' });
export function manualRateDraft(rates?: ModelPricingRates): ManualRateDraft {
  return Object.fromEntries(manualRateFields.map(field => [field, rates?.[field]?.toString() ?? ''])) as ManualRateDraft;
}
export function validateManualRateDraft(model: string, values: ManualRateDraft, remove = false) {
  const errors: Partial<Record<ManualRateField | 'model' | 'rates', string>> = {};
  const id = model.trim();
  if (!id || id.length > 200 || /[\u0000-\u001f\u007f]/.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id)) errors.model = 'admin.invalidModel';
  const rates: ModelPricingRates = {};
  for (const field of manualRateFields) if (values[field].trim() !== '') {
    const value = Number(values[field]);
    if (!Number.isFinite(value) || value < 0 || value > 1_000_000) { if (!remove) errors[field] = 'admin.invalidRate'; }
    else rates[field] = value;
  }
  if (!remove && !Object.keys(rates).length && !manualRateFields.some(field => errors[field])) errors.rates = 'admin.rateRequired';
  return { id, rates, errors, valid: Object.keys(errors).length === 0 };
}
