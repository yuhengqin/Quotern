import { createHash } from 'node:crypto';

// Identity is deliberately out-of-band: no credential-derived metadata crosses legacy IPC.
const identities = new WeakMap<object, string>();
function stableIdentity(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const account = [record.userId, record.user, record.accountId, record.email].find(item => typeof item === 'string' && item.length > 0);
  if (account) return [record.provider ?? '', record.region ?? '', record.source ?? '', account];
  const token = record.accessToken ?? record.token;
  if (typeof token === 'string') {
    try {
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      if (typeof claims.sub === 'string' && claims.sub) return [record.provider ?? '', record.region ?? '', claims.iss ?? '', claims.sub];
    } catch { /* Opaque credentials use a conservative fingerprint until a stable ID is available. */ }
  }
  return record.refreshToken ?? record.refresh_token ?? value;
}
export function markQuotaIdentity<T extends object>(snapshot: T, identity: unknown): T {
  if (identity !== null && identity !== undefined && identity !== '') identities.set(snapshot, createHash('sha256').update(JSON.stringify(stableIdentity(identity))).digest('hex'));
  return snapshot;
}
export function copyQuotaIdentity<T extends object>(source: object, target: T): T {
  const identity = identities.get(source);
  if (identity) identities.set(target, identity);
  return target;
}
export function quotaIdentity(snapshot: unknown): string | null {
  return snapshot && typeof snapshot === 'object' ? identities.get(snapshot) ?? null : null;
}
