import { useMemo, useState } from 'react';
import { Button, Label, Spinner, Switch } from '@heroui/react';
import { ArrowUpRight, Award, Check, Flame, Plus, RefreshCw, Share2, Sparkles, Trophy, X } from 'lucide-react';
import { BackToUsageLink } from '../components/BackToUsageLink';
import { ACHIEVEMENT_FAMILIES, ACHIEVEMENT_CATEGORY_LABELS, type AchievementCategory, type AchievementFamily } from 'quotern-core/achievements';
import { normalizeLocale } from 'quotern-i18n';
import { useTranslation } from 'quotern-i18n/react';
import { sourceLabel } from '@/lib/tokens';
import { useAchievements } from './AchievementProvider';
import { BadgeArtwork } from './BadgeArtwork';
import { achievementCategoryLabel, achievementDisplayName, achievementFamilyLabel, achievementGroupSummary, achievementProgressText, achievementRecordLabel, closestAchievements, formatAchievementAmount, formatAchievementDate, formatAchievementMonth, groupAchievements, recommendShowcase, type AchievementGroup } from './view-model';
import './achievements.css';

export function AchievementsPage() {
  const { t, i18n } = useTranslation();
  const locale = normalizeLocale(i18n.language);
  const { snapshot, loading, busy, error, refresh, updatePreferences, openDetails, openFamily, share, readOnly } = useAchievements();
  const [category, setCategory] = useState<AchievementCategory | 'all'>('all');
  const [family, setFamily] = useState<AchievementFamily | 'all'>('all');
  const [status, setStatus] = useState('all'), [editing, setEditing] = useState(false), [year, setYear] = useState<number | null>(null);
  const groups = useMemo(() => snapshot ? groupAchievements(snapshot) : [], [snapshot]);
  const closest = useMemo(() => snapshot ? closestAchievements(snapshot) : [], [snapshot]);
  const shown = groups.filter(group => (category === 'all' || group.featured.category === category) && (family === 'all' || group.family === family)
    && (status === 'all' || status === 'earned' && group.earnedCount > 0 || status === 'progress' && Boolean(group.next)));
  const shelf = snapshot?.preferences.showcaseIds.map(id => snapshot.earned.find(item => item.id === id)).filter(item => item !== undefined) ?? [];
  const annual = snapshot?.annual.find(item => item.year === year) ?? snapshot?.annual[0];
  const toggleShowcase = async (id: string) => {
    if (!snapshot || busy || readOnly) return;
    const current = snapshot.preferences.showcaseIds;
    const next = current.includes(id) ? current.filter(value => value !== id) : [...current, id];
    if (next.length > 3) return;
    await updatePreferences({ showcaseIds: next }).catch(() => undefined);
  };
  return <div className="achievement-page min-w-0 pb-6">
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <BackToUsageLink />
        <div className="flex items-center gap-2"><Award className="text-accent" size={25} aria-hidden="true"/><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t('achievement.page.title')}</h1></div>
        <p className="mt-2 text-sm text-muted">{t('achievement.page.intro')}</p>
      </div>
      <div className="flex items-center gap-3 pt-1 sm:pt-9">
        <Switch aria-label={t('achievement.page.celebrations')} isSelected={snapshot?.preferences.celebrationsEnabled ?? true} isDisabled={readOnly || !snapshot || busy} onChange={selected => void updatePreferences({ celebrationsEnabled: selected }).catch(() => undefined)} size="sm">
          <Switch.Content><Switch.Control><Switch.Thumb/></Switch.Control><Label className="text-xs">{t('achievement.page.celebrations')}</Label></Switch.Content>
        </Switch>
        <Button aria-label={t('achievement.page.refresh')} isIconOnly size="sm" variant="tertiary" isDisabled={loading} onPress={() => void refresh()}><RefreshCw size={15}/></Button>
      </div>
    </header>

    {error && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm"><p>{error}</p><Button size="sm" variant="secondary" onPress={() => void refresh()}>{t('achievement.page.retry')}</Button></div>}
    {loading && !snapshot && <div className="flex min-h-80 items-center justify-center gap-3 text-sm text-muted" role="status"><Spinner size="sm"/>{t('achievement.page.loading')}</div>}
    {snapshot && <>
      <section aria-label={t('achievement.page.shelfAria')} className="achievement-shelf relative overflow-hidden rounded-3xl p-5 text-white sm:p-8">
        <div aria-hidden="true" className="achievement-orbit"/>
        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div className="max-w-sm">
            <p className="text-[10px] font-medium tracking-[.28em] text-violet-200/70">{t('achievement.page.journeyEyebrow')}</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">{t('achievement.page.shelfHeading')}</h2>
            <p className="mt-2 text-sm leading-6 text-violet-100/65">{t('achievement.page.shelfSummary', { series: new Set(snapshot.earned.map(item => item.family)).size, badges: snapshot.earned.length })}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" isDisabled={readOnly} className="border border-white/20 bg-white/10 text-white hover:bg-white/20" aria-pressed={editing} onPress={() => setEditing(value => !value)}>{editing ? <Check size={14}/> : <Plus size={14}/>} {t(editing ? 'achievement.page.editDone' : 'achievement.page.editShelf')}</Button>
              <Button size="sm" className="bg-violet-200 text-violet-950" isDisabled={shelf.length === 0} onPress={() => share({ kind: 'showcase' })}><Share2 size={14}/>{t('achievement.page.shareShelf')}</Button>
            </div>
          </div>
          <div className="grid w-full max-w-md grid-cols-3 gap-2 self-center sm:gap-5 lg:shrink-0" aria-label={t('achievement.page.shelfBadges')}>
            {[0, 1, 2].map(index => {
              const item = shelf[index];
              return <div key={index} className="relative min-w-0">
                <button type="button" disabled={!item && readOnly} className="w-full min-w-0 rounded-2xl px-1 py-3 text-center transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-violet-200" onClick={() => item ? openDetails(item.id) : setEditing(true)} aria-label={item ? t('achievement.page.viewBadge', { name: achievementDisplayName(item, true, locale) }) : t('achievement.page.chooseShelfBadge', { index: index + 1 })}>
                {item ? <><BadgeArtwork family={item.family} tier={item.tier} size={110} className="mx-auto h-auto max-w-full"/><span className="mt-2 block break-words text-xs font-medium text-violet-50">{achievementDisplayName(item, true, locale)}</span></> : <><span className="mx-auto flex aspect-square w-full max-w-[100px] items-center justify-center rounded-full border border-dashed border-white/20 bg-white/[.03]"><Plus size={24} className="text-violet-200/35"/></span><span className="mt-3 block text-xs text-violet-200/45">{t('achievement.page.emptyShelfSlot')}</span></>}
                </button>
                {editing && item && <button type="button" className="absolute right-0 top-0 rounded-full border border-white/20 bg-violet-950/80 p-1.5 text-violet-100 hover:bg-violet-800 disabled:opacity-40" disabled={busy} aria-label={t('achievement.page.removeFromShelf', { name: achievementDisplayName(item, true, locale) })} onClick={() => void toggleShowcase(item.id)}><X size={13}/></button>}
              </div>;
            })}
          </div>
        </div>
      </section>
      {editing && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-accent/10 px-4 py-3 text-xs text-accent"><span>{t('achievement.page.editHint', { count: shelf.length })}</span><Button size="sm" variant="secondary" isDisabled={busy || snapshot.earned.length === 0} onPress={() => void updatePreferences({ showcaseIds: recommendShowcase(snapshot) }).catch(() => undefined)}><Sparkles size={13}/>{t('achievement.page.useSuggested')}</Button></div>}

      <dl className="my-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          [t('achievement.share.totalActive'), t('achievement.share.daysValue', { count: snapshot.summary.activeDays })], [t('achievement.page.currentStreak'), t('achievement.share.daysValue', { count: snapshot.summary.currentStreak })],
          [t('achievement.page.historicalBest'), t('achievement.share.daysValue', { count: snapshot.records.find(item => item.id === 'longest-streak')?.value ?? 0 })], [t('achievement.page.unlockedSeries'), new Set(snapshot.earned.map(item => item.family)).size + ' / 14'],
        ].map(([label, value]) => <div key={label} className="rounded-2xl border border-border/70 bg-surface px-4 py-3"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1.5 text-xl font-semibold tabular-nums">{value}</dd></div>)}
      </dl>
      {snapshot.earned.length === 0 && <div className="mb-6 rounded-2xl border border-dashed border-border p-5 text-sm leading-6 text-muted"><Sparkles size={18} className="mb-2 text-accent"/><p className="font-medium text-foreground">{t('achievement.page.emptyHeading')}</p><p>{t('achievement.page.emptyBody')}</p></div>}

      {snapshot.earned.length > 0 && <section aria-label={t('achievement.page.recent')} className="my-7">
        <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">{t('achievement.page.recent')}</h2><span className="text-xs text-muted">{t('achievement.page.recentHint')}</span></div>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {snapshot.earned.slice(0, 4).map(item => <li key={item.id}><button type="button" className="flex h-full w-full items-center gap-2 rounded-2xl border border-border bg-surface px-2 py-3 text-left transition-colors hover:border-accent/40" aria-label={t('achievement.page.viewBadge', { name: achievementDisplayName(item, true, locale) })} onClick={() => openDetails(item.id)}>
            <BadgeArtwork family={item.family} tier={item.tier} size={66} className="shrink-0"/>
            <span className="min-w-0"><span className="block break-words text-xs font-semibold">{achievementDisplayName(item, true, locale)}</span><span className="mt-1 block text-[11px] text-muted">{item.achievedOn ? formatAchievementDate(item.achievedOn, locale) : t('achievement.page.earned')}</span>{snapshot.unreadIds.includes(item.id) && <span className="mt-1 block text-[9px] font-semibold tracking-wider text-accent">{t('achievement.page.new')}</span>}</span>
          </button></li>)}
        </ul>
      </section>}

      {closest.length > 0 && <section aria-label={t('achievement.page.approaching')} className="my-7">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Flame size={15} className="text-orange-400"/>{t('achievement.page.approaching')}</h2>
        <div className="grid gap-3 md:grid-cols-3">{closest.map(item => <button type="button" key={item.id} onClick={() => openDetails(item.id)} className="rounded-2xl border border-border bg-surface p-4 text-left hover:border-accent/40">
          <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{achievementDisplayName(item, true, locale)}</span><ArrowUpRight size={14} className="shrink-0 text-muted"/></div>
          <p className="mt-2 text-xs tabular-nums text-muted">{achievementProgressText(item, locale)}</p>
          <progress className="achievement-progress mt-3" value={Math.min(item.value, item.target)} max={item.target} aria-label={t('achievement.page.progressAria', { name: achievementDisplayName(item, true, locale) })}/>
        </button>)}</div>
      </section>}

      <div className="my-7 grid gap-4 lg:grid-cols-2">
        <section aria-label={t('achievement.page.personalRecords')} className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold"><Trophy size={16} className="text-amber-400"/>{t('achievement.page.personalRecords')}</h2>
          <div className="grid grid-cols-2 gap-4">{snapshot.records.map(record => <div key={record.id}><p className="text-xs text-muted">{achievementRecordLabel(record, locale)}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{record.value.toLocaleString(locale)}<span className="ml-1 text-xs font-normal text-muted">{t('achievement.unit.days')}</span></p><p className="mt-2 text-[11px] text-muted">{record.achievedOn ? formatAchievementDate(record.achievedOn, locale) : t('achievement.page.awaitingRecord')}{record.period ? ' · ' + formatAchievementMonth(record.period, locale) : ''}</p></div>)}</div>
          <p className="mt-4 text-[11px] text-muted">{t('achievement.page.personalBestNote')}</p>
        </section>
        <section aria-label={t('achievement.family.annual')} className="rounded-2xl border border-violet-400/25 bg-violet-400/[.06] p-5">
          <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">{t('achievement.family.annual')}</h2><select aria-label={t('achievement.page.annualYearAria')} className="rounded-lg border border-border bg-surface px-2 py-1 text-xs" value={annual?.year ?? ''} onChange={event => setYear(Number(event.target.value))}>{snapshot.annual.map(item => <option key={item.year} value={item.year}>{item.year}</option>)}</select></div>
          {annual && <><p className="mt-4 text-xs text-muted">{t(annual.complete ? 'achievement.share.annualComplete' : 'achievement.share.annualCurrent')}</p><p className="mt-2 text-xl font-semibold">{t('achievement.page.annualStats', { days: annual.activeDays, tokens: formatAchievementAmount(annual.tokens, 'tokens', locale) })}</p><div className="mt-4 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted">{t(annual.topSource ? 'achievement.page.annualMonthsAgent' : 'achievement.page.annualMonths', { count: annual.activeMonths, agent: annual.topSource ? sourceLabel(annual.topSource) : '' })}</span><Button size="sm" variant="secondary" isDisabled={annual.activeDays === 0} onPress={() => share({ kind: 'annual', year: annual.year })}><Share2 size={13}/>{t('achievement.page.shareAnnual')}</Button></div></>}
        </section>
      </div>

      <section aria-label={t('achievement.page.allCollectionAria')} id="achievement-collection" className="scroll-mt-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">{t('achievement.page.allCollection')}<span className="ml-2 text-xs font-normal text-muted">{t('achievement.page.seriesCount', { count: ACHIEVEMENT_FAMILIES.length })}</span></h2><div className="flex gap-2">
          <select aria-label={t('achievement.page.familyFilterAria')} value={family} onChange={event => setFamily(event.target.value as AchievementFamily | 'all')} className="max-w-36 rounded-xl border border-border bg-surface px-3 py-2 text-xs"><option value="all">{t('achievement.page.allSeries')}</option>{ACHIEVEMENT_FAMILIES.map(item => <option key={item.id} value={item.id}>{achievementFamilyLabel(item.id, locale)}</option>)}</select>
          <select aria-label={t('achievement.page.statusFilterAria')} value={status} onChange={event => setStatus(event.target.value)} className="rounded-xl border border-border bg-surface px-3 py-2 text-xs"><option value="all">{t('achievement.page.allStatuses')}</option><option value="earned">{t('achievement.page.earned')}</option><option value="progress">{t('achievement.page.inProgress')}</option></select>
        </div></div>
        <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label={t('achievement.page.categoryAria')}>{(['all', ...Object.keys(ACHIEVEMENT_CATEGORY_LABELS)] as Array<AchievementCategory | 'all'>).map(key => <button type="button" key={key} aria-pressed={category === key} onClick={() => setCategory(key)} className={'rounded-full px-3 py-1.5 text-xs transition-colors ' + (category === key ? 'bg-accent text-accent-foreground' : 'bg-surface-secondary text-muted hover:text-foreground')}>{key === 'all' ? t('achievement.page.all') : achievementCategoryLabel(key, locale)}</button>)}</div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{shown.map(group => <CollectionCard key={group.id} group={group} editing={editing} showcaseIds={snapshot.preferences.showcaseIds} unread={group.items.some(item => snapshot.unreadIds.includes(item.id))} onOpen={openFamily} onDetails={openDetails}/>)}</div>
        {shown.length === 0 && <p className="rounded-2xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted">{t('achievement.page.noMatches')}</p>}
      </section>
      <footer className="mt-8 space-y-1.5 border-t border-border pt-4 text-[11px] leading-5 text-muted">
        <p>{t(snapshot.coverage.fromDate ? 'achievement.page.coverageFrom' : 'achievement.page.coverageAll', { date: snapshot.coverage.fromDate ? formatAchievementDate(snapshot.coverage.fromDate, locale) : '', timeZone: snapshot.coverage.timeZone })}</p>
        <p>{t('achievement.page.costNote')}</p>
        <p>{t('achievement.page.projectNote')}</p>
        {snapshot.coverage.missingSessionSources.length > 0 && <p>{t('achievement.page.missingSources', { sources: snapshot.coverage.missingSessionSources.map(sourceLabel).join(locale === 'zh-CN' ? '、' : ', ') })}</p>}
      </footer>
    </>}
  </div>;
}

