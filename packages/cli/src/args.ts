import {
  DEFAULT_PORT,
  SYNC_SOURCE_IDS,
  normalizeSyncSource,
} from 'quotern-core';
import type { SupportedLocale } from 'quotern-i18n';
import { cliT, extractCliLanguage, systemCliLocale, userError } from './i18n/locale.js';

export const DEFAULT_HOST = '127.0.0.1';

/** `--source` 的合法取值提示，从 sync registry 生成，避免帮助与实现脱节。 */
export function formatSyncSourceList(): string {
  return ['all', ...SYNC_SOURCE_IDS].join(' | ');
}

/**
 * 校验 `--source`：未传 / `all` 表示全量；别名与大小写归一为标准 id；
 * 未知值抛错（由 main 打印并以非零码退出），绝不静默跳过。
 */
export function resolveSyncSource(raw?: string, locale: SupportedLocale = systemCliLocale()): string | undefined {
  const resolved = normalizeSyncSource(raw);
  if (resolved !== null) return resolved;
  throw userError(locale, 'arg.sourceUnknown', { value: raw, sources: formatSyncSourceList() });
}

export function isWildcardListenHost(host: string): boolean {
  return host === '0.0.0.0' || host === '::';
}

export function formatListenUrl(host: string, port: number): string {
  const display = isWildcardListenHost(host) ? DEFAULT_HOST : host;
  const formatted =
    display.includes(':') && !display.startsWith('[') ? `[${display}]` : display;
  return `http://${formatted}:${port}`;
}

export interface ParsedArgs {
  command: string;
  lang?: SupportedLocale;
  serviceAction?: string;
  /** Set only when --port is passed. */
  port?: number;
  /** Set only when --host is passed. */
  host?: string;
  source?: string;
  /** Hidden debug: seed statsSince to N days ago when missing. Not shown in --help. */
  days?: number;
}

export function normalizeListenHost(raw: string, locale: SupportedLocale = systemCliLocale()): string {
  const host = raw.trim();
  if (!host) {
    throw userError(locale, 'arg.hostEmpty');
  }
  if (/[\s/?#]/.test(host)) {
    throw userError(locale, 'arg.hostInvalid', { value: raw });
  }
  return host;
}

export function normalizeListenPort(raw: string, locale: SupportedLocale = systemCliLocale()): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw userError(locale, 'arg.portInvalid', { value: raw });
  }
  return port;
}

function isFlagToken(value: string | undefined): boolean {
  return value != null && value.startsWith('-') && value !== '-';
}

export function parseArgs(argv: string[]): ParsedArgs {
  const { args, lang } = extractCliLanguage(argv.slice(2));
  const locale = lang ?? systemCliLocale();
  let command = args[0] ?? 'start';
  let serviceAction: string | undefined;
  let port: number | undefined;
  let host: string | undefined;
  let source: string | undefined;
  let days: number | undefined;

  if (
    command === 'help' ||
    command === '--help' ||
    command === '-h' ||
    args.includes('--help') ||
    args.includes('-h')
  ) {
    return { command: 'help', port, host, source, ...(lang ? { lang } : {}) };
  }

  if (command === 'service') {
    serviceAction = args[1];
  }

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port') {
      if (isFlagToken(args[i + 1]) || args[i + 1] == null) {
        throw userError(locale, 'arg.portMissing');
      }
      port = normalizeListenPort(args[i + 1], locale);
      i += 1;
    } else if (args[i] === '--host') {
      if (isFlagToken(args[i + 1]) || args[i + 1] == null) {
        throw userError(locale, 'arg.hostMissing');
      }
      host = normalizeListenHost(args[i + 1], locale);
      i += 1;
    } else if (args[i]?.startsWith('--host=')) {
      host = normalizeListenHost(args[i].slice('--host='.length), locale);
    } else if (args[i] === '--source') {
      if (isFlagToken(args[i + 1]) || args[i + 1] == null) throw userError(locale, 'arg.sourceMissing');
      source = args[i + 1];
      i += 1;
    } else if (args[i]?.startsWith('--source=')) {
      source = args[i].slice('--source='.length);
      if (!source.trim()) throw userError(locale, 'arg.sourceMissing');
    } else if (args[i] === '--days') {
      if (isFlagToken(args[i + 1]) || args[i + 1] == null) throw userError(locale, 'arg.daysMissing');
      days = Number(args[i + 1]);
      i += 1;
    } else if (args[i]?.startsWith('--days=')) {
      days = Number(args[i].slice('--days='.length));
    } else if (args[i] === '--quotern-dev-instance') {
      // Internal marker passed by the isolated dev launcher for process ownership.
      if (isFlagToken(args[i + 1]) || args[i + 1] == null) {
        throw userError(locale, 'arg.unknownOption', { value: args[i] });
      }
      i += 1;
    } else if (args[i].startsWith('-')) {
      throw userError(locale, 'arg.unknownOption', { value: args[i] });
    }
  }
  if (command.startsWith('-')) command = 'start';
  return { command, serviceAction, port, host, source, days, ...(lang ? { lang } : {}) };
}

export function resolveDaysAgo(days: number | undefined, locale: SupportedLocale = systemCliLocale()): number | undefined {
  if (days === undefined) return undefined;
  if (!Number.isInteger(days) || days <= 0) {
    throw userError(locale, 'arg.daysPositive', { value: days });
  }
  return days;
}

export function printHelp(locale: SupportedLocale = systemCliLocale()): void {
  console.log(cliT(locale, 'help.full', {
    port: DEFAULT_PORT,
    host: DEFAULT_HOST,
    sources: formatSyncSourceList(),
  }));
  console.log(cliT(locale, 'help.demo'));
}
