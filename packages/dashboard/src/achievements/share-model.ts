import type { AchievementFamily, AchievementSnapshot, EarnedAchievement } from 'quotern-core/achievements';
import { translate, type SupportedLocale } from 'quotern-i18n';
import { formatAchievementAmount, formatAchievementDate, achievementUnit, achievementDisplayName, achievementScopeLabel, distinctFamilyBadges } from './view-model.ts';
import { sourceLabel } from '../lib/tokens.ts';
export type AchievementShareSelection = { kind: 'single'; id: string } | { kind: 'showcase' } | { kind: 'annual'; year: number };
export interface SharedAchievementBadge { family: AchievementFamily; title: string; subtitle: string; tier: number; date: string | null; scopeLabel?: string }
export interface AchievementSharePayload { title: string; subtitle: string; badges: SharedAchievementBadge[]; stats: Array<{ label: string; value: string }>; range: string | null; note: string }

/** Only this allow-listed projection is rendered inside the export node. */
export function buildAchievementShare(snapshot: AchievementSnapshot, selection: AchievementShareSelection, privacy = { showCost: false, showProjects: false }, locale: SupportedLocale = 'zh-CN'): AchievementSharePayload {
  const publicBadge = (item: EarnedAchievement): SharedAchievementBadge => {
    const hiddenCost = item.family === 'cost' && !privacy.showCost;
    const scopeLabel = (item.privateScope || item.family === 'project') && !privacy.showProjects ? undefined : achievementScopeLabel(item) ?? undefined;
    return {
      family: item.family, title: hiddenCost ? translate(locale, 'achievement.family.cost') : achievementDisplayName(item, privacy.showProjects, locale),
      subtitle: hiddenCost ? translate(locale, 'achievement.share.costHidden') : translate(locale, 'achievement.share.badgeAmount', { amount: formatAchievementAmount(item.snapshot.value, item.family, locale), unit: achievementUnit(item, locale) }),
      tier: hiddenCost ? 1 : item.tier, date: item.achievedOn ? formatAchievementDate(item.achievedOn, locale) : null,
      ...(scopeLabel ? { scopeLabel } : {}),
    };
  };
  const note = translate(locale, 'achievement.share.coverageNote', { timeZone: snapshot.coverage.timeZone });
  if (selection.kind === 'annual') {
    const annual = snapshot.annual.find(item => item.year === selection.year);
    if (!annual || annual.activeDays === 0) throw new Error(translate(locale, 'achievement.share.noAnnualFootprint'));
    return {
      title: translate(locale, 'achievement.badge.annual.title', { year: annual.year }), subtitle: translate(locale, annual.complete ? 'achievement.share.annualComplete' : 'achievement.share.annualCurrent'),
      badges: distinctFamilyBadges(snapshot.earned.filter(item => item.achievedOn?.startsWith(String(annual.year)))).map(item => ({
        ...publicBadge(item), subtitle: item.family === 'cost' && !privacy.showCost ? translate(locale, 'achievement.share.costHidden') : translate(locale, 'achievement.share.earnedOn', { date: item.achievedOn ? formatAchievementDate(item.achievedOn, locale) : '' }),
      })),
      stats: [
        { label: translate(locale, 'achievement.share.activeDays'), value: annual.activeDays.toLocaleString(locale) }, { label: translate(locale, 'achievement.share.activeMonths'), value: annual.activeMonths.toLocaleString(locale) },
        { label: 'Token', value: formatAchievementAmount(annual.tokens, 'tokens', locale) },
        ...(annual.topSource ? [{ label: translate(locale, 'achievement.share.topAgent'), value: sourceLabel(annual.topSource) }] : []),
        ...(privacy.showCost ? [{ label: translate(locale, 'achievement.share.estimatedCost'), value: formatAchievementAmount(annual.costUsd, 'cost', locale) }] : []),
      ], range: annual.fromDate && annual.toDate ? formatAchievementDate(annual.fromDate, locale) + ' — ' + formatAchievementDate(annual.toDate, locale) : null, note,
    };
  }
  const ids = selection.kind === 'single' ? [selection.id] : snapshot.preferences.showcaseIds;
  const items = ids.map(id => snapshot.earned.find(item => item.id === id)).filter((item): item is EarnedAchievement => Boolean(item));
  if (!items.length || items.length !== ids.length) throw new Error(translate(locale, 'achievement.share.selectEarned'));
  return {
    title: selection.kind === 'single' ? publicBadge(items[0]!).title : translate(locale, 'achievement.share.shelfTitle'),
    subtitle: translate(locale, selection.kind === 'single' ? 'achievement.share.singleSubtitle' : 'achievement.share.shelfSubtitle'),
    badges: items.slice(0, 3).map(publicBadge),
    stats: selection.kind === 'single' ? [] : [
      { label: translate(locale, 'achievement.share.totalActive'), value: translate(locale, 'achievement.share.daysValue', { count: snapshot.summary.activeDays }) },
      { label: translate(locale, 'achievement.share.longestStreak'), value: translate(locale, 'achievement.share.daysValue', { count: snapshot.summary.longestStreak }) },
      ...(privacy.showCost ? [{ label: translate(locale, 'achievement.share.estimatedCost'), value: formatAchievementAmount(snapshot.summary.totalCostUsd, 'cost', locale) }] : []),
    ], range: null, note,
  };
}
