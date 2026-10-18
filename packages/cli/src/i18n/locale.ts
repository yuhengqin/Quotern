import {
  registerMessages,
  resolveLocale,
  translate,
  type SupportedLocale,
} from 'quotern-i18n';
import { cliMessages } from './messages.js';

registerMessages(cliMessages);

const SUPPORTED = new Set<SupportedLocale>(['zh-CN', 'en', 'ja', 'ko']);

export class CliUserError extends Error {}

export function cliT(
  locale: SupportedLocale,
  key: string,
  options?: Record<string, unknown>,
): string {
  return translate(locale, `cli.${key}`, options);
}

function environmentLocale(raw: string | undefined): string {
  return (raw ?? '').split(/[.@]/, 1)[0].replace('_', '-');
}

export function systemCliLocale(): SupportedLocale {
  return resolveLocale('system', [
    environmentLocale(process.env.LC_ALL),
    environmentLocale(process.env.LC_MESSAGES),
    environmentLocale(process.env.LANG),
    Intl.DateTimeFormat().resolvedOptions().locale,
  ].filter(Boolean));
}

/** A tolerant preview lets the top-level error boundary select the right language. */
export function previewCliLocale(args: readonly string[]): SupportedLocale {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    const value = token === '--lang'
      ? args[index + 1]
      : token.startsWith('--lang=') ? token.slice('--lang='.length) : undefined;
    if (value && SUPPORTED.has(value as SupportedLocale)) return value as SupportedLocale;
  }
  return systemCliLocale();
}

export function extractCliLanguage(args: readonly string[]): {
  args: string[];
  lang?: SupportedLocale;
} {
  const cleaned: string[] = [];
  let lang: SupportedLocale | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token !== '--lang' && !token.startsWith('--lang=')) {
      cleaned.push(token);
      continue;
    }
    if (lang !== undefined) throw new CliUserError(cliT(lang, 'lang.duplicate'));
    const value = token === '--lang' ? args[++index] : token.slice('--lang='.length);
    if (!value || value.startsWith('-')) {
      throw new CliUserError(cliT(systemCliLocale(), 'lang.missing'));
    }
    if (!SUPPORTED.has(value as SupportedLocale)) {
      throw new CliUserError(cliT(systemCliLocale(), 'lang.invalid', { value }));
    }
    lang = value as SupportedLocale;
  }
  return { args: cleaned, ...(lang ? { lang } : {}) };
}

export function userError(
  locale: SupportedLocale,
  key: string,
  options?: Record<string, unknown>,
): CliUserError {
  return new CliUserError(cliT(locale, key, options));
}
