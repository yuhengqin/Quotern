import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { QuotaWindow } from '../shared/quota.js';
import type { QuotaDiagnosticCode } from '../shared/quota-diagnostic.js';
import { quotaNodeFetch, observeQuotaResponse, observeQuotaError, recordQuotaAttempt } from './quota-fetch-state.js';
import { markQuotaEvidence, markQuotaIdentity } from './quota-identity.js';
import { createSubscriptionCache } from './subscription-cache.js';

const ENDPOINT = 'https://cloudcode-pa.googleapis.com/v1internal:';
const MAX_BYTES = 1024 * 1024;
const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const model = (value: unknown): string => typeof value === 'string' && /^[a-zA-Z0-9_.-]{1,100}$/.test(value) ? value : '';
interface GeminiSnapshot {
  status: string; message: string | null; stale: boolean; fetchedAt: number | null; planLabel: string | null; windows: QuotaWindow[];
}
async function boundedFile(file: string): Promise<string> {
  const handle = await open(file, 'r');
  try {
    if ((await handle.stat()).size > MAX_BYTES) throw new SyntaxError('invalid credentials');
    const buffer = Buffer.alloc(MAX_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(buffer, length, buffer.length - length, null);
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > MAX_BYTES) throw new SyntaxError('invalid credentials');
    return buffer.subarray(0, length).toString('utf8');
  } finally { await handle.close(); }
}
async function responseJson(response: Response): Promise<unknown> {
  if (!response.body) throw new SyntaxError('invalid quota response');
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) { await reader.cancel(); throw new SyntaxError('invalid quota response'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
export function mapGeminiQuota(value: unknown): QuotaWindow[] {
  const buckets = object(value).buckets;
  if (!Array.isArray(buckets)) return [];
  const windows: QuotaWindow[] = [];
  const seen = new Set<string>();
  for (const entry of buckets.slice(0, 128)) {
    const b = object(entry), id = model(b.modelId), tokenType = model(b.tokenType), remaining = b.remainingFraction;
    if (!id || typeof remaining !== 'number' || !Number.isFinite(remaining) || remaining < 0 || remaining > 1) continue;
    const key = `model:${id}${tokenType ? `:${tokenType}` : ''}`;
    // Ambiguous duplicate pools are not combined; keep the first coherent bucket.
    if (seen.has(key)) continue;
    seen.add(key);
    const reset = typeof b.resetTime === 'string' ? Date.parse(b.resetTime) / 1000 : NaN;
    windows.push({ id: key, label: tokenType ? `${id} · ${tokenType}` : id, usedPercent: (1 - remaining) * 100,
      resetsAt: Number.isFinite(reset) && reset > 0 ? reset : null, durationSeconds: null, analysisEligible: false });
  }
  return windows;
}

/** Existing valid Google login only: no OAuth refresh, credential writes, project discovery or onboarding. */
export function createGeminiSubscriptionReader(deps: {
  readSettings(): Promise<string>; readCredentials(): Promise<string>;
  fetch(url: string, init: RequestInit): Promise<Response>; now?: () => number;
  project?: string; encryptedStorage?: boolean;
}) {
  const now = deps.now ?? Date.now;
  const cache = createSubscriptionCache<GeminiSnapshot>(now);
  const fail = (status: string, code: QuotaDiagnosticCode, stage: 'credentials' | 'parse' = 'credentials'): GeminiSnapshot => {
    recordQuotaAttempt({ stage, outcome: 'failure', code });
    const messages: Partial<Record<QuotaDiagnosticCode, string>> = {
      NOT_SIGNED_IN: '未发现受支持的 Gemini CLI 明文 OAuth 登录缓存，请先登录 Gemini CLI',
      AUTH_EXPIRED: 'Gemini CLI 登录已过期，请在 Gemini CLI 中重新认证',
      UNSUPPORTED_AUTH: '仅支持 Gemini CLI 的 Google OAuth 明文登录缓存',
      MISSING_PROJECT: 'Gemini CLI 尚未提供可查询的项目，请先完成 Gemini CLI 初始化',
      ACCESS_DENIED: 'Gemini CLI 登录或额度访问受限，请检查账号权限',
      INVALID_CREDENTIALS: 'Gemini CLI 登录信息无法读取，请检查本机登录状态',
    };
    return { status, message: messages[code] ?? '暂时无法读取 Gemini CLI 额度，请稍后重试', stale: false, fetchedAt: null, planLabel: null, windows: [] };
  };
  return async (options: { forceRefresh?: boolean } = {}): Promise<GeminiSnapshot> => {
    if (deps.encryptedStorage) return fail('unsupported-account', 'UNSUPPORTED_AUTH');
    let settings: Record<string, unknown>, credentials: Record<string, unknown>;
    try {
      const settingsText = await deps.readSettings();
      if (Buffer.byteLength(settingsText) > MAX_BYTES) throw new SyntaxError();
      // Gemini CLI settings are JSON with comments. Match strings first so URL,
      // escaped quote and comment-marker contents are preserved verbatim.
      const uncommented = settingsText.replace(/"(?:[^"\\]|\\[\s\S])*"|\/\/[^\r\n]*|\/\*[\s\S]*?\*\//g,
        token => token.startsWith('"') ? token : ' ');
      settings = object(JSON.parse(uncommented));
      if (object(object(settings.security).auth).selectedType !== 'oauth-personal') return fail('unsupported-account', 'UNSUPPORTED_AUTH');
      const raw = await deps.readCredentials();
      if (Buffer.byteLength(raw) > MAX_BYTES) throw new SyntaxError();
      credentials = object(JSON.parse(raw));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      return fail(code === 'ENOENT' ? 'not-signed-in' : 'access-denied', code === 'ENOENT' ? 'NOT_SIGNED_IN' : code === 'EACCES' || code === 'EPERM' ? 'ACCESS_DENIED' : 'INVALID_CREDENTIALS');
    }
    const token = text(credentials.access_token), expiry = credentials.expiry_date;
    if (!token || token.length > 16384 || /\s/.test(token) || typeof expiry !== 'number' || !Number.isFinite(expiry)) return fail('access-denied', 'INVALID_CREDENTIALS');
    if (expiry <= now()) return fail('expired', 'AUTH_EXPIRED');
    recordQuotaAttempt({ stage: 'credentials', outcome: 'success', code: null });
    const identity = createHash('sha256').update(token).digest('hex');
    return cache(identity, async () => {
      const annotate = (value: GeminiSnapshot) => markQuotaEvidence(markQuotaIdentity(value, ['gemini', identity]),
        { source: 'native', observer: 'Gemini CLI Cloud Code 查询', observedAt: value.fetchedAt, identityVerified: false });
      const query = async (method: string, body: object) => {
        const response = await deps.fetch(`${ENDPOINT}${method}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
          body: JSON.stringify(body), signal: AbortSignal.timeout(20000), redirect: 'error', credentials: 'omit', cache: 'no-store' });
        observeQuotaResponse(response);
        if (!response.ok) { await response.body?.cancel(); return { status: response.status, data: null }; }
        return { status: response.status, data: object(await responseJson(response)) };
      };
      const httpFailure = (status: number) => annotate({ status: status === 401 ? 'expired' : status === 403 ? 'access-denied' : 'unavailable',
        message: status === 401 ? 'Gemini CLI 登录已过期，请重新认证' : '暂时无法读取 Gemini CLI 额度，请稍后重试', stale: false, fetchedAt: null, planLabel: null, windows: [] });
      try {
        const configured = deps.project?.trim();
        const project = configured && /^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(configured) ? configured : undefined;
        const loaded = await query('loadCodeAssist', { metadata: { ideType: 'IDE_UNSPECIFIED', platform: 'PLATFORM_UNSPECIFIED', pluginType: 'GEMINI', ...(project ? { duetProject: project } : {}) }, ...(project ? { cloudaicompanionProject: project } : {}) });
        if (!loaded.data) return httpFailure(loaded.status);
        const initialized = loaded.data.currentTier !== null && typeof loaded.data.currentTier === 'object' && !Array.isArray(loaded.data.currentTier);
        const assigned = text(loaded.data.cloudaicompanionProject) || (initialized ? project ?? '' : '');
        if (!assigned || assigned.length > 256 || !/^[a-zA-Z0-9_-]+$/.test(assigned)) return annotate(fail('unavailable', 'MISSING_PROJECT', 'parse'));
        const quota = await query('retrieveUserQuota', { project: assigned });
        if (!quota.data) return httpFailure(quota.status);
        const windows = mapGeminiQuota(quota.data);
        if (!windows.length) return annotate(fail('unavailable', 'INVALID_RESPONSE', 'parse'));
        const paid = object(loaded.data.paidTier), tier = object(loaded.data.currentTier);
        return annotate({ status: 'ready', message: null, stale: false, fetchedAt: Math.floor(now() / 1000), windows,
          planLabel: (text(paid.name) || text(tier.name) || text(tier.id)).slice(0, 120) || null });
      } catch (error) { observeQuotaError(error); return annotate({ status: 'unavailable', message: 'Gemini CLI 额度请求失败，请稍后重试', stale: false, fetchedAt: null, planLabel: null, windows: [] }); }
    }, options.forceRefresh);
  };
}
export function createDefaultGeminiSubscriptionReader(fetchImpl: (url: string, init: RequestInit) => Promise<Response> = quotaNodeFetch) {
  const directory = path.join(process.env.GEMINI_CLI_HOME || homedir(), '.gemini');
  return createGeminiSubscriptionReader({ readSettings: () => boundedFile(path.join(directory, 'settings.json')), readCredentials: () => boundedFile(path.join(directory, 'oauth_creds.json')),
    fetch: fetchImpl, project: process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT_ID,
    encryptedStorage: process.env.GEMINI_FORCE_ENCRYPTED_FILE_STORAGE === 'true' });
}
