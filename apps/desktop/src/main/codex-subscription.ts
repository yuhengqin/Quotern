export * from 'quotern-core/quota/readers/codex-subscription';
import { createDefaultCodexSubscriptionReader } from 'quotern-core/quota/readers/codex-subscription';
import { quotaFetch } from './quota-fetch';

/** Desktop keeps Chromium networking; the CLI uses the Node implementation. */
export const readCodexSubscription = createDefaultCodexSubscriptionReader(quotaFetch);
