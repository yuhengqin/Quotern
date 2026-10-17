import assert from 'node:assert/strict';
import test from 'node:test';
import { settingsMessages } from '../packages/dashboard/src/i18n/settings-messages.ts';
import { shellUiMessages } from '../packages/dashboard/src/i18n/shell-ui-messages.ts';
import { usageMessages } from '../packages/dashboard/src/i18n/usage-messages.ts';
import { pricingMessages } from '../packages/dashboard/src/i18n/pricing-messages.ts';
import { achievementRankMessages } from '../packages/dashboard/src/i18n/achievement-rank-messages.ts';
import { shareMessages } from '../packages/dashboard/src/i18n/share-messages.ts';
import { desktopRendererMessages } from '../apps/desktop/src/renderer/i18n/desktop-renderer-messages.ts';
import { desktopShellMessages } from '../apps/desktop/src/renderer/i18n/desktop-shell-messages.ts';
import { desktopSubscriptionMessages } from '../apps/desktop/src/renderer/i18n/desktop-subscription-messages.ts';
import { NATIVE_MESSAGES } from '../apps/desktop/src/main/native-messages.ts';
import { cliMessages } from '../packages/cli/src/i18n/messages.ts';

const locales = ['zh-CN', 'en', 'ja', 'ko'];
const catalogs = {
  settings: settingsMessages,
  shell: shellUiMessages,
  usage: usageMessages,
  pricing: pricingMessages,
  achievements: achievementRankMessages,
  share: shareMessages,
  desktopRenderer: desktopRendererMessages,
  desktopShell: desktopShellMessages,
  desktopSubscriptions: desktopSubscriptionMessages,
  native: NATIVE_MESSAGES,
  cli: cliMessages,
};

function placeholders(message) {
  return [...message.matchAll(/\{\{\s*-?\s*([\w.]+)\s*\}\}/g)]
    .map(match => match[1]).sort();
}

test('shipped locale catalogs have the same keys and interpolation variables', () => {
  for (const [name, catalog] of Object.entries(catalogs)) {
    const baseKeys = Object.keys(catalog['zh-CN']).sort();
    assert.ok(baseKeys.length > 0, `${name} has no messages`);
    for (const locale of locales) {
      const translatedKeys = Object.keys(catalog[locale]).sort();
      assert.deepEqual(translatedKeys, baseKeys, `${name} ${locale} message keys`);
      for (const key of baseKeys) {
        const message = catalog[locale][key];
        assert.equal(typeof message, 'string', `${name} ${locale} ${key}`);
        assert.ok(message.length > 0, `${name} ${locale} ${key} is empty`);
        assert.deepEqual(placeholders(message), placeholders(catalog['zh-CN'][key]),
          `${name} ${locale} ${key} interpolation variables`);
      }
    }
  }
});
