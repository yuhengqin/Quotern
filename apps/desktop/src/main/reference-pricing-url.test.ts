import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isReferencePricingUrl, isReferenceSessionUrl } from './reference-pricing-url.js';

test('independent sessions allow only exact identities in the same trusted renderer', () => {
  for (const entry of ['file:///C:/Quotern/out/renderer/index.html', 'http://localhost:5195/']) {
    assert.equal(isReferenceSessionUrl(`${entry}#/sessions?sessionSource=codex&sessionId=a`, entry), true);
    for (const route of ['/sessions', '/sessions?sessionSource=codex', '/sessions?sessionSource=pi&sessionId=a', '/sessions?sessionSource=codex&sessionId=%00', '/pricing?sessionSource=codex&sessionId=a']) {
      assert.equal(isReferenceSessionUrl(`${entry}#${route}`, entry), false, route);
    }
    assert.equal(isReferenceSessionUrl('https://example.com/#/sessions?sessionSource=codex&sessionId=a', entry), false);
  }
});

test('pricing references accept only the current renderer document in file and development modes', () => {
  for (const entry of ['file:///C:/Quotern/out/renderer/index.html', 'http://localhost:5195/', 'http://localhost:5195/app/?dev=1']) {
    assert.equal(isReferencePricingUrl(`${entry}#/pricing?q=&models=%5B%7B%22model%22%3A%22gpt%22%7D%5D`, `${entry}#/sessions?sessionId=a`), true);
  }
});

test('other documents, origins, routes, protocols and credentials cannot receive a reference preload', () => {
  const current = 'file:///C:/Quotern/out/renderer/index.html#/sessions';
  for (const target of ['file:///C:/other/index.html#/pricing', 'file:///C:/Quotern/out/renderer/index.html?other=1#/pricing', 'file:///C:/Quotern/out/renderer/index.html#/pricing-other', 'file:///C:/Quotern/out/renderer/index.html#/sessions', 'file://other/C:/Quotern/out/renderer/index.html#/pricing', 'https://example.com/#/pricing', 'about:blank', 'javascript:alert(1)', 'not a URL']) {
    assert.equal(isReferencePricingUrl(target, current), false, target);
  }
  for (const target of ['http://localhost:5196/#/pricing', 'http://localhost:5195/other#/pricing', 'http://user:pass@localhost:5195/#/pricing']) {
    assert.equal(isReferencePricingUrl(target, 'http://localhost:5195/#/sessions'), false, target);
  }
});
