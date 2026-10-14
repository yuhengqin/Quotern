import { useCallback, useMemo, useRef, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { Check, ChevronRight, FolderGit2, Search, Settings2 } from 'lucide-react';
import { ACHIEVEMENT_FAMILIES, type AchievementProgress } from 'quotern-core/achievements';
import { ProviderIcon } from '@/components/ProviderIcon';
import { useAchievements } from './AchievementProvider';
import { BadgeArtwork } from './BadgeArtwork';
import { achievementDisplayName, achievementGroupSummary, achievementMatchesStatus, achievementProgressText, achievementScopeLabel, groupAchievements, isCurrentAchievement } from './view-model';
import { AchievementProjectManager } from './AchievementProjectManager';

export function AchievementSeriesModal() {
  const { snapshot, familyDetail, detailIds, shareSelection, closeFamily, openDetails, busy, updatePreferences } = useAchievements();
  const [query, setQuery] = useState(''), [status, setStatus] = useState('all'), [managing, setManaging] = useState(false);
  const scrollTop = useRef(0);
  const restoreScroll = useCallback((node: HTMLDivElement | null) => { if (node) node.scrollTop = scrollTop.current; }, []);
  const group = useMemo(() => snapshot ? groupAchievements(snapshot).find(item => item.family === familyDetail) : undefined, [snapshot, familyDetail]);
  if (!snapshot || !group) return null;
  const meta = ACHIEVEMENT_FAMILIES.find(item => item.id === group.family)!;
  const scoped = group.family === 'agent-loyalty' || group.family === 'project';
  const period = ['monthly-full', 'monthly-active', 'annual'].includes(group.family);
  const filterable = scoped || period;
  const records = group.records.filter(record => (!scoped || record.featured.scope) && (!query.trim() || (achievementScopeLabel(record.featured) ?? record.featured.title).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    && record.items.some(item => achievementMatchesStatus(item, status, snapshot.coverage.asOfDate)));
  const levels = [...new Map(group.items.map(item => [item.target, item])).values()].sort((a, b) => a.target - b.target);
  const pending = snapshot.projects?.filter(item => !item.confirmed && !item.ignored && !item.mergeInto).length ?? 0;
  const objectLabel = group.family === 'agent-loyalty' ? 'Agent' : group.family === 'project' ? '项目' : '记录';
  const summary = scoped ? achievementGroupSummary(group) + ' · ' + group.earnedCount + ' 枚收藏'
    : period || group.family === 'records' ? achievementGroupSummary(group) : '已获得 ' + group.earnedCount + ' / ' + group.items.length + ' 个等级';
  const toggleShowcase = async (id: string) => {
    if (busy) return;
    const ids = snapshot.preferences.showcaseIds, next = ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id];
    if (next.length <= 3) await updatePreferences({ showcaseIds: next }).catch(() => undefined);
  };
  const showcaseButton = (item: AchievementProgress) => {
    if (!item.eligible) return null;
    const pinned = snapshot.preferences.showcaseIds.includes(item.id);
    return <Button size="sm" variant={pinned ? 'secondary' : 'tertiary'} className="shrink-0 text-xs"
      aria-label={(pinned ? '移出展示架：' : '加入展示架：') + achievementDisplayName(item)} aria-pressed={pinned} aria-describedby="achievement-showcase-capacity"
      isDisabled={busy || snapshot.preferences.showcaseIds.length >= 3 && !pinned} onPress={() => void toggleShowcase(item.id)}>
      {pinned && <Check size={12} aria-hidden="true"/>}{pinned ? '已展示' : '展示'}
    </Button>;
  };
  return <Modal.Backdrop isOpen={!detailIds.length && !shareSelection} onOpenChange={open => { if (!open) closeFamily(); }}>
    <Modal.Container size="lg" scroll="inside">
      <Modal.Dialog aria-label={meta.label + '系列详情'} className="max-h-[90dvh] overflow-hidden">
        <Modal.CloseTrigger aria-label="关闭系列详情"/>
        <Modal.Header className="pr-12">
          <Modal.Heading>{meta.label}</Modal.Heading>
          <p className="mt-1 text-xs text-muted">{summary}</p>
        </Modal.Header>
        <Modal.Body ref={restoreScroll} onScroll={event => { scrollTop.current = event.currentTarget.scrollTop; }} className="min-w-0 px-5 pb-4">
          {group.family === 'project' && <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs">
            <p className="text-muted">{pending > 0 ? pending + ' 个目录待确认' : '按项目累计活跃日'}</p>
            <Button size="sm" variant="secondary" aria-pressed={managing} onPress={() => setManaging(value => !value)}><Settings2 size={13} aria-hidden="true"/>{managing ? '返回项目记录' : '管理项目'}</Button>
          </div>}
          {managing ? <AchievementProjectManager/> : <>
            {filterable && <div className="mb-4 flex flex-wrap gap-2">
              <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2 focus-within:ring-2 focus-within:ring-accent"><Search size={14} className="shrink-0 text-muted" aria-hidden="true"/><input aria-label={'搜索' + objectLabel} type="search" className="min-w-0 flex-1 bg-transparent text-xs outline-none" value={query} onChange={event => setQuery(event.target.value)} placeholder={'搜索' + (period ? '月份或年份' : objectLabel)}/></label>
              <select aria-label="筛选系列记录" className="rounded-xl border border-border bg-surface px-3 py-2 text-xs" value={status} onChange={event => setStatus(event.target.value)}><option value="all">全部记录</option><option value="earned">已获得</option><option value="current">进行中</option>{period && <option value="expired">已结束未达成</option>}</select>
            </div>}
            {group.family === 'streak' && <p className="mb-3 text-xs text-muted">历史最长连续 <span className="font-medium text-foreground">{snapshot.summary.longestStreak} 天</span><span className="ml-3">当前连续 {snapshot.summary.currentStreak} 天</span></p>}
            {group.family === 'multi-agent' && <p className="mb-3 text-xs text-muted">每种 Agent 至少活跃 3 天，才计入探索足迹。</p>}
            {scoped ? <div className="achievement-records rounded-xl border border-border">
              <table role="table" className="achievement-record-table w-full text-left text-xs">
                <caption className="sr-only">{meta.label}的各{objectLabel}活跃日与等级状态，可查看详情或选择展示徽章。</caption>
                <thead><tr>
                  <th scope="col" className="w-2/5 px-3 py-3 font-medium text-muted">{objectLabel}</th>
                  {levels.map(level => <th key={level.target} scope="col" className="px-2 py-3 font-medium">
                    <span className="flex items-center gap-1.5"><BadgeArtwork family={level.family} tier={level.tier} size={32} className="shrink-0"/><span><span className="block">{level.title}</span><span className="mt-0.5 block text-[10px] text-muted">{level.target} 天</span></span></span>
                  </th>)}
                </tr></thead>
                <tbody>{records.map(record => <tr key={record.id}>
                  <th scope="row" className="border-t border-border px-3 py-3 font-medium">
                    <span className="flex items-center gap-2">{group.family === 'agent-loyalty' ? <ProviderIcon provider={record.featured.scope!} size={18}/> : <FolderGit2 size={16} className="shrink-0 text-muted" aria-hidden="true"/>}<span className="[overflow-wrap:anywhere]">{achievementScopeLabel(record.featured)}</span></span>
                    <span className="mt-1.5 block text-[11px] font-normal text-muted">累计 {Math.max(...record.items.map(item => item.value))} 个活跃日</span>
                  </th>
                  {levels.map(level => {
                    const item = record.items.find(item => item.target === level.target);
                    const label = <span className="achievement-level-label mb-1 text-[11px] font-medium">{level.title}<span className="ml-1 font-normal text-muted">{level.target} 天</span></span>;
                    if (!item) return <td key={level.target} className="border-t border-border px-2 py-3">{label}<span className="text-muted">暂无记录</span></td>;
                    const state = item.eligible ? '已获得' : '还差 ' + Math.max(0, item.target - item.value) + ' 天';
                    return <td key={level.target} className="border-t border-border px-2 py-2">
                      {label}
                      <button type="button" onClick={() => openDetails(item.id)} aria-label={'查看' + achievementDisplayName(item) + '：' + state} className="flex min-h-9 w-full items-center justify-between gap-1 rounded-lg px-1 text-left hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-accent">
                        <span className={item.eligible ? 'text-accent' : 'text-muted'}>{item.eligible && <Check size={12} className="mr-1 inline" aria-hidden="true"/>}{state}</span><ChevronRight size={13} className="shrink-0 text-muted" aria-hidden="true"/>
                      </button>
                      {showcaseButton(item)}
                    </td>;
                  })}
                </tr>)}</tbody>
              </table>
            </div> : <ul className="space-y-2">{records.flatMap(record => record.items).filter(item => achievementMatchesStatus(item, status, snapshot.coverage.asOfDate)).map(item => {
              const expired = !item.eligible && !isCurrentAchievement(item, snapshot.coverage.asOfDate);
              const state = item.eligible ? '已获得' + (item.achievedOn ? ' · ' + item.achievedOn : '') : expired ? '已结束 · ' + achievementProgressText(item)
                : item.family === 'streak' ? '还差 ' + Math.max(0, item.target - item.value) + ' 天' : achievementProgressText(item);
              return <li key={item.id} className="flex items-center gap-2 rounded-xl border border-border p-2">
                <button type="button" onClick={() => openDetails(item.id)} className="flex min-w-0 flex-1 items-center gap-2 rounded-lg text-left hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-accent" aria-label={'查看' + achievementDisplayName(item)}>
                  <BadgeArtwork family={item.family} tier={item.tier} locked={!item.eligible} size={48} className="shrink-0"/>
                  <span className="min-w-0 flex-1"><span className="block break-words text-sm font-medium">{item.title}</span><span className={'mt-1 block text-[11px] ' + (item.eligible ? 'text-accent' : 'text-muted')}>{state}</span></span>
                  <ChevronRight size={14} className="shrink-0 text-muted" aria-hidden="true"/>
                </button>
                {showcaseButton(item)}
              </li>;
            })}</ul>}
            {records.length === 0 && <p className="py-10 text-center text-sm text-muted">{group.family === 'project' && !query.trim() && status === 'all' ? '尚无已确认的项目记录，可在管理项目中确认目录。' : '没有符合条件的记录。'}</p>}
          </>}
        </Modal.Body>
        <Modal.Footer className="flex-wrap items-center justify-between gap-3">
          {!managing && <p id="achievement-showcase-capacity" className="text-[11px] text-muted">展示架 {snapshot.preferences.showcaseIds.length} / 3{snapshot.preferences.showcaseIds.length >= 3 ? ' · 已满，移出一枚后可更换' : ''}</p>}
          <Button className="ml-auto" variant="secondary" onPress={closeFamily}>完成</Button>
        </Modal.Footer>
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>;
}
