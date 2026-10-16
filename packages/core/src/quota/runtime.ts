import { SUBSCRIPTION_CHANNELS } from './shared/subscription-channels.js';
import type { QuotaServiceStatus } from './shared/quota.js';
import { QuotaManager, type QuotaReader, type QuotaNotification } from './readers/quota-manager.js';
import type { QuotaState } from './shared/quota.js';
import { openQuotaStore } from './readers/quota-store.js';
import { captureQuotaRead } from './readers/quota-fetch-state.js';
import { createDefaultCodexSubscriptionReader } from './readers/codex-subscription.js';
import { readClaudeSubscription } from './readers/claude-subscription.js';
import { readCursorSubscription } from './readers/cursor-subscription.js';
import { readCopilotSubscription } from './readers/copilot-subscription.js';
import { readGrokSubscription } from './readers/grok-subscription.js';
import { readKimiSubscriptions } from './readers/kimi-subscription.js';
import { readZcodeSubscription } from './readers/zcode-subscription.js';
import { readAntigravitySubscription } from './readers/antigravity-subscription.js';
import { readQoderSubscription } from './readers/qoder-subscription.js';
import { readMiniMaxSubscription } from './readers/minimax-subscription.js';
import { readDeepSeekSubscription } from './readers/deepseek-subscription.js';
import { readOpenCodeSubscription } from './readers/opencode-subscription.js';
import { selectKimiSubscription } from './shared/kimi-selection.js';

export { QuotaManager } from './readers/quota-manager.js';
const STATUS_URLS: Record<string, string> = { codex: 'https://status.openai.com/', claude: 'https://status.claude.com/', cursor: 'https://status.cursor.com/', copilot: 'https://www.githubstatus.com/' };

export function parseQuotaServiceStatus(value: unknown): QuotaServiceStatus['level'] {
  const indicator = (value as { status?: { indicator?: unknown } } | null)?.status?.indicator;
  const levels: Record<string, QuotaServiceStatus['level']> = { none: 'operational', minor: 'minor', major: 'major', critical: 'critical', maintenance: 'maintenance' };
  if (typeof indicator !== 'string' || !Object.hasOwn(levels, indicator)) throw new Error('未知服务状态');
  return levels[indicator];
}

export async function createQuotaRuntime(options: {
  directory: string;
  onChanged?(state: QuotaState): void;
  notify?(notification: QuotaNotification): void;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
}) {
  const force = { forceRefresh: true };
  const codex = createDefaultCodexSubscriptionReader(options.fetch);
  const reads: Record<string, () => Promise<unknown>> = {
    codex: () => codex(force), claude: () => readClaudeSubscription(force),
    cursor: () => readCursorSubscription(force), copilot: () => readCopilotSubscription(force),
    grok: () => readGrokSubscription(force), zcode: () => readZcodeSubscription(force),
    kimi: async () => selectKimiSubscription(await readKimiSubscriptions(force)),
    antigravity: () => readAntigravitySubscription(force), qoder: () => readQoderSubscription(force),
    minimax: () => readMiniMaxSubscription(force), deepseek: () => readDeepSeekSubscription(force),
    opencode: () => readOpenCodeSubscription(force),
  };
  const readers: QuotaReader[] = SUBSCRIPTION_CHANNELS.map(channel => ({ ...channel,
    interval: channel.id === 'codex' ? 180 : channel.id === 'copilot' ? 900 : channel.id === 'antigravity' ? 600 : 300,
    read: () => captureQuotaRead(reads[channel.id]), statusUrl: STATUS_URLS[channel.id] }));
  return new QuotaManager({ readers, store: await openQuotaStore(options.directory),
    notify: options.notify ?? (() => {}), onChanged: options.onChanged,
    fetchStatus: async url => {
      if (!Object.values(STATUS_URLS).includes(url)) throw new Error('unsupported status source');
      const response = await (options.fetch ?? fetch)(new URL('api/v2/status.json', url).toString(), { signal: AbortSignal.timeout(15000), credentials: 'omit', redirect: 'error', cache: 'no-store' });
      if (!response.ok) throw new Error('status unavailable');
      const body = await response.text();
      if (body.length > 256 * 1024) throw new Error('status response too large');
      return parseQuotaServiceStatus(JSON.parse(body));
    },
  });
}
