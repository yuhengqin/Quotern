import { readFile, stat } from 'node:fs/promises';
import { request } from 'node:http';
import { join, resolve } from 'node:path';
import { DEFAULT_PORT, resolveDataDir } from 'quotern-core';
import { filterQuotaReport, projectQuotaReport, type QuotaReport, type QuotaRuntimeSource } from 'quotern-core/quota/report';
import { quotaDirectoryKey, readQuotaReport } from 'quotern-core/quota/snapshot';
import { isSubscriptionChannelId, type SubscriptionChannelId } from 'quotern-core/quota/shared/subscription-channels';
import type { QuotaState } from 'quotern-core/quota/shared/quota';
import type { SupportedLocale } from 'quotern-i18n';
import { cliT, userError } from './i18n/locale.js';

export type QuotaView = 'status' | 'forecast' | 'diagnostics';
export interface QuotaCommandOptions {
  view: QuotaView; runtime: QuotaRuntimeSource | 'latest'; provider?: SubscriptionChannelId;
  directory: string; refresh: boolean; port?: number; format: 'text' | 'json'; help: boolean;
}
export function parseQuotaArgs(args: string[], locale: SupportedLocale, mcp = false): QuotaCommandOptions {
  const options: QuotaCommandOptions = { view: 'status', runtime: 'latest', directory: resolveDataDir(), refresh: false, format: 'text', help: false };
  const seen = new Set<string>(); let hasView = false;
  for (let i = 0; i < args.length; i++) {
    const token = args[i], split = token.indexOf('='), key = split < 0 ? token : token.slice(0, split);
    const canonical = key === '--json' ? '--format' : key === '-h' ? '--help' : key;
    if (seen.has(canonical)) throw userError(locale, 'usage.duplicate', { option: key });
    seen.add(canonical);
    if (key === '--help' || key === '-h' || key === '--json' || key === '--refresh') {
      if (split >= 0 || mcp && (key === '--json' || key === '--refresh')) throw userError(locale, 'arg.unknownOption', { value: key });
      if (key === '--json') options.format = 'json'; else if (key === '--refresh') options.refresh = true; else options.help = true;
      continue;
    }
    if (['--data-dir', '--runtime', ...(!mcp ? ['--provider', '--format', '--port'] : [])].includes(key)) {
      const value = split < 0 ? args[++i] : token.slice(split + 1);
      if (!value || value.startsWith('-')) throw userError(locale, 'usage.missing', { option: key });
      if (key === '--data-dir') options.directory = resolve(resolveDataDir(value));
      else if (key === '--runtime' && ['cli', 'desktop', 'latest'].includes(value)) options.runtime = value as QuotaCommandOptions['runtime'];
      else if (key === '--provider' && isSubscriptionChannelId(value)) options.provider = value;
      else if (key === '--format' && ['json', 'text'].includes(value)) options.format = value as 'json' | 'text';
      else if (key === '--port' && /^\d+$/.test(value) && Number(value) >= 1 && Number(value) <= 65535) options.port = Number(value);
      else throw userError(locale, 'quota.invalidValue', { option: key });
      continue;
    }
    if (!mcp && !hasView && ['status', 'forecast', 'diagnostics'].includes(token)) { options.view = token as QuotaView; hasView = true; }
    else throw userError(locale, token.startsWith('-') ? 'arg.unknownOption' : 'arg.unknownCommand', { value: token });
  }
  if (options.port !== undefined && !options.refresh) throw userError(locale, 'quota.portRefresh');
  if (options.refresh && options.runtime === 'desktop') throw userError(locale, 'quota.desktopRefresh');
  return options;
}
export function quotaHelp(locale: SupportedLocale, mcp = false): string {
  return `${mcp ? 'quotern mcp [--data-dir PATH] [--runtime latest|cli|desktop]' : 'quotern quota [status|forecast|diagnostics] [--json] [--provider ID]\n  [--runtime latest|cli|desktop] [--data-dir PATH] [--refresh [--port PORT]]'}\n${cliT(locale, mcp ? 'quota.mcpHelp' : 'quota.help')}`;
}
export function quotaView(report: QuotaReport, view: QuotaView): Record<string, unknown> {
  if (view === 'status') return { ...report, view };
  return { ...report, view, providers: report.providers.map(p => view === 'diagnostics'
    ? { id: p.id, provider: p.provider, label: p.label, status: p.status, stale: p.stale, source: p.source, identityVerified: p.identityVerified, fetchedAt: p.fetchedAt, queriedAt: p.queriedAt, diagnostic: p.diagnostic }
    : { id: p.id, provider: p.provider, label: p.label, status: p.status, stale: p.stale, source: p.source, fetchedAt: p.fetchedAt, windows: p.windows, details: p.details }) };
}
function formatQuota(report: QuotaReport, view: QuotaView, locale: SupportedLocale): string {
  const t = (key: string) => cliT(locale, `quota.${key}`);
  const lines = [`Quotern ${view} · ${report.runtime ?? '—'} · ${report.availability}${report.stale ? ` · ${t('stale')}` : ''}`];
  if (report.availability !== 'ready') lines.push(t('missing'));
  for (const p of report.providers) {
    lines.push(`${p.id}: ${p.status}${p.stale ? ` · ${t('stale')}` : ''} · ${p.source}`);
    if (view === 'diagnostics') {
      lines.push(`  ${p.diagnostic?.code ?? '—'} · ${p.diagnostic?.durationMs ?? '—'} ms · retryAt=${p.diagnostic?.retryAt ?? '—'} · retainedFrom=${p.diagnostic?.retainedFrom ?? '—'}`);
      for (const a of p.diagnostic?.attempts ?? []) lines.push(`  ${a.stage}: ${a.outcome} ${a.code ?? ''}${a.httpStatus ? ` HTTP ${a.httpStatus}` : ''}`);
    } else {
      for (const w of p.windows) {
        const amount = w.kind === 'balance' ? `${t('balance')}: ${w.balance?.remaining === null || w.balance?.remaining === undefined ? t('unknown') : `${w.balance.remaining.toFixed(2)} ${w.balance.currency}`}` : `${w.usedPercent!.toFixed(1)}% ${t('used')}`;
        lines.push(`  ${w.id}: ${amount}${w.stale ? ` · ${t('stale')}` : ''} · ${w.timeKind}=${w.resetsAt ? new Date(w.resetsAt * 1000).toISOString() : '—'}${view === 'forecast' ? ` · ETA=${w.forecast?.etaAt ? new Date(w.forecast.etaAt * 1000).toISOString() : '—'} · pace=${w.forecast?.paceDifference ?? '—'}` : ''}`);
      }
      for (const d of p.details) lines.push(`  ${d.id}: ${t(d.valueKind)}${d.stale ? ` · ${t('stale')}` : ''}`);
      if (!p.windows.length && !p.details.length) lines.push(`  ${t('unknown')}`);
    }
  }
  if (view === 'forecast') lines.push(t('forecastNote'));
  return lines.join('\n');
}
async function refreshQuota(options: QuotaCommandOptions, locale: SupportedLocale): Promise<QuotaReport> {
  let port = options.port;
  if (port === undefined) {
    try {
      const file = join(options.directory, 'config.json');
      if ((await stat(file)).size > 65536) throw new Error();
      const config = JSON.parse(await readFile(file, 'utf8'));
      if (Number.isInteger(config.serverPort) && config.serverPort >= 1 && config.serverPort <= 65535) port = config.serverPort;
    } catch { /* Never create or repair a runtime config for a query. */ }
  }
  try {
    // node:http goes directly to loopback, independent of provider proxy configuration.
    const data: unknown = await new Promise((resolve, reject) => {
      const body = JSON.stringify({ ...(options.provider ? { provider: options.provider } : {}), directoryKey: quotaDirectoryKey(options.directory) });
      const req = request({ hostname: '127.0.0.1', port: port ?? DEFAULT_PORT, method: 'POST', path: '/functions/tud-quota/refresh',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, res => {
        const chunks: Buffer[] = []; let size = 0;
        res.on('data', chunk => { size += chunk.length; if (size > 1024 * 1024) { req.destroy(new Error('response limit')); } else chunks.push(chunk); });
        res.on('error', reject);
        res.on('end', () => {
          try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (res.statusCode !== 200 || value.success !== true) throw new Error(); resolve(value.data); }
          catch { reject(new Error('refresh unavailable')); }
        });
      });
      req.setTimeout(65000, () => req.destroy(new Error('refresh timeout')));
      req.on('error', reject); req.end(body);
    });
    if (!data || typeof data !== 'object' || !Array.isArray((data as QuotaState).providers)) throw new Error();
    return projectQuotaReport(data as QuotaState, 'cli');
  } catch { throw userError(locale, 'quota.refreshUnavailable'); }
}
export async function runQuotaCommand(args: string[], locale: SupportedLocale): Promise<void> {
  const options = parseQuotaArgs(args, locale);
  if (options.help) { console.log(quotaHelp(locale)); return; }
  const report = filterQuotaReport(options.refresh ? await refreshQuota(options, locale) : await readQuotaReport(options.directory, { runtime: options.runtime }), options.provider);
  console.log(options.format === 'json' ? JSON.stringify(quotaView(report, options.view), null, 2) : formatQuota(report, options.view, locale));
}
