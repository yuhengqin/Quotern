import { translate, type SupportedLocale } from 'quotern-i18n';

const EMPTY_USAGE_MESSAGE = '当前时间范围暂无用量记录';
const RUNTIME_RECOVERING_MESSAGE = '本地服务正在恢复，请稍候';

/** Keep transport error codes in diagnostics, not in user-facing feedback. */
export function usageErrorDescription(message: string, locale: SupportedLocale = 'zh-CN'): string {
  if (message === EMPTY_USAGE_MESSAGE) return translate(locale, 'usage.error.empty');
  if (message === RUNTIME_RECOVERING_MESSAGE || message === 'LOCAL_RUNTIME_NOT_READY') {
    return translate(locale, 'usage.error.recovering');
  }
  if (message.startsWith('INVALID_RANGE_DAYS')) {
    return translate(locale, 'usage.error.invalidRange');
  }
  if (message.startsWith('INVALID_DATE_RANGE')) {
    return translate(locale, 'usage.error.invalidDate');
  }
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return translate(locale, 'usage.error.network');
  }
  return translate(locale, 'usage.error.failed');
}

export function usageErrorTitle(message: string, locale: SupportedLocale = 'zh-CN'): string {
  if (message === EMPTY_USAGE_MESSAGE) return translate(locale, 'usage.error.emptyTitle');
  if (message === RUNTIME_RECOVERING_MESSAGE || message === 'LOCAL_RUNTIME_NOT_READY') {
    return translate(locale, 'usage.error.recovering');
  }
  return translate(locale, 'usage.error.failedTitle');
}
