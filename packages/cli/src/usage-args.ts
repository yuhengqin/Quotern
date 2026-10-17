import { resolveSyncSource } from './args.js';
import type { SupportedLocale } from 'quotern-i18n';
import { extractCliLanguage, systemCliLocale, userError } from './i18n/locale.js';

export type UsagePeriod =
  | 'summary'
  | 'overview'
  | 'daily'
  | 'weekly'
  | 'monthly'
  | 'models'
  | 'projects';

export type UsageFormat = 'text' | 'json' | 'csv';

export interface ParsedUsageArgs {
  query: {
    period: UsagePeriod;
    days?: number;
    fromDate?: string;
    toDate?: string;
    sources?: string[];
    model?: string;
    project?: string;
  };
  format: UsageFormat;
  compact?: boolean;
  dataDir?: string;
  help: boolean;
  lang?: SupportedLocale;
}

const PERIODS: readonly UsagePeriod[] = [
  'summary',
  'overview',
  'daily',
  'weekly',
  'monthly',
  'models',
  'projects',
];

interface OptionValue {
  value: string;
  nextIndex: number;
}

function readOptionValue(
  args: string[],
  index: number,
  option: string,
  locale: SupportedLocale,
): OptionValue {
  const token = args[index];
  const equalPrefix = `${option}=`;
  let value: string;
  let nextIndex = index;

  if (token.startsWith(equalPrefix)) {
    value = token.slice(equalPrefix.length);
  } else {
    const next = args[index + 1];
    if (next == null || next.startsWith('-')) {
      throw userError(locale, 'usage.missing', { option });
    }
    value = next;
    nextIndex += 1;
  }

  if (!value.trim()) {
    throw userError(locale, 'usage.empty', { option });
  }

  return { value, nextIndex };
}

function validateDays(raw: string, locale: SupportedLocale): number {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    throw userError(locale, 'usage.daysRange', { value: raw });
  }
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < 1 || days > 3660) {
    throw userError(locale, 'usage.daysRange', { value: raw });
  }
  return days;
}

function validateDate(option: '--from' | '--to', raw: string, locale: SupportedLocale): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw userError(locale, 'usage.dateInvalid', { option, value: raw });
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw userError(locale, 'usage.dateInvalid', { option, value: raw });
  }
  return raw;
}

function parseSources(rawValues: string[], locale: SupportedLocale): string[] | undefined {
  const tokens = rawValues.flatMap((raw) => raw.split(',').map((item) => item.trim()));
  if (tokens.some((item) => item.length === 0)) {
    throw userError(locale, 'usage.sourceEmpty');
  }

  let includesAll = false;
  const sources: string[] = [];
  for (const token of tokens) {
    const source = resolveSyncSource(token, locale);
    if (source === undefined) {
      includesAll = true;
    } else if (!sources.includes(source)) {
      sources.push(source);
    }
  }

  if (includesAll && sources.length > 0) {
    throw userError(locale, 'usage.sourceAllMixed');
  }
  return includesAll ? undefined : sources;
}

export function parseUsageArgs(inputArgs: string[]): ParsedUsageArgs {
  const { args, lang } = extractCliLanguage(inputArgs);
  const locale = lang ?? systemCliLocale();
  if (args.includes('--help') || args.includes('-h')) {
    return { query: { period: 'summary' }, format: 'text', dataDir: undefined, help: true, ...(lang ? { lang } : {}) };
  }

  let period: UsagePeriod | undefined;
  let days: number | undefined;
  let fromDate: string | undefined;
  let toDate: string | undefined;
  let model: string | undefined;
  let project: string | undefined;
  let dataDir: string | undefined;
  let format: UsageFormat | undefined;
  let compact = false;
  const sourceValues: string[] = [];
  const seenOptions = new Set<string>();

  const markSeen = (option: string): void => {
    if (seenOptions.has(option)) {
      throw userError(locale, 'usage.duplicate', { option });
    }
    seenOptions.add(option);
  };

  const setFormat = (next: UsageFormat, option: string): void => {
    if (format !== undefined) {
      if (format !== next) {
        throw userError(locale, 'usage.formatConflict', { first: format, second: next });
      }
      throw userError(locale, 'usage.duplicate', { option });
    }
    format = next;
  };

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === '--compact') {
      markSeen(token);
      compact = true;
      continue;
    }
    if (token === '--json' || token === '--csv') {
      markSeen(token);
      setFormat(token === '--json' ? 'json' : 'csv', token);
      continue;
    }

    const option = token.includes('=') ? token.slice(0, token.indexOf('=')) : token;
    if (
      option === '--days' ||
      option === '--from' ||
      option === '--to' ||
      option === '--source' ||
      option === '--model' ||
      option === '--project' ||
      option === '--data-dir' ||
      option === '--format'
    ) {
      markSeen(option);
      const { value, nextIndex } = readOptionValue(args, index, option, locale);
      index = nextIndex;

      switch (option) {
        case '--days':
          days = validateDays(value, locale);
          break;
        case '--from':
          fromDate = validateDate('--from', value, locale);
          break;
        case '--to':
          toDate = validateDate('--to', value, locale);
          break;
        case '--source':
          sourceValues.push(value);
          break;
        case '--model':
          model = value.trim();
          break;
        case '--project':
          project = value.trim();
          break;
        case '--data-dir':
          dataDir = value.trim();
          break;
        case '--format':
          if (value !== 'text' && value !== 'json' && value !== 'csv') {
            throw userError(locale, 'usage.formatInvalid', { value });
          }
          setFormat(value, option);
          break;
      }
      continue;
    }

    if (token.startsWith('-')) {
      throw userError(locale, 'usage.unknownOption', { value: token });
    }
    if (period !== undefined) {
      throw userError(locale, 'usage.extraArgument', { value: token });
    }
    if (!PERIODS.includes(token as UsagePeriod)) {
      throw userError(locale, 'usage.unknownPeriod', { value: token, periods: PERIODS.join(' | ') });
    }
    period = token as UsagePeriod;
  }

  if ((fromDate === undefined) !== (toDate === undefined)) {
    throw userError(locale, 'usage.rangePair');
  }
  if (fromDate !== undefined && toDate !== undefined && fromDate > toDate) {
    throw userError(locale, 'usage.rangeOrder');
  }
  if (fromDate !== undefined && days !== undefined) {
    throw userError(locale, 'usage.rangeDays');
  }
  if (compact && format !== 'json') {
    throw userError(locale, 'usage.compactJson');
  }

  const query: ParsedUsageArgs['query'] = { period: period ?? 'summary' };
  if (days !== undefined) query.days = days;
  if (fromDate !== undefined) query.fromDate = fromDate;
  if (toDate !== undefined) query.toDate = toDate;
  if (sourceValues.length > 0) {
    const sources = parseSources(sourceValues, locale);
    if (sources !== undefined) query.sources = sources;
  }
  if (model !== undefined) query.model = model;
  if (project !== undefined) query.project = project;

  return {
    query,
    format: format ?? 'text',
    ...(compact ? { compact: true } : {}),
    dataDir,
    help: false,
    ...(lang ? { lang } : {}),
  };
}
