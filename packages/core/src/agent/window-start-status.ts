import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { readRuntimeOwner } from '../runtime-pid.js';
import { quotaWindowPeriodSeconds, type QuotaState } from '../quota/shared/quota.js';
import { agentDirectory, readAgentJson, readAgentPreferences } from './preferences.js';

export interface WindowMemory { known: Record<string, { reset: number; at: number }>; attempted: Record<string, { at: number; outcome: 'attempted' | 'completed' | 'uncertain' }>; blocked?: Partial<Record<'claude' | 'codex', number>> }
export type WindowStartReason = 'disabled' | 'isolated' | 'owner' | 'reading' | 'identity' | 'window' | 'reset' | 'waiting-reset' | 'baseline' | 'in-use' | 'already-attempted' | 'eligible' | 'verification';
export function windowCandidate(state: QuotaState | null, provider: 'claude' | 'codex', memory: WindowMemory, stamp: number) {
  const p = state?.providers.find(item => item.id === provider);
  if (!p || p.status !== 'ready' || p.stale || p.refreshing || p.diagnostic?.code || p.fetchedAt === null || p.fetchedAt > stamp + 60 || p.fetchedAt < stamp - 900) return { reason: 'reading' as WindowStartReason };
  if (p.provenance?.source !== 'native' || !p.provenance.identityVerified || !p.provenance.accountRef) return { reason: 'identity' as WindowStartReason };
  const windows = p.windows.filter(w => quotaWindowPeriodSeconds(w) === 18000 && !w.id.startsWith('feature:') && w.timeKind !== 'expiry' && !w.balance);
  if (windows.length !== 1) return { reason: 'window' as WindowStartReason };
  const window = windows[0]!, reset = window.resetsAt;
  if (reset === null || !Number.isFinite(reset)) return { reason: 'reset' as WindowStartReason };
  const key = createHash('sha256').update(provider + ':' + p.provenance.accountRef).digest('hex'), attempt = `${key}:${reset}`;
  const previous = memory.known[key];
  const reason: WindowStartReason = reset > stamp && reset < stamp + 21600 ? 'waiting-reset'
    : memory.attempted[attempt] ? 'already-attempted' : window.usedPercent !== 0 ? 'in-use'
    : !previous || previous.reset !== reset || previous.at >= reset || reset > stamp || stamp - reset > 3600 || p.fetchedAt < reset ? 'baseline' : 'eligible';
  return { reason, p, key, reset, attempt };
}
export async function readWindowStartStatus(dataDir: string, state: QuotaState | null, now = Date.now() / 1000) {
  const prefs = await readAgentPreferences(dataDir), memory = await readAgentJson<WindowMemory>(join(agentDirectory(dataDir), 'window-start.json'), { known: {}, attempted: {} });
  const owner = await readRuntimeOwner(dataDir);
  return (['claude', 'codex'] as const).map(provider => {
    const result = windowCandidate(state, provider, memory, now);
    const last = result.key ? Object.entries(memory.attempted).filter(([key]) => key.startsWith(result.key! + ':')).map(([, value]) => value).sort((a, b) => b.at - a.at)[0] ?? null : null;
    const reason: WindowStartReason = !prefs[`${provider}WindowStart`] ? 'disabled' : process.env.QUOTERN_DEV_ISOLATED === '1' ? 'isolated' : owner?.pid !== process.pid ? 'owner' : result.reason === 'eligible' && (memory.blocked?.[provider] ?? 0) > now - 900 ? 'verification' : result.reason;
    return { provider, reason, last: last ? { at: last.at, outcome: last.outcome } : null };
  });
}
