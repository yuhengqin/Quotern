import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import {
  mapTraeEntitlements,
  type TraeRegion,
  type TraeSubscriptionSnapshot,
} from '../shared/trae-subscription';

const REQUEST_TIMEOUT_MS = 10_000;
const CACHE_TTL_MS = 60_000;
const OFFICIAL_HOSTS = new Set([
  'https://api.trae.ai',
  'https://api.trae.com.cn',
]);

interface TraeCredentials {
  token: string;
}

interface TraeHomeResolverOptions {
  region: TraeRegion;
}

let lastSuccess: Record<TraeRegion, TraeSubscriptionSnapshot | null> = {
  global: null,
  mainland: null,
};
const requestInFlight: Record<TraeRegion, Promise<TraeSubscriptionSnapshot> | null> = {
  global: null,
  mainland: null,
};

function expandHome(value: string): string {
  if (value === '~') return homedir();
  if (value.startsWith('~/') || value.startsWith('~\\')) return path.join(homedir(), value.slice(2));
  return path.resolve(value);
}

function traeHomeDir(region: TraeRegion): string {
  const envKey = region === 'mainland' ? 'TRAE_CN_HOME' : 'TRAE_HOME';
  const configured = process.env[envKey]?.trim();
  if (configured) return expandHome(configured);
  if (process.platform === 'darwin') {
    const leaf = region === 'mainland' ? 'TRAECN' : 'TRAE';
    return path.join(homedir(), 'Library', 'Application Support', leaf);
  }
  if (process.platform === 'win32') {
    const appData = process.env.APPDATA?.trim() || path.join(homedir(), 'AppData', 'Roaming');
    const leaf = region === 'mainland' ? 'TRAECN' : 'TRAE';
    return path.join(appData, leaf);
  }
  const xdg = process.env.XDG_CONFIG_HOME?.trim() || path.join(homedir(), '.config');
  const leaf = region === 'mainland' ? 'traecn' : 'trae';
  return path.join(xdg, leaf);
}

function originForRegion(region: TraeRegion): string {
  return region === 'mainland' ? 'https://api.trae.com.cn' : 'https://api.trae.ai';
}

function unavailable(
  region: TraeRegion,
  status: Exclude<TraeSubscriptionSnapshot['status'], 'ready'>,
  message: string,
): TraeSubscriptionSnapshot {
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
  region: TraeRegion,
  message: string,
): TraeSubscriptionSnapshot {
  const previous = lastSuccess[region];
  if (!previous) return unavailable(region, 'temporarily-unavailable', message);
  return { ...previous, stale: true, message };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function parseTraeCredentials(value: unknown): TraeCredentials | null {
  const root = typeof value === 'string'
    ? (() => { try { return JSON.parse(value) as unknown; } catch { return null; } })()
    : value;
  const record = asRecord(root);
  if (!record) return null;
  // Prefer the canonical IDE auth file fields; never accept BYOK API keys
  // here because TRAE's entitlement endpoint only accepts the IDE session.
  const candidates = [record.token, record.sessionToken, record.accessToken, record.access_token];
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim().length > 20) {
      return { token: candidate.trim() };
    }
  }
  return null;
}

async function readTraeCredentials(home: string): Promise<TraeCredentials | null> {
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
      const credentials = parseTraeCredentials(JSON.parse(text));
      if (credentials) return credentials;
    } catch {
      const credentials = parseTraeCredentials(text);
      if (credentials) return credentials;
    }
  }
  return null;
}

export function hasCustomTraeConfiguration(env: NodeJS.ProcessEnv): boolean {
  const baseUrl = env.TRAE_BASE_URL?.trim().replace(/\/+$/, '') ?? '';
  if (!baseUrl) return false;
  try {
    return !OFFICIAL_HOSTS.has(new URL(baseUrl).origin);
  } catch {
    return true;
  }
}

async function fetchEntitlements(
  region: TraeRegion,
  token: string,
): Promise<{ ok: boolean; status: number; value: unknown }> {
  const response = await fetch(`${originForRegion(region)}/v1/account/entitlements`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return {
    ok: response.ok,
    status: response.status,
    value: response.ok ? await response.json() : null,
  };
}

async function fetchFreshTraeSubscription(
  options: TraeHomeResolverOptions,
): Promise<TraeSubscriptionSnapshot> {
  const { region } = options;
  const home = traeHomeDir(region);
  if (!existsSync(home)) {
    return unavailable(region, 'not-installed', `未检测到本机 TRAE (${region === 'mainland' ? '国内' : '海外'})`);
  }
  const credentials = await readTraeCredentials(home);
  if (!credentials) {
    return unavailable(region, 'not-signed-in', '请先登录 TRAE');
  }

  try {
    const response = await fetchEntitlements(region, credentials.token);
    if (response.status === 401 || response.status === 403) {
      return unavailable(region, 'expired', 'TRAE 登录已过期，请重新登录');
    }
    if (response.status === 429) {
      return staleFallback(region, 'TRAE 配额请求过于频繁，请稍后重试');
    }
    if (response.status >= 500) {
      return staleFallback(region, 'TRAE 配额服务暂时不可用，请稍后重试');
    }
    if (!response.ok || response.status >= 400) {
      return staleFallback(region, '暂时无法读取 TRAE 订阅配额');
    }
    const mapped = mapTraeEntitlements(response.value);
    if (mapped.limits.length === 0) {
      return staleFallback(region, 'TRAE 暂未返回可用的订阅配额');
    }
    const snapshot: TraeSubscriptionSnapshot = {
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
    return staleFallback(region, '网络异常，暂时无法读取 TRAE 配额');
  }
}

/** Read-only TRAE entitlement lookup; one call per region. */
export async function readTraeSubscription(
  region: TraeRegion,
  options: { forceRefresh?: boolean } = {},
): Promise<TraeSubscriptionSnapshot> {
  if (hasCustomTraeConfiguration(process.env)) {
    return unavailable(region, 'custom-provider', '自定义模型无法获取配额');
  }
  const previous = lastSuccess[region];
  const cacheAge = previous?.fetchedAt
    ? Date.now() - previous.fetchedAt * 1_000
    : Number.POSITIVE_INFINITY;
  if (!options.forceRefresh && previous && cacheAge <= CACHE_TTL_MS) return previous;
  if (requestInFlight[region]) return requestInFlight[region];
  requestInFlight[region] = fetchFreshTraeSubscription({ region });
  try {
    return await requestInFlight[region];
  } finally {
    requestInFlight[region] = null;
  }
}
