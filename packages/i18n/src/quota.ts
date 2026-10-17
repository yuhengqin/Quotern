import type { SupportedLocale } from './locale.js';

/** Only fixed product copy is translated. Provider and model names remain source data. */
const COPY = {
  'zh-CN': {
    hourLimit: (count: number) => `${count} 小时限额`,
    dayLimit: (count: number) => count === 1 ? '日限额' : count === 7 ? '周限额' : `${count} 天限额`,
    monthLimit: '月限额', billingLimit: '周期额度', genericLimit: '额度',
    cursorModels: 'Cursor模型额度', otherModels: '其他模型额度', opusModel: 'Opus 模型',
    subscription: '订阅额度', balance: 'CNY 余额', balanceUnknown: '余额未知',
    chat: '聊天', chatMessages: '聊天消息', completions: '代码补全',
    chatCompletions: '聊天与代码补全', premium: '高级请求',
    unlimited: '无限', exhausted: '已用尽',
    paceNormal: '节奏正常', paceSlow: '使用较慢', paceFast: '使用偏快',
    paceBasis: { uniform: '当前周期进度', workdays: '工作日安排', automatic: '历史使用习惯' },
    paceDescription: (used: number, expected: number, basis: string) => `当前已用 ${used}%，按${basis}预计使用 ${expected}%。`,
  },
  en: {
    hourLimit: (count: number) => `${count}-hour limit`,
    dayLimit: (count: number) => count === 1 ? 'Daily limit' : count === 7 ? 'Weekly limit' : `${count}-day limit`,
    monthLimit: 'Monthly limit', billingLimit: 'Billing cycle limit', genericLimit: 'Quota',
    cursorModels: 'Cursor model quota', otherModels: 'Other model quota', opusModel: 'Opus model',
    subscription: 'Subscription quota', balance: 'CNY balance', balanceUnknown: 'Balance unavailable',
    chat: 'Chat', chatMessages: 'Chat messages', completions: 'Code completions',
    chatCompletions: 'Chat and code completions', premium: 'Premium requests',
    unlimited: 'Unlimited', exhausted: 'Exhausted',
    paceNormal: 'On pace', paceSlow: 'Using more slowly', paceFast: 'Using faster',
    paceBasis: { uniform: 'current cycle progress', workdays: 'workday schedule', automatic: 'past usage' },
    paceDescription: (used: number, expected: number, basis: string) => `${used}% used; ${expected}% expected based on ${basis}.`,
  },
  ja: {
    hourLimit: (count: number) => `${count} 時間の上限`,
    dayLimit: (count: number) => count === 1 ? '1 日の上限' : count === 7 ? '週間上限' : `${count} 日の上限`,
    monthLimit: '月間上限', billingLimit: '請求期間の上限', genericLimit: '利用枠',
    cursorModels: 'Cursor モデルの利用枠', otherModels: 'その他のモデルの利用枠', opusModel: 'Opus モデル',
    subscription: 'サブスクリプションの利用枠', balance: 'CNY 残高', balanceUnknown: '残高不明',
    chat: 'チャット', chatMessages: 'チャットメッセージ', completions: 'コード補完',
    chatCompletions: 'チャットとコード補完', premium: 'プレミアムリクエスト',
    unlimited: '無制限', exhausted: '使い切りました',
    paceNormal: '通常のペース', paceSlow: '使用ペースが遅い', paceFast: '使用ペースが速い',
    paceBasis: { uniform: '現在の期間の進捗', workdays: '稼働日の予定', automatic: '過去の利用状況' },
    paceDescription: (used: number, expected: number, basis: string) => `現在 ${used}% 使用。${basis}に基づく予想使用量は ${expected}% です。`,
  },
  ko: {
    hourLimit: (count: number) => `${count}시간 한도`,
    dayLimit: (count: number) => count === 1 ? '일일 한도' : count === 7 ? '주간 한도' : `${count}일 한도`,
    monthLimit: '월간 한도', billingLimit: '청구 주기 한도', genericLimit: '한도',
    cursorModels: 'Cursor 모델 한도', otherModels: '기타 모델 한도', opusModel: 'Opus 모델',
    subscription: '구독 한도', balance: 'CNY 잔액', balanceUnknown: '잔액 확인 불가',
    chat: '채팅', chatMessages: '채팅 메시지', completions: '코드 자동 완성',
    chatCompletions: '채팅 및 코드 자동 완성', premium: '프리미엄 요청',
    unlimited: '무제한', exhausted: '모두 사용함',
    paceNormal: '정상 속도', paceSlow: '사용 속도가 느림', paceFast: '사용 속도가 빠름',
    paceBasis: { uniform: '현재 주기 진행률', workdays: '근무일 일정', automatic: '과거 사용 패턴' },
    paceDescription: (used: number, expected: number, basis: string) => `현재 ${used}% 사용, ${basis} 기준 예상 사용량은 ${expected}%입니다.`,
  },
} satisfies Record<SupportedLocale, {
  hourLimit: (count: number) => string;
  dayLimit: (count: number) => string;
  monthLimit: string; billingLimit: string; genericLimit: string;
  cursorModels: string; otherModels: string; opusModel: string;
  subscription: string; balance: string; balanceUnknown: string;
  chat: string; chatMessages: string; completions: string; chatCompletions: string; premium: string;
  unlimited: string; exhausted: string;
  paceNormal: string; paceSlow: string; paceFast: string;
  paceBasis: Record<'uniform' | 'workdays' | 'automatic', string>;
  paceDescription: (used: number, expected: number, basis: string) => string;
}>;

