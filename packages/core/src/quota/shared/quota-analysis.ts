import { quotaWindowPeriodSeconds } from './quota.js';
import type { QuotaAnalysis, QuotaPaceModel, QuotaProviderState, QuotaSample, QuotaWindow } from './quota.js';

const DAY = 86400;
const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const timestamp = (value: unknown): number | null => finite(value) && value > 0 ? value : null;
const calendarFormatters = new Map<string, Intl.DateTimeFormat>();

/** A display projection; amounts and unlimited pools stay in their provider-specific snapshot. */
export function normalizeQuotaSnapshot(id: string, label: string, value: unknown): QuotaProviderState {
  const raw = record(value);
  const windows: QuotaWindow[] = [];
  const details: QuotaProviderState['details'] = [];
  const add = (key: string, title: string, value: unknown, duration?: number) => {
    const row = record(value);
    if (row.unlimited === true) {
      const valueKind = row.exhausted === true ? 'exhausted' : 'unlimited';
      details.push({ id: key, label: title, text: valueKind === 'exhausted' ? '已用尽' : '无限', valueKind, resetsAt: timestamp(row.resetsAt) });
      return;
    }
    const used = finite(row.usedPercent) ? row.usedPercent
      : finite(row.remainingPercent) ? 100 - row.remainingPercent : null;
    if (used === null || windows.some(window => window.id === key)) return;
    const window: QuotaWindow = { id: key, label: title, usedPercent: Math.max(0, Math.min(100, used)),
      resetsAt: timestamp(row.resetsAt), durationSeconds: finite(row.durationSeconds) && row.durationSeconds > 0 ? row.durationSeconds : duration ?? null,
      ...(finite(row.periodSeconds) && row.periodSeconds > 0 ? { periodSeconds: row.periodSeconds } : {}),
      ...(id === 'qoder' ? { timeKind: 'expiry' as const } : {}),
      ...(typeof row.groupLabel === 'string' ? { groupLabel: row.groupLabel } : {}),
      ...(row.analysisEligible === false ? { analysisEligible: false } : {}),
      ...(id === 'deepseek' ? { valueText: finite(row.remaining) ? `¥${row.remaining.toFixed(2)}` : '余额未知',
        balance: { currency: 'CNY' as const, remaining: finite(row.remaining) && row.remaining >= 0 ? row.remaining : null }, analysisEligible: false } : {}),
      ...(finite(row.used) && finite(row.limit) && row.limit > 0 ? { used: row.used, limit: row.limit,
        unit: row.unit === 'requests' || row.unit === 'credits' ? row.unit : 'tokens' } : {}),
    };
    window.periodSeconds = quotaWindowPeriodSeconds(window);
    windows.push(window);
  };
  if (Array.isArray(raw.windows)) {
    for (const item of raw.windows) { const row = record(item); if (typeof row.id === 'string' && typeof row.label === 'string') add(row.id, row.label, row); }
  } else {
    add('five-hour', '5h', raw.fiveHour, 18000);
    add('weekly', '7d', raw.weekly ?? raw.sevenDay, 604800);
    for (const [key, title] of [['cursorModels', 'Cursor'], ['otherModels', 'Other'], ['plan', '套餐']] as const) add(key, title, raw[key]);
    if (Array.isArray(raw.limits)) for (const item of raw.limits) {
      const row = record(item);
      if (typeof row.id !== 'string' || typeof row.label !== 'string') continue;
      const duration = ['five-hour', 'five_hour', '5h'].includes(row.id) ? 18000 : ['weekly', 'seven-day', '7d'].includes(row.id) ? 604800 : undefined;
      add(row.id, row.label, row, duration);
    }
  }
  const displayLabel = id === 'zcode' && raw.provider === 'bigmodel' ? 'ZCode CN' : id === 'zcode' && raw.provider === 'zai' ? 'ZCode Global' : id === 'minimax' && raw.region === 'mainland' ? 'MiniMax CN' : label;
  return { id, label: displayLabel, status: typeof raw.status === 'string' ? raw.status : 'unavailable',
    planLabel: typeof raw.planLabel === 'string' ? raw.planLabel : null,
    fetchedAt: timestamp(raw.fetchedAt), queriedAt: null, stale: raw.stale === true,
    message: typeof raw.message === 'string' ? raw.message : null, windows, details,
    resetCredits: finite(raw.resetCredits) && raw.resetCredits >= 0 ? raw.resetCredits : null,
    refreshing: false, nextRefreshAt: null, analyses: {}, service: null };
}

export function quotaCycleChanged(previous: QuotaSample, current: QuotaSample): boolean {
  if (previous.resetsAt !== null && current.resetsAt !== null) {
    return current.resetsAt > previous.resetsAt + 60;
  }
  return false;
}

