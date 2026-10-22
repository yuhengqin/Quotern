import { useCallback, useMemo, useRef, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { Check, ChevronRight, FolderGit2, Search, Settings2 } from 'lucide-react';
import type { AchievementProgress } from 'quotern-core/achievements';
import { normalizeLocale } from 'quotern-i18n';
import { useTranslation } from 'quotern-i18n/react';
import { ProviderIcon } from '@/components/ProviderIcon';
import { useAchievements } from './AchievementProvider';
import { BadgeArtwork } from './BadgeArtwork';
import { achievementDisplayName, achievementFamilyLabel, achievementGroupSummary, achievementMatchesStatus, achievementProgressText, achievementScopeLabel, achievementTitle, formatAchievementDate, groupAchievements, isCurrentAchievement } from './view-model';
import { AchievementProjectManager } from './AchievementProjectManager';

export function AchievementSeriesModal() {
  const { t, i18n } = useTranslation();
  const locale = normalizeLocale(i18n.language);
  const { snapshot, familyDetail, detailIds, shareSelection, closeFamily, openDetails, busy: updating, updatePreferences, readOnly } = useAchievements();
  const busy = updating || readOnly;
  const [query, setQuery] = useState(''), [status, setStatus] = useState('all'), [managing, setManaging] = useState(false);
  const scrollTop = useRef(0);
  const restoreScroll = useCallback((node: HTMLDivElement | null) => { if (node) node.scrollTop = scrollTop.current; }, []);
  const group = useMemo(() => snapshot ? groupAchievements(snapshot).find(item => item.family === familyDetail) : undefined, [snapshot, familyDetail]);
  if (!snapshot || !group) return null;
  const familyLabel = achievementFamilyLabel(group.family, locale);
  const scoped = group.family === 'agent-loyalty' || group.family === 'project';
  const period = ['monthly-full', 'monthly-active', 'annual'].includes(group.family);
  const filterable = scoped || period;
  const records = group.records.filter(record => (!scoped || record.featured.scope) && (!query.trim() || (achievementScopeLabel(record.featured) ?? achievementTitle(record.featured, locale)).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    && record.items.some(item => achievementMatchesStatus(item, status, snapshot.coverage.asOfDate)));
  const levels = [...new Map(group.items.map(item => [item.target, item])).values()].sort((a, b) => a.target - b.target);
  const pending = snapshot.projects?.filter(item => !item.confirmed && !item.ignored && !item.mergeInto).length ?? 0;
  const objectLabel = group.family === 'agent-loyalty' ? 'Agent' : group.family === 'project' ? t('achievement.series.objectProject') : t('achievement.series.objectRecord');
  const summary = scoped ? t('achievement.series.collectionCount', { summary: achievementGroupSummary(group, locale), count: group.earnedCount })
    : period || group.family === 'records' ? achievementGroupSummary(group, locale) : t('achievement.series.levelCount', { earned: group.earnedCount, total: group.items.length });
  const toggleShowcase = async (id: string) => {
    if (busy) return;
    const ids = snapshot.preferences.showcaseIds, next = ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id];
    if (next.length <= 3) await updatePreferences({ showcaseIds: next }).catch(() => undefined);
  };
  const showcaseButton = (item: AchievementProgress) => {
    if (!item.eligible) return null;
    const pinned = snapshot.preferences.showcaseIds.includes(item.id);
    return <Button size="sm" variant={pinned ? 'secondary' : 'tertiary'} className="shrink-0 text-xs"
      aria-label={t(pinned ? 'achievement.series.removeAria' : 'achievement.series.addAria', { name: achievementDisplayName(item, true, locale) })} aria-pressed={pinned} aria-describedby="achievement-showcase-capacity"
      isDisabled={busy || snapshot.preferences.showcaseIds.length >= 3 && !pinned} onPress={() => void toggleShowcase(item.id)}>
      {pinned && <Check size={12} aria-hidden="true"/>}{t(pinned ? 'achievement.series.displayed' : 'achievement.series.display')}
    </Button>;
  };
  return <Modal.Backdrop isOpen={!detailIds.length && !shareSelection} onOpenChange={open => { if (!open) closeFamily(); }}>
    <Modal.Container size="lg" scroll="inside">
      <Modal.Dialog aria-label={t('achievement.series.dialogAria', { name: familyLabel })} className="max-h-[90dvh] overflow-hidden">
        <Modal.CloseTrigger aria-label={t('achievement.series.close')}/>
        <Modal.Header className="pr-12">
          <Modal.Heading>{familyLabel}</Modal.Heading>
          <p className="mt-1 text-xs text-muted">{summary}</p>
        </Modal.Header>
        <Modal.Body ref={restoreScroll} onScroll={event => { scrollTop.current = event.currentTarget.scrollTop; }} className="min-w-0 px-5 pb-4">
          {group.family === 'project' && <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs">
            <p className="text-muted">{pending > 0 ? t('achievement.series.pendingProjects', { count: pending }) : t('achievement.series.projectActiveDays')}</p>
            <Button size="sm" variant="secondary" aria-pressed={managing} onPress={() => setManaging(value => !value)}><Settings2 size={13} aria-hidden="true"/>{t(managing ? 'achievement.series.backProjects' : 'achievement.series.manageProjects')}</Button>
          </div>}
          {managing ? <AchievementProjectManager/> : <>
            {filterable && <div className="mb-4 flex flex-wrap gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 focus-within:ring-2 focus-within:ring-accent"><Search size={14} className="shrink-0 text-muted" aria-hidden="true"/><input aria-label={t('achievement.series.searchObject', { object: objectLabel })} type="search" className="min-w-0 flex-1 bg-transparent text-xs outline-none" value={query} onChange={event => setQuery(event.target.value)} placeholder={period ? t('achievement.series.searchPeriod') : t('achievement.series.searchObject', { object: objectLabel })}/></label>
              <select aria-label={t('achievement.series.filterAria')} className="rounded-xl border border-border bg-surface px-3 py-2 text-xs" value={status} onChange={event => setStatus(event.target.value)}><option value="all">{t('achievement.series.allRecords')}</option><option value="earned">{t('achievement.page.earned')}</option><option value="current">{t('achievement.page.inProgress')}</option>{period && <option value="expired">{t('achievement.series.endedUnmet')}</option>}</select>
            </div>}
            {group.family === 'streak' && <p className="mb-3 text-xs text-muted"><span className="font-medium text-foreground">{t('achievement.series.longestStreak', { count: snapshot.summary.longestStreak })}</span><span className="ml-3">{t('achievement.series.currentStreak', { count: snapshot.summary.currentStreak })}</span></p>}
            {group.family === 'multi-agent' && <p className="mb-3 text-xs text-muted">{t('achievement.series.multiAgentRule')}</p>}
            {scoped ? <div className="achievement-records rounded-xl border border-border">
              <table role="table" className="achievement-record-table w-full text-left text-xs">
                <caption className="sr-only">{t('achievement.series.tableCaption', { name: familyLabel, object: objectLabel })}</caption>
                <thead><tr>
                  <th scope="col" className="w-2/5 px-3 py-3 font-medium text-muted">{objectLabel}</th>
                  {levels.map(level => <th key={level.target} scope="col" className="px-2 py-3 font-medium">
                    <span className="flex items-center gap-1.5"><BadgeArtwork family={level.family} tier={level.tier} size={32} className="shrink-0"/><span><span className="block">{achievementTitle(level, locale)}</span><span className="mt-0.5 block text-[10px] text-muted">{t('achievement.series.days', { count: level.target })}</span></span></span>
                  </th>)}
                </tr></thead>
                <tbody>{records.map(record => <tr key={record.id}>
                  <th scope="row" className="border-t border-border px-3 py-3 font-medium">
                    <span className="flex items-center gap-2">{group.family === 'agent-loyalty' ? <ProviderIcon provider={record.featured.scope!} size={18}/> : <FolderGit2 size={16} className="shrink-0 text-muted" aria-hidden="true"/>}<span className="[overflow-wrap:anywhere]">{achievementScopeLabel(record.featured)}</span></span>
                    <span className="mt-1.5 block text-[11px] font-normal text-muted">{t('achievement.series.activeDays', { count: Math.max(...record.items.map(item => item.value)) })}</span>
                  </th>
                  {levels.map(level => {
                    const item = record.items.find(item => item.target === level.target);
                    const label = <span className="achievement-level-label mb-1 text-[11px] font-medium">{achievementTitle(level, locale)}<span className="ml-1 font-normal text-muted">{t('achievement.series.days', { count: level.target })}</span></span>;
                    if (!item) return <td key={level.target} className="border-t border-border px-2 py-3">{label}<span className="text-muted">{t('achievement.series.noRecord')}</span></td>;
                    const state = item.eligible ? t('achievement.page.earned') : t('achievement.series.daysRemaining', { count: Math.max(0, item.target - item.value) });
                    return <td key={level.target} className="border-t border-border px-2 py-2">
                      {label}
                      <button type="button" onClick={() => openDetails(item.id)} aria-label={t('achievement.series.viewState', { name: achievementDisplayName(item, true, locale), state })} className="flex min-h-9 w-full items-center justify-between gap-1 rounded-lg px-1 text-left hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-accent">
                        <span className={item.eligible ? 'text-accent' : 'text-muted'}>{item.eligible && <Check size={12} className="mr-1 inline" aria-hidden="true"/>}{state}</span><ChevronRight size={13} className="shrink-0 text-muted" aria-hidden="true"/>
                      </button>
                      {showcaseButton(item)}
                    </td>;
                  })}
                </tr>)}</tbody>
              </table>
            </div> : <ul className="space-y-2">{records.flatMap(record => record.items).filter(item => achievementMatchesStatus(item, status, snapshot.coverage.asOfDate)).map(item => {
              const expired = !item.eligible && !isCurrentAchievement(item, snapshot.coverage.asOfDate);
              const state = item.eligible ? item.achievedOn ? t('achievement.series.earnedWithDate', { date: formatAchievementDate(item.achievedOn, locale) }) : t('achievement.page.earned') : expired ? t('achievement.series.endedProgress', { progress: achievementProgressText(item, locale) })
                : item.family === 'streak' ? t('achievement.series.daysRemaining', { count: Math.max(0, item.target - item.value) }) : achievementProgressText(item, locale);
              return <li key={item.id} className="flex items-center gap-2 rounded-xl border border-border p-2">
                <button type="button" onClick={() => openDetails(item.id)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-accent" aria-label={t('achievement.page.viewBadge', { name: achievementDisplayName(item, true, locale) })}>
                  <BadgeArtwork family={item.family} tier={item.tier} locked={!item.eligible} size={48} className="shrink-0"/>
                  <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{achievementTitle(item, locale)}</span><span className={'mt-1 block text-[11px] ' + (item.eligible ? 'text-accent' : 'text-muted')}>{state}</span></span>
                  <ChevronRight size={14} className="shrink-0 text-muted" aria-hidden="true"/>
                </button>
                {showcaseButton(item)}
              </li>;
            })}</ul>}
            {records.length === 0 && <p className="py-10 text-center text-sm text-muted">{t(group.family === 'project' && !query.trim() && status === 'all' ? 'achievement.series.noConfirmedProjects' : 'achievement.series.noMatches')}</p>}
          </>}
        </Modal.Body>
        <Modal.Footer className="flex-wrap items-center justify-between gap-3">
          {!managing && <p id="achievement-showcase-capacity" className="text-[11px] text-muted">{t(snapshot.preferences.showcaseIds.length >= 3 ? 'achievement.series.capacityFull' : 'achievement.series.capacity', { count: snapshot.preferences.showcaseIds.length })}</p>}
          <Button className="ml-auto" variant="secondary" onPress={closeFamily}>{t('achievement.series.done')}</Button>
        </Modal.Footer>
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>;
}
