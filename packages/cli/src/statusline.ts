import { resolve } from 'node:path';
import { localDateNow, readUsageReport, resolveDataDir, type UsageReport } from 'quotern-core';
import type { SupportedLocale } from 'quotern-i18n';

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
export function formatStatusline(payload: unknown, report: UsageReport | null, locale: SupportedLocale): string {
  const data = obj(payload), model = obj(data.model), cost = obj(data.cost), context = obj(data.context_window), usage = obj(context.current_usage);
  const w = words[locale], unknown = w[3];
  const money = (v: number) => `$${v.toFixed(2)}`;
  const hostCost = number(cost.total_cost_usd);
  const capacity = number(context.context_window_size);
  const counts = [usage.input_tokens, usage.cache_read_input_tokens, usage.cache_creation_input_tokens];
  const used = counts.some(v => number(v) !== null) ? counts.reduce<number>((sum, v) => sum + (number(v) ?? 0), 0) : null;
  const percent = number(context.used_percentage) ?? (used !== null && capacity && capacity > 0 ? used / capacity * 100 : null);
  const today = report ? `${money(report.summary.knownCostUsd)}${report.summary.costUsd === null ? ` ${w[6]}` : ''} (${w[5]})` : unknown;
  const chunks = [label(model.display_name ?? model.id) || 'Claude', `${w[0]} ${hostCost === null ? unknown : `${money(hostCost)} (${w[4]})`}`, `${w[1]} ${today}`, `${w[2]} ${percent === null ? unknown : `${Math.round(percent)}%`}`];
  const duration = number(cost.total_duration_ms);
  if (hostCost !== null && duration && duration > 0) chunks.push(`${w[8]} ${money(hostCost * 3600000 / duration)}/h`);
  if (report?.coverage.lastSyncAt && Number.isFinite(Date.parse(report.coverage.lastSyncAt))) chunks.push(`${w[7]} ${new Date(report.coverage.lastSyncAt).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' })}`);
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
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--help' || args[i] === '-h') { console.log('quotern statusline [--data-dir <path>] [--lang zh-CN|en|ja|ko]'); return; }
    if (args[i] === '--data-dir' && args[i + 1]?.trim() && !args[i + 1]!.startsWith('-')) dataDir = resolve(args[++i]!);
    else throw new Error('Invalid statusline option');
  }
  const payload = await readHostInput();
  let report: UsageReport | null = null;
  try {
    const today = localDateNow();
    report = await readUsageReport(dataDir, { sources: ['claude'], fromDate: today, toDate: today });
  } catch { /* Missing or malformed local state is unknown, never zero. */ }
  console.log(formatStatusline(payload, report, locale));
}
