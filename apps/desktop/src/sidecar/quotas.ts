import { join } from 'node:path';
import { createWindowStarter } from 'quotern-core';
import { resolveDataDir } from 'quotern-core/paths';
import { registerLaunchSource } from 'quotern-core/quota/account-launch';
import { createAccountAutoSwitcher } from 'quotern-core/quota/account-auto-switch';
import { QuotaManager, type QuotaReader } from 'quotern-core/quota/readers/quota-manager';
import { openQuotaStore, validQuotaPatch } from 'quotern-core/quota/readers/quota-store';
import { QUOTA_PROVIDER_DESCRIPTORS } from 'quotern-core/quota/shared/provider-descriptors';
import { isSubscriptionChannelId, type SubscriptionChannelId } from 'quotern-core/quota/shared/subscription-channels';
import { normalizeQuotaSnapshot } from 'quotern-core/quota/shared/quota-analysis';
import { parseQuotaServiceSummary } from 'quotern-core/quota/shared/quota-service';
import { createQuotaSnapshotPublisher } from 'quotern-core/quota/snapshot';
import { projectQuotaReport } from 'quotern-core/quota/report';
import { QUOTA_CHANGED, type QuotaState } from '../shared/quota';
import type { QuotaProfile } from 'quotern-core/quota/shared/quota';
import { officialProviders, readOfficialProvider } from './official-providers';

type Emit = (channel: string, ...args: unknown[]) => void;

