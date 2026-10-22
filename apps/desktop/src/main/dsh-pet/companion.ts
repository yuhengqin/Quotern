import type { PetState } from '../../shared/pet.js';
import type { QuotaState } from '../../shared/quota.js';

export interface DshPetCompanion {
  connected: boolean;
  syncing: boolean;
  hoverText: string;
  quips: string[];
  labels?: { sync: string; settings: string; failed: string };
}

const messages = {
  'zh-CN': ['今日', '参考费用', '近 7 天', '近 30 天', '连续活跃', '天', '最常用模型', '会话', '用量暂不可用', '正在同步用量…', '已用', '立即同步', '宠物设置', '操作失败，请稍后重试', '你好呀，摸摸大肥鱼！', '休息一下，再继续出发。', '个其他额度窗口'],
  en: ['Today', 'Reference cost', 'Last 7 days', 'Last 30 days', 'Active streak', 'days', 'Top model', 'Sessions', 'Usage unavailable', 'Syncing usage…', 'used', 'Sync now', 'Pet settings', 'Action failed. Try again.', 'Hello! Give me a pat.', 'Take a little break.', 'more quota windows'],
  ja: ['今日', '参考費用', '過去7日', '過去30日', '連続利用', '日', '最多モデル', 'セッション', '使用量を取得できません', '使用量を同期中…', '使用済み', '今すぐ同期', 'ペット設定', '操作に失敗しました。再試行してください', 'こんにちは！なでてね。', 'ちょっと休憩しよう。', '件の他の利用枠'],
  ko: ['오늘', '참고 비용', '최근 7일', '최근 30일', '연속 활동', '일', '주요 모델', '세션', '사용량을 불러올 수 없어요', '사용량 동기화 중…', '사용', '지금 동기화', '펫 설정', '실패했어요. 다시 시도해 주세요', '안녕! 쓰다듬어 주세요.', '잠깐 쉬어 가요.', '개의 추가 한도'],
} as const;

/** Consume the existing collector snapshot. No new collector, model client or quota request. */
export function buildDshPetCompanion(state: Pick<PetState, 'stats' | 'connected' | 'syncing' | 'locale'> | null | undefined, quota: QuotaState | null): DshPetCompanion {
  const locale = state?.locale ?? 'zh-CN';
  const key = locale.startsWith('en') ? 'en' : locale.startsWith('ja') ? 'ja' : locale.startsWith('ko') ? 'ko' : 'zh-CN';
  const m = messages[key], labels = { sync: m[11], settings: m[12], failed: m[13] };
  const syncing = state?.syncing === true;
  if (!state?.connected) return { connected: false, syncing, hoverText: m[8], quips: [m[8]], labels };
  const number = (n: number) => new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
  const s = state.stats;
  const tokens = `${m[0]} ${number(s.todayTokens)} tokens`;
  // This aggregate includes estimates; never describe it as a bill or account balance.
  const cost = `${m[1]} USD $${s.todayCostUsd.toFixed(2)}`;
  const limits = (quota?.providers ?? []).filter(provider => provider.status === 'ready' && !provider.stale)
    .flatMap(provider => provider.windows.filter(window => window.analysisEligible !== false && Number.isFinite(window.usedPercent))
      .map(window => `${provider.label} · ${[window.groupLabel, window.label].filter(Boolean).join(' ')} ${m[10]} ${Math.round(window.usedPercent)}%`));
  const quips = [tokens, cost, `${m[2]} ${number(s.last7dTokens)} tokens`, `${m[3]} ${number(s.last30dTokens)} tokens`];
  if (s.streakDays > 0) quips.push(`${m[4]} ${s.streakDays} ${m[5]}`);
  if (s.topModels[0]) quips.push(`${m[6]} ${s.topModels[0].name}`);
  // PetStats currently uses zero for both empty and incomplete session coverage.
  if (s.conversations > 0) quips.push(`${m[7]} ${s.conversations}`);
  quips.push(...limits, m[14], m[15]);
  const hoverLimits = limits.slice(0, 3);
  if (limits.length > 3) hoverLimits.push(`+${limits.length - 3} ${m[16]}`);
  return { connected: true, syncing, hoverText: [syncing ? m[9] : '', tokens, cost, ...hoverLimits].filter(Boolean).join('\n'), quips, labels };
}