interface WindowLabelSource {
  id: string;
  label: string;
  groupLabel?: string;
  periodSeconds?: number | null;
  durationSeconds?: number | null;
}

function periodLabel(locale: SupportedLocale, window: WindowLabelSource): string | null {
  const copy = COPY[locale];
  const label = window.label;
  const duration = window.periodSeconds ?? window.durationSeconds;
  const hours = /^([\d.]+)\s*h$/i.exec(label) ?? /^(\d+(?:\.\d+)?)\s*小时额度$/.exec(label);
  const days = /^([\d.]+)\s*d$/i.exec(label);
  if (hours) return copy.hourLimit(Number(hours[1]));
  if (days) return copy.dayLimit(Number(days[1]));
  if (['monthly', 'limit_month_total'].includes(window.id) || ['月限额', '月度额度', '月度共享额度'].includes(label)) return copy.monthLimit;
  if (['weekly', 'seven-day', 'limit_7d'].includes(window.id) && duration === 604800) return copy.dayLimit(7);
  if (['daily', '每日额度', '日限额'].includes(window.id) || ['每日额度', '日限额'].includes(label)) return copy.dayLimit(1);
  if (window.id === 'billing' && label === '周期') return copy.billingLimit;
  if (label === '额度' && window.id !== 'subscription') return copy.genericLimit;
  return null;
}

export function localizeQuotaWindowLabel(locale: SupportedLocale, providerId: string, window: WindowLabelSource): string {
  const copy = COPY[locale];
  let label = providerId === 'cursor' && ['Cursor', 'Cursor Models'].includes(window.label) ? copy.cursorModels
    : providerId === 'cursor' && ['Other', 'Other Models'].includes(window.label) ? copy.otherModels
      : window.id === 'subscription' && window.label === '订阅额度' ? copy.subscription
        : providerId === 'deepseek' && window.label === 'CNY 余额' ? copy.balance
          : periodLabel(locale, window) ?? window.label;
  if (window.label === 'Opus 周限额') label = `${copy.opusModel} ${copy.dayLimit(7)}`;
  if (/^opus$/i.test(window.groupLabel ?? '')) return `${copy.opusModel} ${label}`;
  return [window.groupLabel, label].filter(Boolean).join(' ');
}

interface DetailSource { id: string; label: string; text: string; valueKind?: 'unlimited' | 'exhausted' }
export function localizeQuotaDetail(locale: SupportedLocale, detail: DetailSource): { label: string; text: string } {
  const copy = COPY[locale];
  const labels: Record<string, string> = {
    'chat-completions': copy.chatCompletions,
    chat: detail.label === '聊天消息' ? copy.chatMessages : copy.chat,
    completions: copy.completions,
    premium_interactions: copy.premium,
  };
  return { label: labels[detail.id] ?? detail.label,
    text: detail.valueKind === 'unlimited' ? copy.unlimited : detail.valueKind === 'exhausted' ? copy.exhausted : detail.text };
}

export function localizeQuotaValueText(locale: SupportedLocale, value: string): string {
  return value === '余额未知' ? COPY[locale].balanceUnknown : value;
}

interface PaceSource { paceDifference: number | null; paceBasis: 'uniform' | 'workdays' | 'automatic' }
export function localizeQuotaPaceLabel(locale: SupportedLocale, analysis: PaceSource): string | null {
  const pace = analysis.paceDifference;
  const copy = COPY[locale];
  return pace === null ? null : pace === 0 ? copy.paceNormal : pace > 0 ? copy.paceSlow : copy.paceFast;
}
export function localizeQuotaPaceDescription(locale: SupportedLocale, window: { usedPercent: number }, analysis: PaceSource): string | null {
  if (analysis.paceDifference === null) return null;
  const expected = Math.max(0, Math.min(100, Math.round(window.usedPercent + analysis.paceDifference)));
  return COPY[locale].paceDescription(Math.round(window.usedPercent), expected, COPY[locale].paceBasis[analysis.paceBasis]);
}
