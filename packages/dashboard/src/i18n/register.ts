import { registerMessages } from 'quotern-i18n';
import { achievementRankMessages } from './achievement-rank-messages';
import { pricingMessages } from './pricing-messages';
import { settingsMessages } from './settings-messages';
import { shareMessages } from './share-messages';
import { shellUiMessages } from './shell-ui-messages';
import { usageMessages } from './usage-messages';

/** Register browser product copy before either React entry renders. */
export function registerDashboardMessages(): void {
  registerMessages(settingsMessages);
  registerMessages(shellUiMessages);
  registerMessages(usageMessages);
  registerMessages(pricingMessages);
  registerMessages(achievementRankMessages);
  registerMessages(shareMessages);
}
