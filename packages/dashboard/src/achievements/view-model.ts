import { ACHIEVEMENT_FAMILIES } from 'quotern-core/achievements';
import type { AchievementCategory, AchievementFamily, AchievementProgress, AchievementRecord, AchievementSnapshot, EarnedAchievement } from 'quotern-core/achievements';
import { translate, type SupportedLocale } from 'quotern-i18n';
import { sourceLabel } from '../lib/tokens.ts';
import { formatCompactTokenCount } from '../lib/utils.ts';
import { formatUsd } from '../lib/format.ts';
export interface AchievementRecordGroup { id: string; family: AchievementProgress['family']; items: AchievementProgress[]; featured: AchievementProgress; next: AchievementProgress | null; earnedCount: number }
export interface AchievementGroup extends AchievementRecordGroup { records: AchievementRecordGroup[]; earnedObjectCount: number }

const closestFirst = (a: AchievementProgress, b: AchievementProgress) => Math.min(1, b.value / b.target) - Math.min(1, a.value / a.target) || a.id.localeCompare(b.id);
export function isCurrentAchievement(item: AchievementProgress, asOfDate: string): boolean {
  return !item.period || item.period >= asOfDate.slice(0, item.period.length);
}
export function achievementPeriodState(item: AchievementProgress, asOfDate: string): 'current' | 'expired' | 'unattainable' {
  if (item.eligible) return 'current';
  if (!isCurrentAchievement(item, asOfDate)) return 'expired';
  if (item.period === asOfDate.slice(0, 7) && ['monthly-full', 'monthly-active'].includes(item.family)) {
    if (item.periodAttainable === false) return 'unattainable';
    // Older runtimes do not say whether today was active. Exclude only definitely impossible goals.
    const [year, month, day] = asOfDate.split('-').map(Number);
    const remaining = new Date(Date.UTC(year!, month!, 0)).getUTCDate() - day! + 1;
    if (item.periodAttainable === undefined && item.value + remaining < item.target) return 'unattainable';
  }
  return 'current';
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
export function achievementFamilyLabel(family: AchievementFamily, locale: SupportedLocale = 'zh-CN'): string {
  return translate(locale, `achievement.family.${family}`);
}
export function achievementCategoryLabel(category: AchievementCategory, locale: SupportedLocale = 'zh-CN'): string {
  return translate(locale, `achievement.category.${category}`);
}

type NamedAchievement = Pick<AchievementProgress, 'id' | 'family' | 'title' | 'tier' | 'target' | 'period'>;
function knownBadgeKey(item: NamedAchievement): string | null {
  const { family, id, target, period, tier } = item;
  if (family === 'first') return id === 'first-record' ? 'first.1' : null;
  if (family === 'monthly-full' || family === 'monthly-active') return period && id === `${family}-${period}` ? family : null;
  if (family === 'annual') return period && id === `annual-${period}` ? 'annual' : null;
  if (family === 'records') return id === 'record-longest-streak' || id === 'record-most-active-month' ? `records.${id.slice(7)}` : null;
  if (family === 'agent-loyalty' || family === 'project') return id.startsWith(`${family}-`) && id.endsWith(`-${target}`) && [30, 100].includes(target) ? `${family}.${tier}` : null;
  return id === `${family}-${target}` ? `${family}.${tier}` : null;
}
export function achievementTitle(item: NamedAchievement, locale: SupportedLocale = 'zh-CN'): string {
  const key = knownBadgeKey(item);
  if (!key) return item.title;
  const period = item.period && item.family.startsWith('monthly-') ? formatAchievementMonth(item.period, locale) : item.period;
  return translate(locale, `achievement.badge.${key}.title`, { period, year: item.period });
}
export function achievementDescription(item: Pick<AchievementProgress, 'id' | 'family' | 'title' | 'tier' | 'target' | 'period' | 'description'>, locale: SupportedLocale = 'zh-CN'): string {
  return knownBadgeKey(item) ? translate(locale, `achievement.description.${item.family}`, { target: item.target }) : item.description;
}
export function achievementRecordLabel(record: Pick<AchievementRecord, 'id' | 'title'>, locale: SupportedLocale = 'zh-CN'): string {
  return translate(locale, `achievement.badge.records.${record.id}.title`);
}
export function achievementDisplayName(item: Pick<AchievementProgress, 'id' | 'title' | 'family' | 'tier' | 'target' | 'period' | 'scope' | 'scopeLabel' | 'privateScope'>, showProjects = true, locale: SupportedLocale = 'zh-CN'): string {
  const scope = (item.privateScope || item.family === 'project') && !showProjects ? null : achievementScopeLabel(item);
  const title = achievementTitle(item, locale);
  return scope && ['agent-loyalty', 'project'].includes(item.family) ? translate(locale, 'achievement.scopedName', { title, scope }) : title;
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
    const candidates = members.map(record => record.next).filter((item): item is AchievementProgress => Boolean(item && achievementPeriodState(item, snapshot.coverage?.asOfDate ?? '0000-00-00') === 'current')).sort(closestFirst);
    const featured = owned[0] ?? candidates[0] ?? members[0]!.featured;
    return [{ id: meta.id, family: meta.id, items, records: members, featured, next: candidates[0] ?? null, earnedCount: owned.length, earnedObjectCount: members.filter(record => record.earnedCount > 0).length }];
  });
}

