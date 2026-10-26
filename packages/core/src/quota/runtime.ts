import { SUBSCRIPTION_CHANNELS } from './shared/subscription-channels.js';
import type { QuotaServiceStatus } from './shared/quota.js';
import { QuotaManager, type QuotaReader, type QuotaNotification } from './readers/quota-manager.js';
import type { QuotaState, QuotaProfile } from './shared/quota.js';
import { openQuotaStore } from './readers/quota-store.js';
import { captureQuotaRead, quotaNodeFetch } from './readers/quota-fetch-state.js';
import { createDefaultCodexSubscriptionReader } from './readers/codex-subscription.js';
import { createDefaultClaudeSubscriptionReader } from './readers/claude-subscription.js';
import { createDefaultGeminiSubscriptionReader } from './readers/gemini-subscription.js';
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
import { createOMPQuotaObservationReader, selectQuotaObservation, type OMPQuotaObservation } from './readers/quota-observations.js';
import { createQuotaSnapshotPublisher } from './snapshot.js';
import { projectQuotaReport, type QuotaRuntimeSource } from './report.js';
import { QUOTA_PROVIDER_DESCRIPTORS, getQuotaProviderDescriptor, type QuotaProviderId } from './shared/provider-descriptors.js';

export { QuotaManager } from './readers/quota-manager.js';
const STATUS_URLS: Record<string, string> = Object.fromEntries(QUOTA_PROVIDER_DESCRIPTORS.filter(p => p.statusPage).map(p => [p.id, p.statusPage!.url]));

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
  snapshot?: { directory: string; runtime: QuotaRuntimeSource };
}) {
  const publisher = options.snapshot && createQuotaSnapshotPublisher(options.snapshot.directory, options.snapshot.runtime);
  const force = { forceRefresh: true };
  const codex = createDefaultCodexSubscriptionReader(options.fetch);
  const claude = createDefaultClaudeSubscriptionReader();
  const gemini = createDefaultGeminiSubscriptionReader(options.fetch);
  const readObservations = createOMPQuotaObservationReader();
  let observations: OMPQuotaObservation[] = [];
  const withObservations = (provider: string, read: () => Promise<unknown>) => async () => {
    const native = await read();
    if (!native || typeof native !== 'object') return native;
    return selectQuotaObservation(native, observations.filter(item => item.provider === provider).map(item => item.snapshot));
  };
  const reads = {
    codex: () => codex(force), claude: () => claude(force), gemini: () => gemini(force),
    cursor: () => readCursorSubscription(force), copilot: () => readCopilotSubscription(force),
    grok: () => readGrokSubscription(force), zcode: () => readZcodeSubscription(force),
    kimi: async () => selectKimiSubscription(await readKimiSubscriptions(force)),
    antigravity: () => readAntigravitySubscription(force), qoder: () => readQoderSubscription(force),
    minimax: () => readMiniMaxSubscription(force), deepseek: () => readDeepSeekSubscription(force),
    opencode: () => readOpenCodeSubscription(force),
  } satisfies Record<QuotaProviderId, () => Promise<unknown>>;
  const readers: QuotaReader[] = SUBSCRIPTION_CHANNELS.map(channel => ({ ...channel,
    interval: getQuotaProviderDescriptor(channel.id).refreshIntervalSeconds,
    read: () => captureQuotaRead(withObservations(channel.id, reads[channel.id])), statusUrl: STATUS_URLS[channel.id] }));
  const profiles = new Map<string, QuotaReader>();
  const observers = new Map<string, QuotaReader>();
  const profileReaders = (configured: readonly QuotaProfile[]) => {
    observations = readObservations();
    const active = new Set<string>();
    const output: QuotaReader[] = configured.filter(profile => profile.enabled).map(profile => {
      const configuration = JSON.stringify(profile);
      active.add(configuration);
      const existing = profiles.get(configuration);
      if (existing) return existing;
      const read = profile.provider === 'codex' ? createDefaultCodexSubscriptionReader(options.fetch, profile.directory) : createDefaultClaudeSubscriptionReader(profile.directory);
      const reader: QuotaReader = { id: profile.provider, key: `${profile.provider}@${profile.id}`, profileId: profile.id, profileLabel: profile.label,
        label: getQuotaProviderDescriptor(profile.provider).label, interval: getQuotaProviderDescriptor(profile.provider).refreshIntervalSeconds,
        read: () => captureQuotaRead(withObservations(profile.provider, () => read(force))), statusUrl: STATUS_URLS[profile.provider] };
      profiles.set(configuration, reader); return reader;
    });
    for (const key of profiles.keys()) if (!active.has(key)) profiles.delete(key);
    const observedKeys = new Set<string>();
    for (const observation of observations) {
      const key = `${observation.provider}@omp-${observation.key.slice(0, 16)}`;
      observedKeys.add(key);
      let reader = observers.get(key);
      if (!reader) {
        const provider = observation.provider, account = observation.key;
        reader = { id: provider, key, label: SUBSCRIPTION_CHANNELS.find(item => item.id === provider)?.label ?? provider,
          profileLabel: `OMP ${observation.key.slice(0, 6)}`, observationOnly: true, interval: 60,
          async read() { return observations.find(item => item.key === account && item.provider === provider)?.snapshot ?? { status: 'temporarily-unavailable', message: 'OMP 本地观察暂不可用' }; } };
        observers.set(key, reader);
      }
      output.push(reader);
    }
    for (const key of observers.keys()) if (!observedKeys.has(key)) observers.delete(key);
    return output;
  };
  return new QuotaManager({ readers, store: await openQuotaStore(options.directory),
    profileReaders,
    notify: options.notify ?? (() => {}), onChanged: state => {
      options.onChanged?.(state);
      // Construction and the first in-flight emission must not erase the previous run's snapshot.
      if (publisher && options.snapshot && (state.providers.length === 0 || state.providers.some(p => p.queriedAt !== null))) {
        void publisher.publish(projectQuotaReport(state, options.snapshot.runtime)).catch(() => {
          console.warn('[quotern] quota snapshot publication failed');
        });
      }
    },
    fetchStatus: async url => {
      if (!Object.values(STATUS_URLS).includes(url)) throw new Error('unsupported status source');
      const response = await (options.fetch ?? quotaNodeFetch)(new URL('api/v2/status.json', url).toString(), { signal: AbortSignal.timeout(15000), credentials: 'omit', redirect: 'error', cache: 'no-store' });
      if (!response.ok) throw new Error('status unavailable');
      const body = await response.text();
      if (body.length > 256 * 1024) throw new Error('status response too large');
      return parseQuotaServiceStatus(JSON.parse(body));
    },
  });
}
