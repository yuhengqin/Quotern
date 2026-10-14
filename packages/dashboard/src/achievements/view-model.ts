import { ACHIEVEMENT_FAMILIES } from 'quotern-core/achievements';
import type { AchievementProgress, AchievementSnapshot } from 'quotern-core/achievements';
export interface AchievementGroup { id: string; family: AchievementProgress['family']; items: AchievementProgress[]; featured: AchievementProgress; next: AchievementProgress | null; earnedCount: number }

export function groupAchievements(snapshot: Pick<AchievementSnapshot, 'progress'>): AchievementGroup[] {
  const groups = new Map<string, AchievementProgress[]>();
  for (const item of snapshot.progress) groups.set(item.groupId, [...(groups.get(item.groupId) ?? []), item]);
  return [...groups].map(([id, items]) => {
    items.sort((a, b) => a.tier - b.tier || a.target - b.target);
    const owned = items.filter(item => item.eligible), featured = owned.at(-1) ?? items[0]!;
    const next = items.find(item => !item.eligible && item.tier > (owned.at(-1)?.tier ?? 0)) ?? null;
    return { id, family: featured.family, items, featured, next, earnedCount: owned.length };
  }).sort((a, b) => {
    const family = ACHIEVEMENT_FAMILIES.findIndex(item => item.id === a.family) - ACHIEVEMENT_FAMILIES.findIndex(item => item.id === b.family);
    return family || (b.featured.period ?? '').localeCompare(a.featured.period ?? '') || b.featured.value - a.featured.value || a.id.localeCompare(b.id);
  });
}

export function closestAchievements(snapshot: AchievementSnapshot): AchievementProgress[] {
  return groupAchievements(snapshot).map(group => group.next ?? (!group.featured.eligible ? group.featured : null))
    .filter((item): item is AchievementProgress => Boolean(item && item.value > 0 && !['cost', 'duration', 'annual', 'records'].includes(item.family) && (!item.period || item.period >= snapshot.coverage.asOfDate.slice(0, 7))))
    .sort((a, b) => Math.min(1, b.value / b.target) - Math.min(1, a.value / a.target) || a.id.localeCompare(b.id)).slice(0, 3);
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
