import { createHash } from 'node:crypto';
import type { QuotaProvenance } from '../shared/quota.js';
import { accountReference } from '../../account-reference.js';

// Identity is deliberately out-of-band: no credential-derived metadata crosses legacy IPC.
const identities = new WeakMap<object, string>();
export type QuotaAccountEvidence = { service?: string; accountId?: string; email?: string; organizationId?: string };
const evidence = new WeakMap<object, { public: QuotaProvenance; account: QuotaAccountEvidence }>();
export function markQuotaEvidence<T extends object>(snapshot: T, provenance: QuotaProvenance, account: QuotaAccountEvidence = {}): T {
  const identity = account.service === 'anthropic' && account.email && account.organizationId ? [account.email.toLowerCase(), account.organizationId] : account.accountId;
  evidence.set(snapshot, { public: { ...provenance, ...(account.service && identity ? { accountRef: accountReference(account.service, identity) } : {}) }, account: { ...account } });
  return snapshot;
}
export function privateQuotaEvidence(snapshot: object) { return evidence.get(snapshot); }
export function quotaEvidence(snapshot: unknown): QuotaProvenance | null {
  return snapshot && typeof snapshot === 'object' ? evidence.get(snapshot)?.public ?? null : null;
}
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
  const proof = evidence.get(source);
  if (proof) evidence.set(target, proof);
  return target;
}
export function quotaIdentity(snapshot: unknown): string | null {
  return snapshot && typeof snapshot === 'object' ? identities.get(snapshot) ?? null : null;
}
