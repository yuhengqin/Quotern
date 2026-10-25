import assert from 'node:assert/strict';
import test from 'node:test';
import { translate } from 'quotern-i18n';

const locales = ['zh-CN', 'en', 'ja', 'ko'] as const;

test('initial dashboard messages register shell, usage, and achievement copy in every locale', async () => {
  const { registerInitialDashboardMessages } = await import('./register-initial.ts');
  registerInitialDashboardMessages();

  const keys = [
    'shell.demo.title',
    'usage.activity.pageTitle',
    'achievement.family.first',
  ];

  for (const locale of locales) {
    for (const key of keys) {
      const message = translate(locale, key);
      assert.notEqual(message, key, `${locale} should resolve ${key}`);
      assert.notEqual(message.trim(), '');
    }
  }
});