function CollectionCard({ group, editing, showcaseIds, unread, onOpen, onDetails }: { group: AchievementGroup; editing: boolean; showcaseIds: string[]; unread: boolean; onOpen: (family: AchievementFamily) => void; onDetails: (id: string) => void }) {
  const { t, i18n } = useTranslation();
  const locale = normalizeLocale(i18n.language);
  const item = group.featured, next = group.next;
  const selected = group.items.filter(item => showcaseIds.includes(item.id)).length;
  const target = next ?? item;
  return <article className={'relative flex min-w-0 flex-col rounded-2xl border bg-surface p-4 transition-colors ' + (selected ? 'border-accent bg-accent/[.035]' : 'border-border hover:border-accent/30')}>
    <button type="button" onClick={() => onDetails(item.id)} className="flex w-full items-center gap-3 rounded-xl text-left outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent" aria-label={t('achievement.page.featuredAria', { name: achievementDisplayName(item, true, locale) })}>
      <BadgeArtwork family={item.family} tier={item.tier} locked={group.earnedCount === 0} size={84} className="shrink-0"/>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{achievementFamilyLabel(item.family, locale)}</span><span className="mt-2 block text-xs leading-5 text-muted">{achievementGroupSummary(group, locale)}</span><span className={'mt-1.5 block break-words text-[10px] ' + (group.earnedCount ? 'text-accent' : 'text-muted')}>{group.earnedCount ? t('achievement.page.highestEarned', { name: achievementDisplayName(item, true, locale) }) : achievementDisplayName(item, true, locale)}{unread ? ' · ' + t('achievement.page.new') : ''}</span></span>
    </button>
    <div className="mt-4 min-h-16 flex-1"><p className="text-[11px] leading-5 text-muted">{next ? t('achievement.page.nextTarget', { name: achievementDisplayName(next, true, locale) }) : t(group.earnedCount ? 'achievement.page.allLevelsEarned' : 'achievement.page.autoAccumulate')}</p>{next && (next.family === 'annual' ? <p className="mt-2 text-[11px] text-muted">{t('achievement.page.annualPending')}</p> : <><p className="mt-1 text-[11px] text-muted">{achievementProgressText(target, locale)}{target.family === 'monthly-full' && target.value >= target.target ? ' · ' + t('achievement.page.monthEnd') : ''}</p><progress className="achievement-progress mt-2" value={Math.min(target.value, target.target)} max={target.target} aria-label={t('achievement.page.progressAria', { name: achievementDisplayName(target, true, locale) })}/></>)}</div>
    <Button className="mt-3 w-full justify-between" size="sm" variant="tertiary" onPress={() => onOpen(group.family)}>{t(editing ? 'achievement.page.chooseSeriesBadges' : 'achievement.page.viewSeriesBadges')}{selected > 0 ? <span className="text-[10px] text-accent">{t('achievement.page.displayedCount', { count: selected })}</span> : <ArrowUpRight size={13}/>}</Button>
  </article>;
}
