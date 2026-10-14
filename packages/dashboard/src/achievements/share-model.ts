import type { AchievementFamily, AchievementSnapshot, EarnedAchievement } from 'quotern-core/achievements';
import { formatAchievementAmount, achievementUnit, achievementDisplayName, achievementScopeLabel, distinctFamilyBadges } from './view-model.ts';
import { sourceLabel } from '../lib/tokens.ts';
export type AchievementShareSelection = { kind: 'single'; id: string } | { kind: 'showcase' } | { kind: 'annual'; year: number };
export interface SharedAchievementBadge { family: AchievementFamily; title: string; subtitle: string; tier: number; date: string | null; scopeLabel?: string }
export interface AchievementSharePayload { title: string; subtitle: string; badges: SharedAchievementBadge[]; stats: Array<{ label: string; value: string }>; range: string | null; note: string }

/** Only this allow-listed projection is rendered inside the export node. */
export function buildAchievementShare(snapshot: AchievementSnapshot, selection: AchievementShareSelection, privacy = { showCost: false, showProjects: false }): AchievementSharePayload {
  const publicBadge = (item: EarnedAchievement): SharedAchievementBadge => {
    const hiddenCost = item.family === 'cost' && !privacy.showCost;
    const scopeLabel = (item.privateScope || item.family === 'project') && !privacy.showProjects ? undefined : achievementScopeLabel(item) ?? undefined;
    return {
      family: item.family, title: hiddenCost ? '算力足迹' : achievementDisplayName(item, privacy.showProjects),
      subtitle: hiddenCost ? '费用已隐藏' : formatAchievementAmount(item.snapshot.value, item.unit) + ' ' + achievementUnit(item),
      tier: hiddenCost ? 1 : item.tier, date: item.achievedOn,
      ...(scopeLabel ? { scopeLabel } : {}),
    };
  };
  const note = '基于已采集记录 · ' + snapshot.coverage.timeZone;
  if (selection.kind === 'annual') {
    const annual = snapshot.annual.find(item => item.year === selection.year);
    if (!annual || annual.activeDays === 0) throw new Error('这一年还没有可分享的足迹');
    return {
      title: annual.year + ' 年度足迹', subtitle: annual.complete ? '这一年，与 AI 一起走过' : '今年的故事，还在继续',
      badges: distinctFamilyBadges(snapshot.earned.filter(item => item.achievedOn?.startsWith(String(annual.year)))).map(item => ({
        ...publicBadge(item), subtitle: item.family === 'cost' && !privacy.showCost ? '费用已隐藏' : item.achievedOn + ' 点亮',
      })),
      stats: [
        { label: '活跃日', value: String(annual.activeDays) }, { label: '活跃月份', value: String(annual.activeMonths) },
        { label: 'Token', value: formatAchievementAmount(annual.tokens, 'Token') },
        ...(annual.topSource ? [{ label: '常用 Agent', value: sourceLabel(annual.topSource) }] : []),
        ...(privacy.showCost ? [{ label: '预估费用', value: '$' + annual.costUsd.toFixed(2) }] : []),
      ], range: annual.fromDate && annual.toDate ? annual.fromDate + ' — ' + annual.toDate : null, note,
    };
  }
  const ids = selection.kind === 'single' ? [selection.id] : snapshot.preferences.showcaseIds;
  const items = ids.map(id => snapshot.earned.find(item => item.id === id)).filter((item): item is EarnedAchievement => Boolean(item));
  if (!items.length || items.length !== ids.length) throw new Error('请选择已获得的徽章进行分享');
  return {
    title: selection.kind === 'single' ? publicBadge(items[0]!).title : '我的成就展示架',
    subtitle: selection.kind === 'single' ? '把一次同行，留成一枚纪念' : '这些记录，组成了我的 AI 足迹',
    badges: items.slice(0, 3).map(publicBadge),
    stats: selection.kind === 'single' ? [] : [
      { label: '累计活跃', value: snapshot.summary.activeDays + ' 天' },
      { label: '最长连续', value: snapshot.summary.longestStreak + ' 天' },
      ...(privacy.showCost ? [{ label: '预估费用', value: '$' + snapshot.summary.totalCostUsd.toFixed(2) }] : []),
    ], range: null, note,
  };
}
