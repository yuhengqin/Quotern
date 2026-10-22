import { registerMessages } from 'quotern-i18n';
import { achievementRankMessages } from './achievement-rank-messages.ts';
import { shellUiMessages } from './shell-ui-messages.ts';
import { usageMessages } from './usage-messages.ts';

/** Register the copy needed by the initial browser dashboard shell. */
export function registerInitialDashboardMessages(): void {
  registerMessages(shellUiMessages);
  registerMessages(usageMessages);
  registerMessages(achievementRankMessages);
}
