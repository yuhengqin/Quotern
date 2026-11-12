import { resolve } from 'node:path';
import { localDateNow, readUsageReport, resolveDataDir, type UsageReport } from 'quotern-core';
import type { SupportedLocale } from 'quotern-i18n';
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { contextPercent, contextSample, statuslineDiagnostics, type ContextSample } from './statusline-diagnostics.js';
import { readQuotaReport } from 'quotern-core/quota/snapshot';
import type { QuotaReport } from 'quotern-core/quota/report';
export { contextSample } from './statusline-diagnostics.js';

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const number = (v: unknown): number | null => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null;
const label = (v: unknown) => typeof v === 'string' ? v.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '').replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100) : '';
const words: Record<SupportedLocale, readonly string[]> = {
  'zh-CN': ['会话', '今日', '上下文', '未知', '宿主', '本地估算', '已知小计', '同步', '会话均速'],
  en: ['session', 'today', 'context', 'unknown', 'host', 'local estimate', 'subtotal', 'synced', 'session avg'],
  ja: ['セッション', '今日', 'コンテキスト', '不明', 'ホスト', 'ローカル推定', '既知の小計', '同期', 'セッション平均'],
  ko: ['세션', '오늘', '컨텍스트', '알 수 없음', '호스트', '로컬 추정', '확인된 소계', '동기화', '세션 평균'],
};
export interface StatuslineOptions { preset?: 'compact' | 'detailed'; quota?: QuotaReport | null; account?: string; showQuota?: boolean; showReset?: boolean; color?: boolean }
export function formatStatusline(payload: unknown, report: UsageReport | null, locale: SupportedLocale, previous?: ContextSample | null, now = Date.now(), options: StatuslineOptions = {}): string {
  const data = obj(payload), model = obj(data.model), cost = obj(data.cost);
  const w = words[locale], unknown = w[3];
  const money = (v: number) => `$${v.toFixed(2)}`;
  const hostCost = number(cost.total_cost_usd);
  const percent = contextPercent(payload);
  const today = report ? `${money(report.summary.knownCostUsd)}${report.summary.costUsd === null ? ` ${w[6]}` : ''} (${w[5]})` : unknown;
  const chunks = [label(model.display_name ?? model.id) || 'Claude', `${w[0]} ${hostCost === null ? unknown : `${money(hostCost)} (${w[4]})`}`, `${w[1]} ${today}`, `${w[2]} ${percent === null ? unknown : `${Math.round(percent)}%`}`];
  const duration = number(cost.total_duration_ms);
  if (options.preset !== 'compact') {
    if (hostCost !== null && duration && duration > 0) chunks.push(`${w[8]} ${money(hostCost * 3600000 / duration)}/h`);
    if (report?.coverage.lastSyncAt && Number.isFinite(Date.parse(report.coverage.lastSyncAt))) chunks.push(`${w[7]} ${new Date(report.coverage.lastSyncAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`);
    chunks.push(...statuslineDiagnostics(payload, locale, previous, now));
  }
  const q = { 'zh-CN': ['监测账号', '剩余', '旧读数', '重置', '到期'], en: ['monitored account', 'left', 'stale', 'reset', 'expires'], ja: ['監視アカウント', '残り', '古い値', 'リセット', '期限'], ko: ['모니터링 계정', '남음', '오래된 값', '초기화', '만료'] }[locale];
  const account = options.account ?? 'claude', provider = options.quota?.providers.find(provider => provider.id === account);
  if (options.account) chunks.push(`${q[0]} ${label(account)}`);
  if (options.showQuota || options.showReset) {
    const windows = provider?.windows.filter(window => window.kind === 'percentage').slice(0, options.preset === 'compact' ? 1 : 3) ?? [];
    if (!windows.length) chunks.push(`quota ${unknown}`);
    for (const window of windows) {
      const period = window.periodSeconds ? window.periodSeconds % 86400 === 0 ? `${window.periodSeconds / 86400}d` : `${window.periodSeconds / 3600}h` : label(window.id);
      const stale = options.quota?.stale || provider?.stale || provider?.status !== 'ready' || window.stale;
      const remaining = window.usedPercent === null ? unknown : `${Math.round(100 - window.usedPercent)}% ${q[1]}`;
      const text = `${period} ${options.showQuota ? remaining : ''}${stale ? ` (${q[2]})` : ''}`;
      chunks.push(options.color && window.usedPercent !== null ? `\x1b[${stale ? 90 : window.usedPercent >= 90 ? 31 : window.usedPercent >= 70 ? 33 : 32}m${text}\x1b[0m` : text);
      if (options.showReset) chunks.push(`${q[window.timeKind === 'expiry' ? 4 : 3]} ${window.resetsAt !== null && window.resetsAt * 1000 > now ? `${Math.ceil((window.resetsAt * 1000 - now) / 60000)}m` : unknown}`);
    }
  }
  return chunks.join(' · ');
}