export async function desktopQuotas(profile: string, emit: Emit, checkSessionUnlocked: () => Promise<boolean>, read = readOfficialProvider, dataDir = resolveDataDir()) {
  const directory = join(profile, 'quota');
  const store = await openQuotaStore(directory);
  try { await registerLaunchSource(dataDir, 'desktop', directory); }
  catch { console.warn('Desktop account launch source unavailable'); }
  const connections = new Map<SubscriptionChannelId, { secret: string; first?: unknown }>();
  const connecting = new Map<SubscriptionChannelId, symbol>();
  const snapshot = createQuotaSnapshotPublisher(dataDir, 'desktop');
  const profiles = new Map<string,{profile:QuotaProfile;reader:QuotaReader}>();
  const readers: QuotaReader[] = [];
  function project(state: QuotaState): QuotaState {
    return { ...state, providers: state.providers.map(provider => {
      const id = provider.providerId ?? provider.id;
      if (!isSubscriptionChannelId(id)) return provider;
      const source = officialProviders[id];
      if (source.method === 'official-cli') {
        return { ...provider, access: { ...source, connected: provider.status === 'ready' } };
      }
      const access = { ...source, connected: connections.has(id) };
      if (access.connected) return { ...provider, access };
      const empty = normalizeQuotaSnapshot(id, provider.label, {status:'not-signed-in'});
      return { ...empty, id: provider.id, providerId: id, profileLabel: provider.profileLabel, service: provider.service, access };
    }) };
  }
  function makeReader(provider: typeof QUOTA_PROVIDER_DESCRIPTORS[number], profile?:QuotaProfile): QuotaReader {
    const key=profile ? provider.id+'@'+profile.id : provider.id;
    return { id: provider.id, key, profileId:profile?.id, profileLabel:profile?.label, label: provider.label, interval: provider.refreshIntervalSeconds, statusUrl: provider.statusPage?.url,
      async read() {
        if (officialProviders[provider.id].method === 'official-cli') return read(provider.id, undefined, profile?.directory);
        const connection = connections.get(provider.id);
        if (!connection) return { status: 'not-signed-in' };
        if (connection.first !== undefined) {
          const first = connection.first;
          delete connection.first;
          return first;
        }
        return read(provider.id, connection.secret);
      },
    };
  }
  readers.push(...QUOTA_PROVIDER_DESCRIPTORS.map(provider => makeReader(provider)));
  let publication = Promise.resolve();
  let next:QuotaState|undefined, pending:NodeJS.Immediate|undefined;
  function flush() {
    if(pending)clearImmediate(pending);
    pending=undefined;
    if(!next)return;
    const current=project(next);next=undefined;
    emit(QUOTA_CHANGED,current);
    if(current.providers.some(p=>p.queriedAt!==null)||current.providers.length) publication=snapshot.publish(projectQuotaReport(current,'desktop')).catch(()=>{console.warn('Quota snapshot unavailable');});
    if (manager.canRunAutomation()) {
      void autoSwitch().catch(() => console.warn('Desktop account rotation unavailable'));
      void startWindow(current).catch(() => console.warn('Desktop quota window startup unavailable'));
    }
  }
  const manager = new QuotaManager({
    store, readers,
    profileReaders(configured) {
      const active=new Set<string>();
      const output=configured.filter(p=>p.enabled).map(profile=>{
        const key=profile.provider+'@'+profile.id;
        active.add(key);
        const previous=profiles.get(key);
        if(previous && previous.profile.label===profile.label && previous.profile.directory===profile.directory)return previous.reader;
        const reader=makeReader(QUOTA_PROVIDER_DESCRIPTORS.find(p=>p.id===profile.provider)!,profile);
        profiles.set(key,{profile,reader});
        return reader;
      });
      for (const key of profiles.keys()) if (!active.has(key)) profiles.delete(key);
      return output;
    },
    notify: value => emit('runtime:quota-notification', value),
    notifyService: value => emit('runtime:service-notification', value),
    fetchStatus: async url => {
      const response = await fetch(new URL('api/v2/summary.json',url), {signal:AbortSignal.timeout(8000),credentials:'omit',redirect:'error'});
      if (!response.ok) throw Error('Status service unavailable');
      const text = await response.text();
      if (text.length > 256*1024) throw Error('Invalid status response');
      return parseQuotaServiceSummary(JSON.parse(text), url, Date.now()/1000);
    },
    onChanged: state => {
      next=state;
      pending??=setImmediate(flush);
    },
  });
  const isSessionUnlocked = async () =>
    manager.canRunAutomation() && await checkSessionUnlocked() && manager.canRunAutomation();
  const autoSwitch = createAccountAutoSwitcher(dataDir, directory, 'desktop', {
    getState: () => project(manager.getState()),
    isActive: () => manager.canRunAutomation(),
    isSessionUnlocked,
  });
  const startWindow = createWindowStarter(dataDir, 'desktop', {
    getState: () => manager.canRunAutomation() ? project(manager.getState()) : null,
    isSessionUnlocked,
  });
  function resolveKey(key: unknown) {
    if (typeof key !== 'string' || (!isSubscriptionChannelId(key) && !profiles.has(key))) throw Error('Unknown quota provider');
    return key;
  }
  function apiKeyProvider(value: unknown) {
    if (!isSubscriptionChannelId(value) || officialProviders[value].method !== 'api-key') throw Error('This provider does not accept an API key connection');
    return value;
  }
  function refreshConnection(id: SubscriptionChannelId) {
    // A new reader prevents pending results from the previous connection from resurfacing.
    readers[readers.findIndex(row => row.id === id)] = makeReader(QUOTA_PROVIDER_DESCRIPTORS.find(provider => provider.id === id)!);
    return manager.refresh('manual', id);
  }
  return {
    directory, start: () => manager.start(), getState: () => project(manager.getState()),
    async refresh(id: unknown) {
      return project(await manager.refresh('manual', id==null?undefined:resolveKey(id)));
    },
    async set(patch: unknown) {
      if (!validQuotaPatch(patch)) throw Error('Invalid quota preferences');
      return project(await manager.setPreferences(patch));
    },
    async authorize(value: unknown, input: unknown) {
      const id = apiKeyProvider(value);
      const secret = typeof input === 'string' ? input.trim() : '';
      if (!secret || secret.length > 4096 || /[\s\x00-\x1f]/u.test(secret)) throw Error('Invalid API key');
      const attempt = Symbol(id);
      connecting.set(id, attempt);
      try {
        const first = await read(id, secret, undefined);
        if (connecting.get(id) !== attempt) throw Error('Authorization cancelled');
        if (!first || typeof first!=='object' || !('status' in first) || first.status!=='ready') {
          throw Error('Official usage authorization failed');
        }
        connections.set(id, { secret, first });
        await refreshConnection(id);
      } finally { if (connecting.get(id) === attempt) connecting.delete(id); }
    },
    async disconnect(value: unknown) {
      const id = apiKeyProvider(value);
      connecting.delete(id);
      connections.delete(id);
      await refreshConnection(id);
    },
    async close() {
      connecting.clear();
      connections.clear();
      manager.dispose();
      flush();
      await publication;
    },
    wake() { manager.resumed(); },
  };
}