export function closestAchievements(snapshot: AchievementSnapshot): AchievementProgress[] {
  return groupAchievements(snapshot).map(group => group.next ?? (!group.featured.eligible ? group.featured : null))
    .filter((item): item is AchievementProgress => Boolean(item && item.value > 0 && !['cost', 'duration', 'annual', 'records'].includes(item.family) && achievementPeriodState(item, snapshot.coverage.asOfDate) === 'current'))
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
export function achievementGroupSummary(group: AchievementGroup, locale: SupportedLocale = 'zh-CN'): string {
  if (group.family === 'agent-loyalty') return translate(locale, group.earnedObjectCount ? 'achievement.group.agentOwned' : 'achievement.group.agentEmpty', { count: group.earnedObjectCount });
  if (group.family === 'project') return translate(locale, group.earnedObjectCount ? 'achievement.group.projectOwned' : 'achievement.group.projectEmpty', { count: group.earnedObjectCount });
  if (group.family.startsWith('monthly-')) return translate(locale, 'achievement.group.months', { count: group.earnedCount });
  if (group.family === 'annual') return translate(locale, 'achievement.group.years', { count: group.earnedCount });
  if (group.family === 'records') return translate(locale, 'achievement.group.records', { count: group.earnedCount });
  return translate(locale, 'achievement.group.levels', { count: group.earnedCount });
}
export function formatAchievementDate(value: string, locale: SupportedLocale = 'zh-CN'): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date);
}
export function formatAchievementMonth(value: string, locale: SupportedLocale = 'zh-CN'): string {
  const date = new Date(`${value}-01T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', timeZone: 'UTC' }).format(date);
}
export function formatAchievementAmount(value: number, family: AchievementFamily, locale: SupportedLocale = 'zh-CN'): string {
  if (family === 'cost') return formatUsd(value, locale);
  if (family === 'duration') return (value / 3600).toLocaleString(locale, { maximumFractionDigits: 1 });
  if (family === 'tokens') return formatCompactTokenCount(value, undefined, locale);
  return value.toLocaleString(locale, { maximumFractionDigits: 0 });
}
export function achievementUnit(item: Pick<AchievementProgress, 'family' | 'unit'>, locale: SupportedLocale = 'zh-CN'): string {
  const key = ['active-days', 'streak', 'monthly-full', 'monthly-active', 'agent-loyalty', 'project', 'records'].includes(item.family) ? 'days' : item.family;
  return translate(locale, `achievement.unit.${key}`);
}
export function achievementProgressText(item: AchievementProgress, locale: SupportedLocale = 'zh-CN'): string {
  return translate(locale, 'achievement.progress', { value: formatAchievementAmount(item.value, item.family, locale), target: formatAchievementAmount(item.target, item.family, locale), unit: achievementUnit(item, locale) });
}
