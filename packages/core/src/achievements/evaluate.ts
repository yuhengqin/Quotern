import { localDateAndHour } from '../timezone.js';
import { ACHIEVEMENT_FAMILIES } from './catalog.js';
import type { AchievementFacts, AchievementEvaluation, AchievementFamily, AchievementProgress, AchievementRecord, AnnualFootprint } from './types.js';

const shiftDate = (date: string, days: number) => new Date(Date.parse(date + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const monthLength = (month: string) => new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
const familyCategory = (family: AchievementFamily) => ACHIEVEMENT_FAMILIES.find(item => item.id === family)!.category;
const total = <T>(rows: readonly T[], value: (row: T) => number) => rows.reduce((sum, row) => sum + value(row), 0);
function cumulativeDate<T>(rows: readonly T[], target: number, value: (row: T) => number, date: (row: T) => string): string | null {
  let sum = 0;
  for (const row of rows) { sum += value(row); if (sum + 1e-8 >= target) return date(row); }
  return null;
}

/** Facts are calendar-bucketed and deduplicated before entering the rule engine. */
export function evaluateAchievements(facts: AchievementFacts): AchievementEvaluation {
  const progress: AchievementProgress[] = [];
  const days = facts.days.filter(day => day.date <= facts.today).sort((a, b) => a.date.localeCompare(b.date));
  const active = [...new Set(days.filter(day => day.tokens > 0).map(day => day.date))].sort();
  const tokens = total(days, day => day.tokens), cost = total(days, day => day.costUsd);
  const sessions = [...facts.sessions].sort((a, b) => a.firstAt.localeCompare(b.firstAt));
  const spans = [...sessions].sort((a, b) => a.lastAt.localeCompare(b.lastAt));
  const duration = total(sessions, session => session.durationSeconds);
  let longest = 0, currentRun = 0, previous = '', longestOn: string | null = null;
  const streakEnds = new Map<number, string>();
  for (const date of active) {
    currentRun = previous && shiftDate(previous, 1) === date ? currentRun + 1 : 1;
    for (const threshold of [3, 7, 30, 100]) if (currentRun >= threshold && !streakEnds.has(threshold)) streakEnds.set(threshold, date);
    if (currentRun > longest) { longest = currentRun; longestOn = date; }
    previous = date;
  }
  const currentStreak = previous === facts.today || previous === shiftDate(facts.today, -1) ? currentRun : 0;
  const add = (item: Omit<AchievementProgress, 'category' | 'groupId'> & { groupId?: string }) => {
    progress.push({ ...item, category: familyCategory(item.family), groupId: item.groupId ?? item.family });
  };
  const series = (family: AchievementFamily, thresholds: number[], titles: string[], value: number, unit: string, description: string, dateFor: (threshold: number) => string | null) => {
    thresholds.forEach((target, index) => {
      const achievedOn = dateFor(target);
      add({ id: family + '-' + target, family, title: titles[index]!, description, target, value, unit, tier: index + 1, eligible: achievedOn !== null, achievedOn });
    });
  };
  add({ id: 'first-record', family: 'first', title: '初见', description: '记录第一天有效 Agent 用量。', target: 1, value: active.length > 0 ? 1 : 0, unit: '次', tier: 1, eligible: active.length > 0, achievedOn: active[0] ?? null });
  series('tokens', [1e6, 1e7, 1e8, 1e9], ['百万星火', '千万回响', '亿级同行', '十亿星河'], tokens, 'Token', '累计已采集的总 Token，包含输入、输出与缓存等五类明细。', target => cumulativeDate(days, target, d => d.tokens, d => d.date));
  series('cost', [10, 100, 1000], ['算力初印', '百美元算力足迹', '千美元算力足迹'], cost, 'USD', '按当前价格表计算的预估费用（美元），不是实际付款；达成快照永久保留。', target => cumulativeDate(days, target, d => d.costUsd, d => d.date));
  series('sessions', [10, 100, 1000], ['十场对话', '百场对话', '千场对话'], sessions.length, '场', '按 Agent 与会话 ID 去重；有有效逻辑消息即计入。仅覆盖支持的会话来源。', target => sessions[target - 1] ? localDateAndHour(sessions[target - 1]!.firstAt, facts.timeZone).date : null);
  series('duration', [36000, 360000, 3600000], ['十小时同行', '百小时同行', '千小时同行'], duration, '秒', '各会话首末消息跨度之和，包含闲置；并发会话分别累计，不代表人的专注时长。', target => cumulativeDate(spans, target, s => s.durationSeconds, s => localDateAndHour(s.lastAt, facts.timeZone).date));
  series('active-days', [7, 30, 100, 365], ['常来常往', '老朋友', '百日同行', '四季有你'], active.length, '天', '统计自然日内 Token 大于零即活跃；间断使用也可累计。', target => active[target - 1] ?? null);
  series('streak', [3, 7, 30, 100], ['三日启程', '七日同行', '三十日长跑', '百日不断'], longest, '天', '任意连续自然日有有效用量；根据历史最长记录达成，中断不撤回徽章。', target => streakEnds.get(target) ?? null);

  const byMonth = new Map<string, string[]>();
  const bySource = new Map<string, string[]>();
  for (const date of active) {
    const period = date.slice(0, 7);
    byMonth.set(period, [...(byMonth.get(period) ?? []), date]);
  }
  for (const day of days) for (const [source, count] of Object.entries(day.sources)) {
    if (count > 0) bySource.set(source, [...new Set([...(bySource.get(source) ?? []), day.date])].sort());
  }
  for (const period of [...new Set([...byMonth.keys(), facts.today.slice(0, 7)])].sort()) {
    const dates = byMonth.get(period) ?? [], length = monthLength(period), closed = period < facts.today.slice(0, 7);
    const full = closed && dates.length === length;
    add({ id: 'monthly-full-' + period, family: 'monthly-full', groupId: 'monthly-full-' + period, title: period + ' 全勤章', description: '月度肝帝：自然月每一天都有有效用量，月末结束后结算；二月按实际天数计算。', target: length, value: dates.length, unit: '天', tier: 1, eligible: full, achievedOn: full ? period + '-' + length : null, period });
    add({ id: 'monthly-active-' + period, family: 'monthly-active', groupId: 'monthly-active-' + period, title: period + ' 常有你', description: '一个自然月累计活跃 20 天，为自己的使用节奏留下纪念。', target: 20, value: dates.length, unit: '天', tier: 1, eligible: dates.length >= 20, achievedOn: dates[19] ?? null, period });
  }

  const sourceEntries: Array<[string, string[]]> = bySource.size ? [...bySource].sort(([a], [b]) => a.localeCompare(b)) : [['pending', []]];
  for (const [source, dates] of sourceEntries) for (const [index, target] of [30, 100].entries()) {
    add({ id: 'agent-loyalty-' + source + '-' + target, family: 'agent-loyalty', groupId: 'agent-loyalty-' + source, title: target === 30 ? '一路同行' : '百日搭档', description: '同一 Agent 累计活跃 ' + target + ' 个不同自然日。', target, value: dates.length, unit: '天', tier: index + 1, eligible: dates.length >= target, achievedOn: dates[target - 1] ?? null, ...(source !== 'pending' ? { scope: source, scopeLabel: source } : {}) });
  }
  const qualified = [...bySource].filter(([, dates]) => dates.length >= 3).map(([, dates]) => dates[2]!).sort();
  series('multi-agent', [2, 3, 5], ['双栖搭档', '多面手', '五方同行'], qualified.length, '种 Agent', '每一种 Agent 至少在 3 个不同日期有有效用量，才计入探索足迹。', target => qualified[target - 1] ?? null);

  const projects = facts.projects.length ? facts.projects : [{ id: 'pending', label: '', dates: [] }];
  for (const project of projects) for (const [index, target] of [30, 100].entries()) {
    const dates = [...new Set(project.dates)].filter(date => date <= facts.today).sort();
    add({ id: 'project-' + project.id + '-' + target, family: 'project', groupId: 'project-' + project.id, title: target === 30 ? '项目长跑' : '百日共筑', description: '同一项目累计 ' + target + ' 天有逻辑会话消息。依据路径哈希识别，当前覆盖 Claude/Codex，不合并同名目录。', target, value: dates.length, unit: '天', tier: index + 1, eligible: dates.length >= target, achievedOn: dates[target - 1] ?? null, ...(project.id !== 'pending' ? { scope: project.id, scopeLabel: project.label, privateScope: true } : {}) });
  }

  let bestMonth = '', bestMonthDays: string[] = [];
  for (const [month, dates] of [...byMonth].sort(([a], [b]) => a.localeCompare(b))) if (dates.length > bestMonthDays.length) { bestMonth = month; bestMonthDays = dates; }
  const records: AchievementRecord[] = [
    { id: 'longest-streak' as const, title: '最长连续记录', value: longest, unit: '天', achievedOn: longestOn },
    { id: 'most-active-month' as const, title: '单月活跃纪录', value: bestMonthDays.length, unit: '天', achievedOn: bestMonthDays.at(-1) ?? null, ...(bestMonth ? { period: bestMonth } : {}) },
  ];
  for (const record of records) add({ id: 'record-' + record.id, family: 'records', groupId: 'record-' + record.id, title: record.title, description: '保存个人最佳纪录，刷新时更新数值；历史最佳不会因中断丢失。', target: Math.max(1, record.value), value: record.value, unit: '天', tier: 1, eligible: record.value > 0, achievedOn: record.achievedOn, ...(record.period ? { period: record.period } : {}) });

  const year = Number(facts.today.slice(0, 4));
  const years = [...new Set([year, ...days.map(day => Number(day.date.slice(0, 4)))])].sort((a, b) => b - a);
  const annual: AnnualFootprint[] = years.map(yearValue => {
    const rows = days.filter(day => Number(day.date.slice(0, 4)) === yearValue);
    const activeDates = rows.filter(day => day.tokens > 0).map(day => day.date);
    const sourceTokens = new Map<string, number>();
    for (const row of rows) for (const [source, count] of Object.entries(row.sources)) sourceTokens.set(source, (sourceTokens.get(source) ?? 0) + count);
    return { year: yearValue, activeDays: activeDates.length, activeMonths: new Set(activeDates.map(date => date.slice(0, 7))).size, tokens: total(rows, row => row.tokens), costUsd: total(rows, row => row.costUsd), topSource: [...sourceTokens].sort(([a, av], [b, bv]) => bv - av || a.localeCompare(b))[0]?.[0] ?? null, fromDate: activeDates[0] ?? null, toDate: activeDates.at(-1) ?? null, complete: yearValue < year };
  });
  for (const footprint of annual) {
    const eligible = footprint.complete && footprint.activeDays > 0;
    add({ id: 'annual-' + footprint.year, family: 'annual', groupId: 'annual-' + footprint.year, title: footprint.year + ' 年度足迹', description: '收藏这一年与 AI 同行的记录，年末结束后结算；本年度可随时预览分享。', target: 1, value: eligible ? 1 : 0, unit: '年', tier: 1, eligible, achievedOn: eligible ? footprint.year + '-12-31' : null, period: String(footprint.year) });
  }
  return { progress, records, annual, summary: { activeDays: active.length, currentStreak, longestStreak: longest, totalTokens: tokens, totalCostUsd: cost, sessionCount: sessions.length, durationSeconds: duration } };
}
