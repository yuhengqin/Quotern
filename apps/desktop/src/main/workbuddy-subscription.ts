import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  mapWorkBuddyResources,
  type WorkBuddyRegion,
  type WorkBuddySubscriptionSnapshot,
} from '../shared/workbuddy-subscription';

const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;
// Phase 3 host whitelist is intentionally narrow: the official account-resource
// endpoint for each edition is added when the official API contract is
// confirmed. Until then, no traffic is sent — the adapter stays read-only and
// only reads the locally-cached login state.
const OFFICIAL_HOSTS = new Set<string>([
  // 'https://api.workbuddy.ai',
  // 'https://api.workbuddy.cn',
]);

interface WorkBuddyCredentials {
  token: string;
}

interface WorkBuddyHomeResolverOptions {
  region: WorkBuddyRegion;
}

let lastSuccess: Record<WorkBuddyRegion, WorkBuddySubscriptionSnapshot | null> = {
  global: null,
  mainland: null,
};
const requestInFlight: Record<WorkBuddyRegion, Promise<WorkBuddySubscriptionSnapshot> | null> = {
  global: null,
  mainland: null,
};

function expandHome(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(homedir(), value.slice(2));
  return path.resolve(value);
}

function workbuddyHomeDir(region: WorkBuddyRegion): string {
  // `WORKBUDDY_HOME` overrides both editions; this matches the Core parser.
  const override = process.env.WORKBUDDY_HOME?.trim();
  if (override) return expandHome(override);
  const leaf = region === 'mainland' ? '.workbuddy' : '.workbuddy-ai';
  return path.join(homedir(), leaf);
}

function unavailable(
  region: WorkBuddyRegion,
  status: Exclude<WorkBuddySubscriptionSnapshot['status'], 'ready'>,
  message: string,
): WorkBuddySubscriptionSnapshot {
  return {
    status,
    planLabel: null,
    region,
    limits: [],
    fetchedAt: null,
    stale: false,
    message,
  };
}

function staleFallback(
  region: WorkBuddyRegion,
  message: string,
): WorkBuddySubscriptionSnapshot {
  const previous = lastSuccess[region];
  if (!previous) return unavailable(region, 'temporarily-unavailable', message);
  return { ...previous, stale: true, message };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseWorkBuddyCredentials(value: unknown): WorkBuddyCredentials | null {
  const root = typeof value === 'string'
    ? (() => { try { return JSON.parse(value) as unknown; } catch { return null; } })()
    : value;
  const record = asRecord(root);
  if (!record) return null;
  // Only the IDE-side session token is accepted; BYOK-style provider keys
  // never satisfy the read-only account-resource endpoint.
  const candidates = [
    record.token,
    record.sessionToken,
    record.accessToken,
    record.access_token,
    asRecord(record.auth)?.token,
    asRecord(record.session)?.token,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 20) {
      return { token: candidate.trim() };
    }
  }
  return null;
}

async function readWorkBuddyCredentials(home: string): Promise<WorkBuddyCredentials | null> {
  const candidates = [
    path.join(home, 'auth.json'),
    path.join(home, 'session.json'),
    path.join(home, 'config.json'),
  ];
  for (const candidate of candidates) {
    let text: string | null = null;
    try {
      text = await readFile(candidate, 'utf8');
    } catch {
      continue;
    }
    if (text === null) continue;
    try {
      const credentials = parseWorkBuddyCredentials(JSON.parse(text));
      if (credentials) return credentials;
    } catch {
      const credentials = parseWorkBuddyCredentials(text);
      if (credentials) return credentials;
    }
  }
  return null;
}

export function hasCustomWorkBuddyConfiguration(env: NodeJS.ProcessEnv): boolean {
  const baseUrl = env.WORKBUDDY_BASE_URL?.trim().replace(/\/+$/, '') ?? '';
  if (!baseUrl) return false;
  try {
    return !OFFICIAL_HOSTS.has(new URL(baseUrl).origin);
  } catch {
    return true;
  }
}

async function fetchResources(
  origin: string,
  token: string,
): Promise<{ ok: boolean; status: number; value: unknown }> {
  const response = await fetch(`${origin}/v1/account/resources`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return {
    ok: response.ok,
    status: response.status,
    value: response.ok ? await response.json() : null,
  };
}

async function fetchFreshWorkBuddySubscription(
  options: WorkBuddyHomeResolverOptions,
): Promise<WorkBuddySubscriptionSnapshot> {
  const { region } = options;
  const home = workbuddyHomeDir(region);
  if (!existsSync(home)) {
    return unavailable(region, 'not-installed', `未检测到本机 WorkBuddy (${region === 'mainland' ? '国内' : '海外'})`);
  }
  const credentials = await readWorkBuddyCredentials(home);
  if (!credentials) {
    return unavailable(region, 'not-signed-in', '请先登录 WorkBuddy');
  }

  // No official host is whitelisted yet; fail safe instead of transmitting
  // the session token. The adapter contract stays intact so adding a host
  // here is a one-line change once the official API is confirmed.
  if (OFFICIAL_HOSTS.size === 0) {
    return unavailable(region, 'temporarily-unavailable', 'WorkBuddy 官方额度接口尚未开放');
  }

  const [origin] = [...OFFICIAL_HOSTS];
  try {
    const response = await fetchResources(origin, credentials.token);
    if (response.status === 401 || response.status === 403) {
      return unavailable(region, 'expired', 'WorkBuddy 登录已过期，请重新登录');
    }
    if (response.status === 429) {
      return staleFallback(region, 'WorkBuddy 配额请求过于频繁，请稍后重试');
    }
    if (response.status >= 500) {
      return staleFallback(region, 'WorkBuddy 配额服务暂时不可用，请稍后重试');
    }
    if (!response.ok || response.status >= 400) {
      return staleFallback(region, '暂时无法读取 WorkBuddy 账户资源');
    }
    const mapped = mapWorkBuddyResources(response.value);
    if (mapped.limits.length === 0) {
      return staleFallback(region, 'WorkBuddy 暂未返回可用的账户资源');
    }
    const snapshot: WorkBuddySubscriptionSnapshot = {
      status: 'ready',
      planLabel: mapped.planLabel,
      region,
      limits: mapped.limits,
      fetchedAt: Math.floor(Date.now() / 1_000),
      stale: false,
      message: null,
    };
    lastSuccess[region] = snapshot;
    return snapshot;
  } catch {
    return staleFallback(region, '网络异常，暂时无法读取 WorkBuddy 账户资源');
  }
}

/** Read-only WorkBuddy account-resource lookup; one call per edition. */
export async function readWorkBuddySubscription(
  region: WorkBuddyRegion,
  options: { forceRefresh?: boolean } = {},
): Promise<WorkBuddySubscriptionSnapshot> {
  if (hasCustomWorkBuddyConfiguration(process.env)) {
    return unavailable(region, 'custom-provider', '自定义模型无法获取配额');
  }
  const previous = lastSuccess[region];
  const cacheAge = previous?.fetchedAt
    ? Date.now() - previous.fetchedAt * 1_000
    : Number.POSITIVE_INFINITY;
  if (!options.forceRefresh && previous && cacheAge <= CACHE_TTL_MS) return previous;
  if (requestInFlight[region]) return requestInFlight[region];
  requestInFlight[region] = fetchFreshWorkBuddySubscription({ region });
  try {
    return await requestInFlight[region];
  } finally {
    requestInFlight[region] = null;
  }
}
