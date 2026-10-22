import assert from 'node:assert/strict';
import test from 'node:test';
import { PetCatalogError, petCatalogFailure, petCatalogMessageKey } from './pet-catalog-errors.js';
import { nativeText } from './native-messages.js';

test('catalog diagnostics retain proxy and DNS codes without request secrets or file paths', () => {
  const request = { action: 'install-url' as const, url: 'https://codex-pets.net/#/pets/clawd?signature=secret-marker' };
  for (const cause of [new Error('net::ERR_PROXY_CONNECTION_FAILED Bearer secret-marker'), new TypeError('secret-marker', { cause: { code: 'ENOTFOUND', path: 'C:/private/secret-marker' } })]) {
    const error = new PetCatalogError('PET_DOWNLOAD_NETWORK', 'download', 'secret-marker', { cause, petId: 'clawd' });
    const entry = petCatalogFailure(request, error);
    assert.equal(entry.event, 'pet_catalog_failed');
    assert.equal(entry.action, 'install-url');
    assert.equal(entry.phase, 'download');
    assert.ok(['ERR_PROXY_CONNECTION_FAILED', 'ENOTFOUND'].includes(String(entry.diagnosticCode)));
    assert.deepEqual(entry.petIds, ['clawd']);
    assert.doesNotMatch(JSON.stringify(entry), /secret-marker|Bearer|signature|https:|private/);
  }
});

test('catalog diagnostics tolerate invalid requests and cyclic causes', () => {
  const error = { name: 'secret-marker', code: 'secret-marker', cause: null as unknown };
  error.cause = error;
  assert.deepEqual(petCatalogFailure(undefined as never, error), {
    event: 'pet_catalog_failed', action: 'unknown', phase: 'catalog', code: 'PET_CATALOG_FAILED', diagnosticCode: 'UNKNOWN', causeType: 'Error', petIds: [],
  });
});

test('download diagnostics produce specific messages in every supported language', () => {
  const failures = [new PetCatalogError('PET_DOWNLOAD_NETWORK', 'download', ''), new PetCatalogError('PET_DOWNLOAD_TIMEOUT', 'download', ''), new PetCatalogError('PET_DOWNLOAD_HTTP', 'download', '', { httpStatus: 503 })];
  for (const locale of ['zh-CN', 'en', 'ja', 'ko'] as const) {
    for (const error of failures) {
      const key = petCatalogMessageKey(error);
      assert.ok(key);
      const message = nativeText(locale, key, { status: error.httpStatus ?? '' });
      assert.notEqual(message, nativeText(locale, 'native.pet.operationFailed'));
      if (error.httpStatus) assert.match(message, /503/);
    }
  }
});