function localParts(at: number, zone: string) {
  let formatter = calendarFormatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    calendarFormatters.set(zone, formatter);
  }
  const parts = formatter.formatToParts(new Date(at * 1000));
  const p = Object.fromEntries(parts.map(part => [part.type, Number(part.value)]));
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute, second: p.second };
}
function calendar(at: number, zone: string) {
  const p = localParts(at, zone);
  const date = Date.UTC(p.year, p.month - 1, p.day) / 1000;
  return { key: `${p.year}-${p.month}-${p.day}`, weekday: new Date(date * 1000).getUTCDay(), date, offset: date + p.hour * 3600 + p.minute * 60 + p.second - Math.floor(at) };
}
function weightedSeconds(from: number, to: number, weights: number[], zone: string): number {
  let sum = 0;
  for (let cursor = from, iterations = 0; cursor < to && iterations < 740; iterations++) {
    const local = calendar(cursor, zone);
    let next = local.date + DAY - local.offset;
    // Resolve the next local midnight with its own UTC offset across daylight saving changes.
    next = local.date + DAY - calendar(next, zone).offset;
    if (next <= cursor) next = cursor + 3600;
    const end = Math.min(to, next);
    sum += (end - cursor) * weights[local.weekday];
    cursor = end;
  }
  return sum;
}
function weekdayWeights(samples: QuotaSample[], now: number, zone: string): number[] | null {
  const dates = new Set<string>();
  const days = Array.from({ length: 7 }, () => new Set<string>());
  const sums = Array(7).fill(0) as number[];
  const recent = samples.filter(sample => sample.at >= now - 28 * DAY && sample.at <= now);
  for (let i = 0; i < recent.length; i++) {
    const current = recent[i], local = calendar(current.at, zone);
    dates.add(local.key); days[local.weekday].add(local.key);
    const previous = recent[i - 1];
    if (!previous || current.at - previous.at > 12 * 3600) continue;
    const consumed = quotaCycleChanged(previous, current) ? current.usedPercent : Math.max(0, current.usedPercent - previous.usedPercent);
    sums[local.weekday] += consumed;
  }
  return dates.size >= 14 && sums.some(value => value > 0) ? sums.map((sum, i) => sum / Math.max(1, days[i].size)) : null;
}

export function analyzeQuota(window: QuotaWindow, history: QuotaSample[], now: number, model: QuotaPaceModel, zone = 'Asia/Shanghai'): QuotaAnalysis {
  const samples = history.filter(sample => finite(sample.at) && finite(sample.usedPercent) && sample.at <= now && sample.usedPercent >= 0 && sample.usedPercent <= 100)
    .sort((a, b) => a.at - b.at).filter((sample, i, rows) => i === 0 || sample.at > rows[i - 1].at);
  let recent = samples.filter(sample => sample.at >= now - 6 * 3600);
  for (let i = recent.length - 1; i > 0; i--) if (quotaCycleChanged(recent[i - 1], recent[i])) { recent = recent.slice(i); break; }
  if (window.resetsAt !== null) recent = recent.filter(sample => sample.resetsAt !== null && Math.abs(sample.resetsAt - window.resetsAt!) <= 60);
  const result: QuotaAnalysis = { paceDifference: null, paceBasis: 'uniform', etaAt: null, trend: recent.length >= 3 ? recent : [] };
  const reset = window.resetsAt, duration = window.durationSeconds;
  if (reset && duration && duration > 0 && duration <= 366 * DAY && reset > now && reset - now <= duration && window.usedPercent < 100) {
    const elapsed = 1 - (reset - now) / duration;
    let expected = elapsed;
    if (duration >= 2 * DAY && model !== 'uniform') {
      const weights = model === 'workdays' ? [0, 1, 1, 1, 1, 1, 0] : weekdayWeights(samples, now, zone);
      if (weights) {
        const total = weightedSeconds(reset - duration, reset, weights, zone);
        if (total > 0) { expected = weightedSeconds(reset - duration, now, weights, zone) / total; result.paceBasis = model; }
      }
    }
    if (elapsed >= 0.03) result.paceDifference = Math.round(expected * 100 - window.usedPercent);
  }
  const fit = recent.filter(sample => sample.at >= now - 90 * 60);
  if (window.usedPercent < 5 || window.usedPercent >= 100 || !reset || reset <= now || fit.length < 3 || fit.at(-1)!.at < now - 30 * 60 || fit.at(-1)!.at - fit[0].at < 1800) return result;
  const origin = fit[0].at;
  let sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const sample of fit) { const x = sample.at - origin; sx += x; sy += sample.usedPercent; sxy += x * sample.usedPercent; sxx += x * x; }
  const denominator = fit.length * sxx - sx * sx;
  const slope = denominator > 0 ? (fit.length * sxy - sx * sy) / denominator : 0;
  if (slope > 0 && Number.isFinite(slope)) {
    const last = fit.at(-1)!;
    const eta = last.at + (100 - last.usedPercent) / slope;
    if (eta > now && eta < reset) result.etaAt = eta;
  }
  return result;
}

export interface QuotaObservation extends QuotaSample { crossed: number[]; highest: number }
export type QuotaAlertKind = 'threshold-70' | 'threshold-90' | 'reset';
export function evaluateQuotaAlerts(previous: QuotaObservation | null, current: QuotaSample, kind: string): { observation: QuotaObservation; alerts: QuotaAlertKind[] } {
  const thresholds = kind === 'five-hour' || kind === '5h' ? [90] : [70, 90];
  const baseline = () => ({ ...current, crossed: thresholds.filter(value => current.usedPercent >= value), highest: current.usedPercent });
  if (!previous) return { observation: baseline(), alerts: [] };
  if (current.at <= previous.at) return { observation: previous, alerts: [] };
  const reset = quotaCycleChanged(previous, current);
  const crossed = reset ? [] : [...previous.crossed];
  const alerts: QuotaAlertKind[] = [];
  if (reset && previous.highest >= thresholds[0] && previous.usedPercent - current.usedPercent >= 10) alerts.push('reset');
  if (reset) return { observation: baseline(), alerts };
  for (const threshold of thresholds) if (!crossed.includes(threshold) && previous.usedPercent < threshold && current.usedPercent >= threshold) {
    crossed.push(threshold); alerts.push(`threshold-${threshold}` as QuotaAlertKind);
  }
  return { observation: { ...current, resetsAt: current.resetsAt ?? previous.resetsAt, crossed, highest: Math.max(previous.highest, current.usedPercent) }, alerts };
}
