import { resolveSyncSource } from './args.js';

export type UsagePeriod =
  | 'summary'
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
}

const PERIODS: readonly UsagePeriod[] = [
  'summary',
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
      throw new Error(`${option} 缺少参数值`);
    }
    value = next;
    nextIndex += 1;
  }

  if (!value.trim()) {
    throw new Error(`${option} 参数不能为空`);
  }

  return { value, nextIndex };
}

function validateDays(raw: string): number {
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    throw new Error(`--days 必须是 1 到 3660 之间的整数: ${raw}`);
  }
  const days = Number(value);
  if (!Number.isSafeInteger(days) || days < 1 || days > 3660) {
    throw new Error(`--days 必须是 1 到 3660 之间的整数: ${raw}`);
  }
  return days;
}

function validateDate(option: '--from' | '--to', raw: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`${option} 日期必须使用真实的 YYYY-MM-DD 日期: ${raw}`);
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== raw) {
    throw new Error(`${option} 日期必须使用真实的 YYYY-MM-DD 日期: ${raw}`);
  }
  return raw;
}

function parseSources(rawValues: string[]): string[] | undefined {
  const tokens = rawValues.flatMap((raw) => raw.split(',').map((item) => item.trim()));
  if (tokens.some((item) => item.length === 0)) {
    throw new Error('--source 参数不能为空，多个数据源请用逗号分隔');
  }

  let includesAll = false;
  const sources: string[] = [];
  for (const token of tokens) {
    const source = resolveSyncSource(token);
    if (source === undefined) {
      includesAll = true;
    } else if (!sources.includes(source)) {
      sources.push(source);
    }
  }

  if (includesAll && sources.length > 0) {
    throw new Error('--source 的 all 不能与其他数据源混合');
  }
  return includesAll ? undefined : sources;
}

export function parseUsageArgs(args: string[]): ParsedUsageArgs {
  if (args.includes('--help') || args.includes('-h')) {
    return { query: { period: 'summary' }, format: 'text', dataDir: undefined, help: true };
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
      throw new Error(`${option} 参数重复`);
    }
    seenOptions.add(option);
  };

  const setFormat = (next: UsageFormat, option: string): void => {
    if (format !== undefined) {
      if (format !== next) {
        throw new Error(`格式参数互相冲突: ${format} 与 ${next}`);
      }
      throw new Error(`${option} 参数重复`);
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
      const { value, nextIndex } = readOptionValue(args, index, option);
      index = nextIndex;

      switch (option) {
        case '--days':
          days = validateDays(value);
          break;
        case '--from':
          fromDate = validateDate('--from', value);
          break;
        case '--to':
          toDate = validateDate('--to', value);
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
            throw new Error(`--format 仅支持 text、json 或 csv: ${value}`);
          }
          setFormat(value, option);
          break;
      }
      continue;
    }

    if (token.startsWith('-')) {
      throw new Error(`未知参数: ${token}`);
    }
    if (period !== undefined) {
      throw new Error(`多余的位置参数: ${token}`);
    }
    if (!PERIODS.includes(token as UsagePeriod)) {
      throw new Error(`未知 usage 周期: ${token}；可用值: ${PERIODS.join(' | ')}`);
    }
    period = token as UsagePeriod;
  }

  if ((fromDate === undefined) !== (toDate === undefined)) {
    throw new Error('--from 和 --to 必须同时提供');
  }
  if (fromDate !== undefined && toDate !== undefined && fromDate > toDate) {
    throw new Error('--from 不能晚于 --to');
  }
  if (fromDate !== undefined && days !== undefined) {
    throw new Error('--from/--to 日期范围不能与显式 --days 同时使用');
  }
  if (compact && format !== 'json') {
    throw new Error('--compact 仅支持 JSON 输出，请同时指定 --format json 或 --json');
  }

  const query: ParsedUsageArgs['query'] = { period: period ?? 'summary' };
  if (days !== undefined) query.days = days;
  if (fromDate !== undefined) query.fromDate = fromDate;
  if (toDate !== undefined) query.toDate = toDate;
  if (sourceValues.length > 0) {
    const sources = parseSources(sourceValues);
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
  };
}
