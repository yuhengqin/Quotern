import { ACHIEVEMENT_FAMILIES } from 'quotern-core/achievements';
import type { AchievementProgress, AchievementSnapshot, EarnedAchievement } from 'quotern-core/achievements';
import { sourceLabel } from '../lib/tokens.ts';
export interface AchievementRecordGroup { id: string; family: AchievementProgress['family']; items: AchievementProgress[]; featured: AchievementProgress; next: AchievementProgress | null; earnedCount: number }
export interface AchievementGroup extends AchievementRecordGroup { records: AchievementRecordGroup[]; earnedObjectCount: number }

const closestFirst = (a: AchievementProgress, b: AchievementProgress) => Math.min(1, b.value / b.target) - Math.min(1, a.value / a.target) || a.id.localeCompare(b.id);
export function isCurrentAchievement(item: AchievementProgress, asOfDate: string): boolean {
  return !item.period || item.period >= asOfDate.slice(0, item.period.length);
}
export function achievementMatchesStatus(item: AchievementProgress, status: string, asOfDate: string): boolean {
  if (status === 'earned') return item.eligible;
  if (status === 'current') return !item.eligible && isCurrentAchievement(item, asOfDate);
  if (status === 'expired') return !item.eligible && !isCurrentAchievement(item, asOfDate);
  return status === 'all';
}
export function achievementScopeLabel(item: Pick<AchievementProgress, 'family' | 'scope' | 'scopeLabel'>): string | null {
  if (item.family === 'agent-loyalty') return item.scope || item.scopeLabel ? sourceLabel(item.scope ?? item.scopeLabel!) : null;
  return item.scopeLabel ?? null;
}
export function achievementDisplayName(item: Pick<AchievementProgress, 'title' | 'family' | 'scope' | 'scopeLabel' | 'privateScope'>, showProjects = true): string {
  const scope = (item.privateScope || item.family === 'project') && !showProjects ? null : achievementScopeLabel(item);
  return item.title + (scope && ['agent-loyalty', 'project'].includes(item.family) ? ' · ' + scope : '');
}

export function groupAchievements(snapshot: Pick<AchievementSnapshot, 'progress'> & Partial<Pick<AchievementSnapshot, 'coverage'>>): AchievementGroup[] {
  const groups = new Map<string, AchievementProgress[]>();
  for (const item of snapshot.progress) groups.set(item.groupId, [...(groups.get(item.groupId) ?? []), item]);
  const records: AchievementRecordGroup[] = [...groups].map(([id, items]) => {
    items.sort((a, b) => a.tier - b.tier || a.target - b.target);
    const owned = items.filter(item => item.eligible), featured = owned.at(-1) ?? items[0]!;
    const next = items.find(item => !item.eligible && item.tier > (owned.at(-1)?.tier ?? 0)) ?? null;
    return { id, family: featured.family, items, featured, next, earnedCount: owned.length };
  });
  return ACHIEVEMENT_FAMILIES.flatMap(meta => {
    const members = records.filter(record => record.family === meta.id).sort((a, b) =>
      (b.featured.period ?? '').localeCompare(a.featured.period ?? '') || Number(b.earnedCount > 0) - Number(a.earnedCount > 0) || b.featured.value - a.featured.value || a.id.localeCompare(b.id));
    if (!members.length) return [];
    const items = members.flatMap(record => record.items), owned = items.filter(item => item.eligible).sort((a, b) => b.tier - a.tier || b.value - a.value || (b.period ?? '').localeCompare(a.period ?? ''));
    const candidates = members.map(record => record.next).filter((item): item is AchievementProgress => Boolean(item && isCurrentAchievement(item, snapshot.coverage?.asOfDate ?? '0000-00-00'))).sort(closestFirst);
    const featured = owned[0] ?? candidates[0] ?? members[0]!.featured;
    return [{ id: meta.id, family: meta.id, items, records: members, featured, next: candidates[0] ?? null, earnedCount: owned.length, earnedObjectCount: members.filter(record => record.earnedCount > 0).length }];
  });
}

export function closestAchievements(snapshot: AchievementSnapshot): AchievementProgress[] {
  return groupAchievements(snapshot).map(group => group.next ?? (!group.featured.eligible ? group.featured : null))
    .filter((item): item is AchievementProgress => Boolean(item && item.value > 0 && !['cost', 'duration', 'annual', 'records'].includes(item.family) && isCurrentAchievement(item, snapshot.coverage.asOfDate)))
    .sort(closestFirst).slice(0, 3);
}
export function distinctFamilyBadges(items: EarnedAchievement[], limit = 3): EarnedAchievement[] {
  const families = new Set<string>();
  return items.filter(item => { if (families.has(item.family)) return false; families.add(item.family); return true; }).slice(0, limit);
}
export function recommendShowcase(snapshot: Pick<AchievementSnapshot, 'earned'>): string[] {
  const items = [...snapshot.earned].sort((a, b) => Number(['cost', 'duration'].includes(a.family)) - Number(['cost', 'duration'].includes(b.family)) || b.tier - a.tier || b.unlockedAt.localeCompare(a.unlockedAt));
  return distinctFamilyBadges(items).map(item => item.id);
}
export function achievementGroupSummary(group: AchievementGroup): string {
  if (group.family === 'agent-loyalty') return group.earnedObjectCount ? '已与 ' + group.earnedObjectCount + ' 个 Agent 达成' : '在每个 Agent 留下自己的同行记录';
  if (group.family === 'project') return group.earnedObjectCount ? '已在 ' + group.earnedObjectCount + ' 个项目达成' : '为持续投入的项目留下纪念';
  if (group.family.startsWith('monthly-')) return '已收藏 ' + group.earnedCount + ' 个月';
  if (group.family === 'annual') return '已收藏 ' + group.earnedCount + ' 个年份';
  if (group.family === 'records') return '已留下 ' + group.earnedCount + ' 项个人纪录';
  return '已点亮 ' + group.earnedCount + ' 个等级';
}
export function formatAchievementAmount(value: number, unit: string): string {
  if (unit === 'USD') return '$' + value.toFixed(2);
  if (unit === '秒') return (value / 3600).toLocaleString('zh-CN', { maximumFractionDigits: 1 });
  if (unit === 'Token') return new Intl.NumberFormat('zh-CN', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
  return value.toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}
export const achievementUnit = (item: Pick<AchievementProgress, 'unit'>) => item.unit === '秒' ? '小时' : item.unit === 'USD' ? '预估费用' : item.unit;
export function achievementProgressText(item: AchievementProgress): string {
  return formatAchievementAmount(item.value, item.unit) + ' / ' + formatAchievementAmount(item.target, item.unit) + ' ' + achievementUnit(item);
}