/** Bounded stdin; never follow a transcript path or execute host-provided text. */
async function readHostInput(): Promise<unknown> {
  if (process.stdin.isTTY) return {};
  return new Promise(resolveInput => {
    let body = '', bytes = 0, finished = false;
    const done = () => {
      if (finished) return; finished = true; clearTimeout(timer);
      process.stdin.off('data', data); process.stdin.off('end', done); process.stdin.off('error', done); process.stdin.pause();
      try { resolveInput(bytes > 1024 * 1024 ? {} : JSON.parse(body)); } catch { resolveInput({}); }
    };
    const data = (chunk: Buffer | string) => { bytes += Buffer.byteLength(chunk); if (bytes > 1024 * 1024) { done(); return; } body += chunk.toString(); };
    const timer = setTimeout(done, 1500);
    process.stdin.on('data', data); process.stdin.once('end', done); process.stdin.once('error', done); process.stdin.resume();
  });
}
export async function runStatusline(args: string[], locale: SupportedLocale): Promise<void> {
  let dataDir = resolveDataDir();
  let trackContext = false;
  const options: StatuslineOptions = {}; let preview = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') { console.log('quotern statusline [--preset compact|detailed] [--quota] [--account PROVIDER_ID] [--reset] [--color] [--preview] [--track-context] [--data-dir PATH] [--lang zh-CN|en|ja|ko]'); return; }
    if (args[i] === '--preview') { preview = true; continue; }
    if (args[i] === '--quota') { options.showQuota = true; continue; }
    if (args[i] === '--reset') { options.showReset = true; continue; }
    if (args[i] === '--color') { options.color = !process.env.NO_COLOR; continue; }
    if (args[i] === '--preset' && ['compact', 'detailed'].includes(args[i + 1] ?? '')) { options.preset = args[++i] as 'compact' | 'detailed'; continue; }
    if (args[i] === '--account' && /^(claude|codex)(?:@[a-zA-Z0-9_-]{1,80})?$/.test(args[i + 1] ?? '')) { options.account = args[++i]; continue; }
    if (args[i] === '--track-context') { trackContext = true; continue; }
    if (args[i] === '--data-dir' && args[i + 1]?.trim() && !args[i + 1]!.startsWith('-')) dataDir = resolve(args[++i]!);
    else throw new Error('Invalid statusline option');
  }
  const payload = preview ? { model: { display_name: 'Claude' }, cost: { total_cost_usd: 1.25 }, context_window: { used_percentage: 62 } } : await readHostInput();
  if (preview) { options.quota = { stale: false, providers: [{ id: options.account ?? 'claude', status: 'ready', stale: false, windows: [{ id: 'five-hour', kind: 'percentage', usedPercent: 72, resetsAt: Date.now() / 1000 + 4800, periodSeconds: 18000, timeKind: 'reset', stale: false }] }] } as QuotaReport; console.log(formatStatusline(payload, null, locale, null, Date.now(), options)); return; }
  if (options.showQuota || options.showReset) options.quota = await readQuotaReport(dataDir);
  let report: UsageReport | null = null;
  try {
    const today = localDateNow();
    report = await readUsageReport(dataDir, { sources: ['claude'], fromDate: today, toDate: today });
  } catch { /* Missing or malformed local state is unknown, never zero. */ }
  let previous: ContextSample | null = null;
  const sample = trackContext ? contextSample(payload) : null;
  if (sample) {
    // A bounded fixed set of slots avoids one retained file per historical session.
    const dir = join(dataDir, 'statusline');
    const slot = createHash('sha256').update(sample.sessionId).digest()[0]! % 32;
    const file = join(dir, `${slot}.json`);
    try { previous = JSON.parse(await readFile(file, 'utf8')) as ContextSample; } catch { /* First observation. */ }
    try {
      await mkdir(dir, { recursive: true });
      const temp = `${file}.${process.pid}.tmp`;
      await writeFile(temp, JSON.stringify(sample), { mode: 0o600 });
      await rename(temp, file);
    } catch { /* Diagnostics must not break the host status line. */ }
  }
  console.log(formatStatusline(payload, report, locale, previous, Date.now(), options));
}
