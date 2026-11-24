import assert from 'node:assert/strict';
import test from 'node:test';
import { allowsLocalApiRequest } from './local-api-access';

const pricing = '/functions/tud-local-admin/pricing';

test('a pricing reference window can read, save, and recalculate manual prices', () => {
  for (const method of ['GET', 'POST']) {
    assert.equal(allowsLocalApiRequest('reference-pricing-3', pricing, method), true);
    assert.equal(allowsLocalApiRequest('reference-pricing-3', pricing + '/recalculation', method), true);
  }
});

test('pricing reference access stays scoped to the pricing endpoints and methods', () => {
  assert.equal(allowsLocalApiRequest('reference-pricing-3', pricing, 'DELETE'), false);
  assert.equal(allowsLocalApiRequest('reference-pricing-3', pricing + '/other', 'GET'), false);
  assert.equal(allowsLocalApiRequest('reference-pricing-3', '/functions/tud-local-admin/backup', 'GET'), false);
  for (const window of ['reference-session-4', 'tray']) {
    assert.equal(allowsLocalApiRequest(window, pricing, 'GET'), false);
    assert.equal(allowsLocalApiRequest(window, pricing, 'POST'), false);
  }
  assert.equal(allowsLocalApiRequest('reference-session-4', '/functions/tud-session-actions', 'POST'), true);
  assert.equal(allowsLocalApiRequest('tray', '/functions/tud-usage-summary', 'GET'), true);
});
