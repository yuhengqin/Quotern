import assert from 'node:assert/strict';
import test from 'node:test';
import { QuotaManager } from '../src/quota/readers/quota-manager.js';
import { DEFAULT_QUOTA_PREFERENCES } from '../src/quota/shared/quota.js';

for (const declaredRetry of [undefined, 600]) {
  test(`resume retries a local failure but preserves server Retry-After=${declaredRetry}`, async () => {
    let time = 1_800_000_000, calls = 0;
    const manager = new QuotaManager({ now: () => time, monotonic: () => time * 1000,
      readers: [{ id: 'codex', label: 'Codex', interval: 180, read: async () => {
        calls++; return { status: 'unavailable', ...(declaredRetry ? { retryAfterSeconds: declaredRetry } : {}) };
      } }],
      store: { preferences: structuredClone(DEFAULT_QUOTA_PREFERENCES), history: {}, notice: null,
        savePreferences: async () => {}, saveHistory: async () => {} }, notify: () => {},
    });
    try {
      await manager.refresh('startup');
      time += 15;
      await manager.refresh('resume');
      assert.equal(calls, declaredRetry ? 1 : 2);
      if (declaredRetry) { time += 600; await manager.refresh('resume'); assert.equal(calls, 2); }
    } finally { manager.dispose(); }
  });
}
