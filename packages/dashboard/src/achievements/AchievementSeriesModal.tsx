import { useCallback, useMemo, useRef, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { Check, FolderGit2, Plus, Search, Settings2 } from 'lucide-react';
import { ACHIEVEMENT_FAMILIES } from 'quotern-core/achievements';
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
  const records = group.records.filter(record => (!scoped || record.featured.scope) && (!query.trim() || (achievementScopeLabel(record.featured) ?? record.featured.title).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
    && record.items.some(item => achievementMatchesStatus(item, status, snapshot.coverage.asOfDate)));
  const pending = snapshot.projects?.filter(item => !item.confirmed && !item.ignored && !item.mergeInto).length ?? 0;
  const toggleShowcase = async (id: string) => {
    const ids = snapshot.preferences.showcaseIds, next = ids.includes(id) ? ids.filter(item => item !== id) : [...ids, id];
    if (next.length <= 3) await updatePreferences({ showcaseIds: next }).catch(() => undefined);
  };
  const objectLabel = group.family === 'agent-loyalty' ? 'Agent' : group.family === 'project' ? '项目' : '记录';
  return <Modal.Backdrop isOpen={!detailIds.length && !shareSelection} onOpenChange={open => { if (!open) closeFamily(); }}>
    <Modal.Container size="lg" scroll="inside">
      <Modal.Dialog aria-label={meta.label + '系列详情'} className="max-h-[90dvh] overflow-hidden">
        <Modal.CloseTrigger aria-label="关闭系列详情"/>
        <Modal.Header className="flex-row items-center gap-3 pr-12">
          <BadgeArtwork family={group.family} tier={group.featured.tier} locked={!group.earnedCount} size={72}/>
          <div><Modal.Heading>{meta.label}</Modal.Heading><p className="mt-1 text-xs text-muted">{achievementGroupSummary(group)} · {group.earnedCount} 枚收藏</p></div>
        </Modal.Header>
        <Modal.Body ref={restoreScroll} onScroll={event => { scrollTop.current = event.currentTarget.scrollTop; }} className="min-w-0 px-5 pb-4">
          {group.family === 'project' && <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface-secondary p-3 text-xs">
            <p className="min-w-0 flex-1 text-muted">同一仓库的子目录与 worktree 合并累计。{pending > 0 ? pending + ' 个目录待确认。' : '可调整项目名称与归属。'}</p>
            <Button size="sm" variant="secondary" aria-pressed={managing} onPress={() => setManaging(value => !value)}><Settings2 size={13}/>{managing ? '返回项目记录' : '管理项目'}</Button>
          </div>}
          {managing ? <AchievementProjectManager/> : <>
            <div className="mb-4 flex flex-wrap gap-2">
              {(scoped || period) && <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-border bg-surface px-3 py-2"><Search size={14} className="shrink-0 text-muted" aria-hidden="true"/><input aria-label={'搜索' + objectLabel} type="search" className="min-w-0 flex-1 bg-transparent text-xs outline-none" value={query} onChange={event => setQuery(event.target.value)} placeholder={'搜索' + (period ? '月份或年份' : objectLabel)}/></label>}
              <select aria-label="筛选系列记录" className="rounded-xl border border-border bg-surface px-3 py-2 text-xs" value={status} onChange={event => setStatus(event.target.value)}><option value="all">全部记录</option><option value="earned">已获得</option><option value="current">进行中</option>{period && <option value="expired">已结束未达成</option>}</select>
            </div>
            <p className="mb-3 text-[11px] text-muted">点击徽章查看详情。</p>
            {scoped ? <div className="overflow-x-auto rounded-xl border border-border">
              <table className="achievement-record-table w-full text-left text-xs">
                <caption className="sr-only">{meta.label}的各{objectLabel}徽章、进度与获得日期。</caption>
                <thead className="bg-surface-secondary text-muted"><tr><th scope="col" className="min-w-32 px-3 py-3 font-medium">{objectLabel}</th>{[30, 100].map(days => <th key={days} scope="col" className="min-w-28 px-2 py-3 font-medium">{days} 天 · {days === 30 ? meta.label : group.family === 'project' ? '百日共筑' : '百日搭档'}</th>)}</tr></thead>
                <tbody>{records.map(record => <tr key={record.id} className="border-t border-border align-top">
                  <th scope="row" className="max-w-52 px-3 py-4 font-medium"><span className="flex items-center gap-2">{group.family === 'agent-loyalty' ? <ProviderIcon provider={record.featured.scope!} size={18}/> : <FolderGit2 size={16} className="shrink-0 text-muted" aria-hidden="true"/>}<span className="break-words">{achievementScopeLabel(record.featured)}</span></span><span className="mt-1.5 block text-[10px] font-normal text-muted">累计 {Math.max(...record.items.map(item => item.value))} 个活跃日</span></th>
                  {[30, 100].map(target => { const item = record.items.find(level => level.target === target); if (!item) return <td key={target} className="p-3 text-muted">暂无记录</td>;
                    const pinned = snapshot.preferences.showcaseIds.includes(item.id), name = achievementDisplayName(item);
                    return <td key={target} className="px-2 py-3"><button type="button" onClick={() => openDetails(item.id)} aria-label={'查看' + name} className="flex w-full flex-col items-center gap-1 rounded-xl p-1.5 text-center hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-accent"><BadgeArtwork family={item.family} tier={item.tier} locked={!item.eligible} size={64} className="shrink-0"/><span className="text-[11px] font-medium">{item.title}</span><span className={'text-[11px] ' + (item.eligible ? 'text-accent' : 'text-muted')}>{item.eligible ? '已获得' : achievementProgressText(item)}</span><span className="text-[10px] text-muted">{item.eligible ? item.achievedOn : '还差 ' + Math.max(0, item.target - item.value) + ' 天'}</span></button>{item.eligible && <Button size="sm" variant={pinned ? 'primary' : 'tertiary'} className="mt-1 h-7 w-full text-[10px]" aria-label={(pinned ? '移出展示架：' : '加入展示架：') + name} aria-pressed={pinned} isDisabled={busy || snapshot.preferences.showcaseIds.length >= 3 && !pinned} onPress={() => void toggleShowcase(item.id)}>{pinned ? <Check size={11}/> : <Plus size={11}/>} {pinned ? '已展示' : '展示'}</Button>}</td>;
                  })}
                </tr>)}</tbody>
              </table>
            </div> : <ul className="space-y-2">{records.flatMap(record => record.items).filter(item => achievementMatchesStatus(item, status, snapshot.coverage.asOfDate)).map(item => {
              const pinned = snapshot.preferences.showcaseIds.includes(item.id), expired = !item.eligible && !isCurrentAchievement(item, snapshot.coverage.asOfDate);
              return <li key={item.id} className="flex items-center gap-2 rounded-xl border border-border p-2"><button type="button" onClick={() => openDetails(item.id)} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left focus-visible:outline-2 focus-visible:outline-accent" aria-label={'查看' + achievementDisplayName(item)}><BadgeArtwork family={item.family} tier={item.tier} locked={!item.eligible} size={56}/><span className="min-w-0"><span className="block text-sm font-medium">{item.title}</span><span className={'mt-1 block text-[11px] ' + (item.eligible ? 'text-accent' : 'text-muted')}>{item.eligible ? item.achievedOn + ' · 已获得' : expired ? '已结束 · ' + achievementProgressText(item) : achievementProgressText(item)}</span></span></button>{item.eligible && <Button size="sm" isIconOnly variant={pinned ? 'primary' : 'tertiary'} aria-label={(pinned ? '移出展示架：' : '加入展示架：') + achievementDisplayName(item)} aria-pressed={pinned} isDisabled={busy || snapshot.preferences.showcaseIds.length >= 3 && !pinned} onPress={() => void toggleShowcase(item.id)}>{pinned ? <Check size={14}/> : <Plus size={14}/>}</Button>}</li>;
            })}</ul>}
            {records.length === 0 && <p className="py-10 text-center text-sm text-muted">{group.family === 'project' && !query ? '尚无已确认的项目记录，可在管理项目中确认目录。' : '没有符合条件的记录。'}</p>}
            <p className="mt-4 text-[11px] leading-5 text-muted">每个对象分别累计，已获得的等级永久保留。展示架最多三枚，可选择同系列的不同记录。</p>
          </>}
        </Modal.Body>
        <Modal.Footer><Button variant="secondary" onPress={closeFamily}>完成</Button></Modal.Footer>
      </Modal.Dialog>
    </Modal.Container>
  </Modal.Backdrop>;
}
