import assert from 'node:assert/strict';
import test from 'node:test';
import { isAbsolute, join } from 'node:path';
import { resolveQuotaPreviewConfig } from './quota-preview';

const env = {
  QUOTERN_DEV_QUOTA_PREVIEW: '1', QUOTERN_DEV_ISOLATED: '1',
  QUOTERN_DATA_DIR: join(process.cwd(), '.mock/data'),
  QUOTERN_CONFIG_HOME: join(process.cwd(), '.mock/config'),
  QUOTERN_DESKTOP_USER_DATA: join(process.cwd(), '.mock/electron'),
};

test('quota preview requires unpackaged, explicitly enabled and isolated development', () => {
  assert.throws(() => resolveQuotaPreviewConfig(env, true));
  assert.throws(() => resolveQuotaPreviewConfig({ ...env, QUOTERN_DEV_QUOTA_PREVIEW: undefined }, false));
  assert.throws(() => resolveQuotaPreviewConfig({ ...env, QUOTERN_DEV_ISOLATED: undefined }, false));
  for (const key of ['QUOTERN_DATA_DIR', 'QUOTERN_CONFIG_HOME', 'QUOTERN_DESKTOP_USER_DATA']) {
    assert.throws(() => resolveQuotaPreviewConfig({ ...env, [key]: 'relative/path' }, false));
    assert.throws(() => resolveQuotaPreviewConfig({ ...env, [key]: undefined }, false));
  }
});

test('quota preview accepts only a local root URL and uses a separate browser profile', () => {
  const config = resolveQuotaPreviewConfig(env, false);
  assert.equal(config.url, 'http://127.0.0.1:5173/?scene=mixed');
  assert.ok(isAbsolute(config.userData));
  assert.equal(config.userData, join(env.QUOTERN_DESKTOP_USER_DATA, 'quota-preview'));
  for (const url of ['https://example.com', 'http://127.0.0.1:5173/other', 'file:///tmp/mock.html', 'http://user:secret@localhost:5173/']) {
    assert.throws(() => resolveQuotaPreviewConfig({ ...env, QUOTERN_QUOTA_PREVIEW_URL: url }, false));
  }
  assert.equal(new URL(resolveQuotaPreviewConfig({ ...env, QUOTERN_QUOTA_PREVIEW_URL: 'http://localhost:5200/' }, false).url).port, '5200');
});
