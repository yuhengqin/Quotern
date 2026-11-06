import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyManualRateDraft, validateManualRateDraft } from './manual-pricing-form.ts';

test('price draft distinguishes free, inherited and invalid rates and maps errors to fields', () => {
  const draft = emptyManualRateDraft();
  assert.deepEqual(validateManualRateDraft('', draft).errors, { model: 'admin.invalidModel', rates: 'admin.rateRequired' });
  assert.deepEqual(validateManualRateDraft('custom-model', { ...draft, input: '0', output: '  ' }).rates, { input: 0 });
  assert.deepEqual(validateManualRateDraft('custom-model', { ...draft, output: '-1' }).errors, { output: 'admin.invalidRate' });
  assert.equal(validateManualRateDraft('__proto__', { ...draft, input: '1' }).valid, false);
  assert.equal(validateManualRateDraft('custom-model', { ...draft, input: 'NaN' }, true).valid, true, 'restoring ignores unsaved invalid rate fields');
});
