const EMPTY_USAGE_MESSAGE = '当前时间范围暂无用量记录';
const RUNTIME_RECOVERING_MESSAGE = '本地服务正在恢复，请稍候';

/** Keep transport error codes in diagnostics, not in user-facing feedback. */
export function usageErrorDescription(message: string): string {
  if (message === EMPTY_USAGE_MESSAGE || message === RUNTIME_RECOVERING_MESSAGE) return message;
  if (message.startsWith('INVALID_RANGE_DAYS')) {
    return '所选时间范围无法加载，请重新选择日期或重启 Quotern 后重试。';
  }
  if (message.startsWith('INVALID_DATE_RANGE')) {
    return '日期范围无效，请重新选择开始日期和结束日期。';
  }
  if (message === 'LOCAL_RUNTIME_NOT_READY') return RUNTIME_RECOVERING_MESSAGE;
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return '无法连接数据服务，请检查连接后重试。';
  }
  return '用量数据加载失败，请稍后重试。';
}

export function usageErrorTitle(message: string): string {
  if (message === EMPTY_USAGE_MESSAGE) return '暂无用量数据';
  if (message === RUNTIME_RECOVERING_MESSAGE) return message;
  return '用量数据加载失败';
}
