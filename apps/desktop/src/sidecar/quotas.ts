import { join } from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { resolveDataDir } from 'quotern-core/paths';
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

function cliConsentTargets(profiles: readonly QuotaProfile[]): Map<string, string | null> {
  const targets = new Map<string, string | null>();
  for (const [id, provider] of Object.entries(officialProviders)) {
    if (provider.method === 'official-cli') targets.set(id, null);
  }
  for (const profile of profiles) {
    if (profile.enabled && officialProviders[profile.provider].method === 'official-cli') {
      targets.set(profile.provider + '@' + profile.id, profile.directory);
    }
  }
  return targets;
}

async function readCliConsents(file: string, targets: Map<string, string | null>) {
  const consents = new Map<string, string | null>();
  try {
    const data: unknown = JSON.parse(await readFile(file, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return consents;
    for (const [key, target] of targets) {
      if (Object.hasOwn(data, key) && (data as Record<string, unknown>)[key] === target) consents.set(key, target);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') console.warn('Saved CLI quota consent unavailable');
  }
  return consents;
}

export async function desktopQuotas(profile: string, emit: Emit, read = readOfficialProvider, dataDir = resolveDataDir()) {
  const directory = join(profile, 'quota');
  const store = await openQuotaStore(directory);
  const consentFile = join(directory, 'cli-consents.json');
  const consents = await readCliConsents(consentFile, cliConsentTargets(store.preferences.profiles ?? []));
  // Only the grants for official CLI readers survive a restart. API keys and
  // other secrets are never included in the consents file.
  const grants = new Map<string, { secret?: string; first?: unknown }>(
    [...consents.keys()].map(key => [key, {}]),
  );
  const connecting = new Map<string,symbol>();
  let consentWrites = Promise.resolve();
  let pendingRevocation = false;
  function saveConsents() {
    pendingRevocation = false;
    const payload = JSON.stringify(Object.fromEntries(consents));
    const write = consentWrites.then(async () => {
      await mkdir(directory, { recursive: true });
      const temp = consentFile + '.' + process.pid + '.tmp';
      await writeFile(temp, payload, { mode: 0o600 });
      await rename(temp, consentFile);
    });
    consentWrites = write.catch(() => { pendingRevocation = true; });
    return write;
  }
  function revoke(key: string) {
    connecting.delete(key);
    grants.delete(key);
    if (consents.delete(key)) pendingRevocation = true;
  }
  const snapshot = createQuotaSnapshotPublisher(dataDir, 'desktop');
  const profiles = new Map<string,{profile:QuotaProfile;reader:QuotaReader}>();
  const readers: QuotaReader[] = [];
  const describe = (id: SubscriptionChannelId, key: string) => ({
    ...officialProviders[id], connected: grants.has(key),
  });
  function project(state: QuotaState): QuotaState {
    return { ...state, providers: state.providers.map(provider => {
      const id = provider.providerId ?? provider.id;
      if (!isSubscriptionChannelId(id)) return provider;
      const access = describe(id, provider.id);
      if (access.connected) return { ...provider, access };
      const empty = normalizeQuotaSnapshot(id, provider.label, {status:'not-signed-in'});
      return { ...empty, id: provider.id, providerId: id, profileLabel: provider.profileLabel, service: provider.service, access };
    }) };
  }
  function makeReader(provider: typeof QUOTA_PROVIDER_DESCRIPTORS[number], profile?:QuotaProfile): QuotaReader {
    const key=profile ? provider.id+'@'+profile.id : provider.id;
    return { id: provider.id, key, profileId:profile?.id, profileLabel:profile?.label, label: provider.label, interval: provider.refreshIntervalSeconds, statusUrl: provider.statusPage?.url,
      async read() {
        const grant = grants.get(key);
        if (!grant) return {status:'not-signed-in'};
        if (grant.first !== undefined) { const first=grant.first; delete grant.first; return first; }
        return read(provider.id, grant.secret, profile?.directory);
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
        if(previous && previous.profile.directory!==profile.directory) revoke(key);
        const reader=makeReader(QUOTA_PROVIDER_DESCRIPTORS.find(p=>p.id===profile.provider)!,profile);
        profiles.set(key,{profile,reader});
        return reader;
      });
      for (const key of profiles.keys()) if (!active.has(key)) {
        profiles.delete(key);
        revoke(key);
      }
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
  function resolveKey(key:unknown) {
    if(typeof key!=='string')throw Error('Unknown quota provider');
    const profile=profiles.get(key)?.profile;
    const id=profile?.provider??key;
    if(!isSubscriptionChannelId(id))throw Error('Unknown quota provider');
    return {key,id,profile};
  }
  function replaceReader(key:string,id: SubscriptionChannelId,profile?:QuotaProfile) {
    // Changing the reader invalidates pending requests, histories and account identity in the manager.
    const reader=makeReader(QUOTA_PROVIDER_DESCRIPTORS.find(p=>p.id===id)!,profile);
    if(profile)profiles.set(key,{profile,reader});
    else readers[readers.findIndex(row=>row.id===id)]=reader;
    return manager.refresh('manual', key);
  }
  return {
    directory, start: () => manager.start(), getState: () => project(manager.getState()),
    async refresh(id: unknown) {
      return project(await manager.refresh('manual', id==null?undefined:resolveKey(id).key));
    },
    async set(patch: unknown) {
      if (!validQuotaPatch(patch)) throw Error('Invalid quota preferences');
      await manager.setPreferences(patch);
      if (pendingRevocation) await saveConsents();
      return project(manager.getState());
    },
    async authorize(value: unknown, input: unknown) {
      const {key,id,profile}=resolveKey(value);
      const { method } = officialProviders[id];
      if (method === 'official-page') throw Error('Open the official usage page');
      const secret = typeof input === 'string' ? input.trim() : undefined;
      if (method === 'api-key' && (!secret || secret.length > 4096 || /[\s\x00-\x1f]/u.test(secret))) throw Error('Invalid API key');
      if (method !== 'api-key' && secret) throw Error('Unexpected credential');
      const attempt=Symbol(id);
      connecting.set(key,attempt);
      try {
        const first=await read(id,secret,profile?.directory);
        if (connecting.get(key)!==attempt) throw Error('Authorization cancelled');
        if (!first || typeof first!=='object' || !('status' in first) || first.status!=='ready') {
          throw Error('Official usage authorization failed');
        }
        if (method === 'official-cli' && !grants.has(key)) {
          consents.set(key, profile?.directory ?? null);
          try { await saveConsents(); }
          catch (error) {
            if (connecting.get(key) === attempt) consents.delete(key);
            throw error;
          }
        }
        if (connecting.get(key) !== attempt) throw Error('Authorization cancelled');
        grants.set(key, { secret, first });
        // Another settings request may have updated the profile label while the
        // consent was being saved. Reuse the currently registered profile.
        await replaceReader(key, id, resolveKey(key).profile);
      } finally { if(connecting.get(key)===attempt)connecting.delete(key); }
    },
    async disconnect(value: unknown) {
      const {key,id,profile}=resolveKey(value);
      revoke(key);
      const refresh = replaceReader(key, id, profile);
      await Promise.all([refresh, pendingRevocation ? saveConsents() : undefined]);
    },
    async close() {
      connecting.clear();
      grants.clear();
      manager.dispose();
      flush();
      await Promise.all([publication, consentWrites]);
    },
    wake() { manager.resumed(); },
  };
}
