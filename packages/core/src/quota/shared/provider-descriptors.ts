/** Browser-safe, declarative capabilities. Reader code still owns authentication and execution. */
export const QUOTA_PROVIDER_DESCRIPTOR_SCHEMA_VERSION = 1;
const PLATFORMS = ['darwin', 'linux', 'win32'] as const;
const AUTHS = ['oauth-cache', 'official-cli', 'local-session', 'api-key'] as const;
const STRATEGIES = ['credentials-http', 'official-cli', 'desktop-ipc-http', 'local-engine-http', 'local-cache'] as const;
type Platform = typeof PLATFORMS[number];
type Auth = typeof AUTHS[number];
type Strategy = typeof STRATEGIES[number];
export interface QuotaProviderDescriptor {
  id: string; label: string; platforms: readonly Platform[]; authMethods: readonly Auth[];
  strategies: readonly { kind: Strategy; platforms: readonly Platform[]; limitation?: 'separate-identities' | 'posix-discovery' | 'valid-token-only' }[];
  refreshIntervalSeconds: number;
  statusPage: { url: string; protocol: 'statuspage-v2' } | null;
  capabilities: { values: readonly ('percentage' | 'balance' | 'unlimited' | 'exhausted')[]; profiles: boolean; diagnostics: 'basic' | 'detailed' };
}
function provider<const Id extends string>(id: Id, label: string, authMethods: readonly Auth[], strategies: QuotaProviderDescriptor['strategies'],
  refreshIntervalSeconds = 300, status: string | null = null, values: QuotaProviderDescriptor['capabilities']['values'] = ['percentage'], profiles = false, detailed = false): QuotaProviderDescriptor & { id: Id } {
  return { id, label, platforms: PLATFORMS, authMethods, strategies, refreshIntervalSeconds,
    statusPage: status ? { url: status, protocol: 'statuspage-v2' } : null,
    capabilities: { values, profiles, diagnostics: detailed ? 'detailed' : 'basic' } };
}
const http = [{ kind: 'credentials-http', platforms: PLATFORMS }] as const;
export const QUOTA_PROVIDER_DESCRIPTORS = [
  provider('codex', 'Codex', ['oauth-cache'], http, 180, 'https://status.openai.com/', ['percentage'], true, true),
  provider('claude', 'Claude', ['official-cli'], [{ kind: 'official-cli', platforms: PLATFORMS }], 300, 'https://status.claude.com/', ['percentage'], true, true),
  provider('gemini', 'Gemini CLI', ['oauth-cache'], [{ kind: 'credentials-http', platforms: PLATFORMS, limitation: 'valid-token-only' }], 300, null, ['percentage'], false, true),
  provider('cursor', 'Cursor', ['local-session'], http, 300, 'https://status.cursor.com/'),
  provider('copilot', 'Copilot', ['oauth-cache', 'api-key'], http, 900, 'https://www.githubstatus.com/', ['percentage', 'unlimited', 'exhausted']),
  provider('grok', 'Grok', ['oauth-cache'], http),
  provider('kimi', 'Kimi', ['local-session', 'api-key'], [...http, { kind: 'desktop-ipc-http', platforms: ['win32'], limitation: 'separate-identities' }]),
  provider('zcode', 'ZCode', ['local-session'], http),
  provider('antigravity', 'Antigravity', ['oauth-cache'], [{ kind: 'local-engine-http', platforms: ['darwin', 'linux'], limitation: 'posix-discovery' }, ...http], 600),
  provider('qoder', 'Qoder', ['local-session'], [...http, { kind: 'local-cache', platforms: PLATFORMS }]),
  provider('minimax', 'MiniMax', ['oauth-cache', 'api-key'], http),
  provider('opencode', 'OpenCode', ['local-session'], http),
  provider('deepseek', 'DeepSeek', ['api-key'], http, 300, null, ['balance']),
] as const satisfies readonly QuotaProviderDescriptor[];
export type QuotaProviderId = typeof QUOTA_PROVIDER_DESCRIPTORS[number]['id'];
export function getQuotaProviderDescriptor(id: QuotaProviderId): QuotaProviderDescriptor {
  return QUOTA_PROVIDER_DESCRIPTORS.find(p => p.id === id)!;
}

/** Validation is for the compiled contract, not an external plugin loader. */
export function validateQuotaProviderDescriptors(value: unknown): asserts value is readonly QuotaProviderDescriptor[] {
  const fail = () => { throw new Error('INVALID_PROVIDER_DESCRIPTOR'); };
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) return fail();
  const ids = new Set<string>();
  const list = (v: unknown, allowed: readonly string[]): v is string[] => Array.isArray(v) && v.length > 0 && v.every(x => typeof x === 'string' && allowed.includes(x)) && new Set(v).size === v.length;
  for (const p of value) {
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(p.id) || ids.has(p.id)
      || typeof p.label !== 'string' || !p.label.trim() || p.label.length > 80 || !list(p.platforms, PLATFORMS) || !list(p.authMethods, AUTHS)
      || !Number.isInteger(p.refreshIntervalSeconds) || p.refreshIntervalSeconds < 1 || p.refreshIntervalSeconds > 86400
      || !Array.isArray(p.strategies) || !p.strategies.length) return fail();
    ids.add(p.id);
    for (const s of p.strategies) if (!s || !STRATEGIES.includes(s.kind) || !list(s.platforms, p.platforms)
      || s.limitation !== undefined && !['separate-identities', 'posix-discovery', 'valid-token-only'].includes(s.limitation)) return fail();
    const c = p.capabilities;
    if (!c || !list(c.values, ['percentage', 'balance', 'unlimited', 'exhausted']) || typeof c.profiles !== 'boolean' || !['basic', 'detailed'].includes(c.diagnostics)) return fail();
    if (p.statusPage !== null) {
      try { const u = new URL(p.statusPage.url); if (p.statusPage.protocol !== 'statuspage-v2' || u.protocol !== 'https:' || u.username || u.password || u.search || u.hash) return fail(); }
      catch { return fail(); }
    }
  }
}
validateQuotaProviderDescriptors(QUOTA_PROVIDER_DESCRIPTORS);
