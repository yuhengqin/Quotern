import { useMemo, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { Button, Label, Spinner, Switch } from '@heroui/react';
import { ArrowLeft, ArrowUpRight, Award, Check, Flame, Plus, RefreshCw, Share2, Sparkles, Trophy, X } from 'lucide-react';
import { ACHIEVEMENT_FAMILIES, ACHIEVEMENT_CATEGORY_LABELS, type AchievementCategory, type AchievementFamily } from 'quotern-core/achievements';
import { sourceLabel } from '@/lib/tokens';
import { useAchievements } from './AchievementProvider';
import { BadgeArtwork } from './BadgeArtwork';
import { achievementDisplayName, achievementGroupSummary, achievementProgressText, closestAchievements, formatAchievementAmount, groupAchievements, recommendShowcase, type AchievementGroup } from './view-model';
import './achievements.css';

export function AchievementsPage() {
  const { snapshot, loading, busy, error, refresh, updatePreferences, openDetails, openFamily, share } = useAchievements();
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
    if (!snapshot || busy) return;
    const current = snapshot.preferences.showcaseIds;
    const next = current.includes(id) ? current.filter(value => value !== id) : [...current, id];
    if (next.length > 3) return;
    await updatePreferences({ showcaseIds: next }).catch(() => undefined);
  };
  return <div className="achievement-page min-w-0 pb-6">
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <Link to="/dashboard" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted hover:text-foreground"><ArrowLeft size={14} aria-hidden="true"/>返回用量</Link>
        <div className="flex items-center gap-2"><Award className="text-accent" size={25} aria-hidden="true"/><h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">成就</h1></div>
        <p className="mt-2 text-sm text-muted">把每一次同行，留成值得收藏的记录。</p>
      </div>
      <div className="flex items-center gap-3 pt-1 sm:pt-9">
        <Switch aria-label="成就提示" isSelected={snapshot?.preferences.celebrationsEnabled ?? true} isDisabled={!snapshot || busy} onChange={selected => void updatePreferences({ celebrationsEnabled: selected }).catch(() => undefined)} size="sm">
          <Switch.Content><Switch.Control><Switch.Thumb/></Switch.Control><Label className="text-xs">成就提示</Label></Switch.Content>
        </Switch>
        <Button aria-label="刷新成就" isIconOnly size="sm" variant="tertiary" isDisabled={loading} onPress={() => void refresh()}><RefreshCw size={15}/></Button>
      </div>
    </header>

    {error && <div role="alert" className="mb-5 flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm"><p>{error}</p><Button size="sm" variant="secondary" onPress={() => void refresh()}>重试</Button></div>}
    {loading && !snapshot && <div className="flex min-h-80 items-center justify-center gap-3 text-sm text-muted" role="status"><Spinner size="sm"/>正在整理你的足迹…</div>}
    {snapshot && <>
      <section aria-label="我的成就展示架" className="achievement-shelf relative overflow-hidden rounded-3xl p-5 text-white sm:p-8">
        <div aria-hidden="true" className="achievement-orbit"/>
        <div className="relative flex flex-col justify-between gap-6 lg:flex-row lg:items-center">
          <div className="max-w-sm">
            <p className="text-[10px] font-medium tracking-[.28em] text-violet-200/70">YOUR AI JOURNEY</p>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">每一枚，都有来处。</h2>
            <p className="mt-2 text-sm leading-6 text-violet-100/65">已解锁 <span className="font-semibold text-white">{new Set(snapshot.earned.map(item => item.family)).size}</span> 个系列，留下 <span className="font-semibold text-white">{snapshot.earned.length}</span> 枚收藏。</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Button size="sm" variant="secondary" className="border border-white/20 bg-white/10 text-white hover:bg-white/20" aria-pressed={editing} onPress={() => setEditing(value => !value)}>{editing ? <Check size={14}/> : <Plus size={14}/>} {editing ? '完成编辑' : '编辑展示架'}</Button>
              <Button size="sm" className="bg-violet-200 text-violet-950" isDisabled={shelf.length === 0} onPress={() => share({ kind: 'showcase' })}><Share2 size={14}/>分享展示架</Button>
            </div>
          </div>
          <div className="grid w-full max-w-md grid-cols-3 gap-2 self-center sm:gap-5 lg:shrink-0" aria-label="展示架徽章">
            {[0, 1, 2].map(index => {
              const item = shelf[index];
              return <div key={index} className="relative min-w-0">
                <button type="button" className="w-full min-w-0 rounded-2xl px-1 py-3 text-center transition-colors hover:bg-white/5 focus-visible:outline-2 focus-visible:outline-violet-200" onClick={() => item ? openDetails(item.id) : setEditing(true)} aria-label={item ? '查看' + achievementDisplayName(item) : '选择第' + (index + 1) + '枚展示徽章'}>
                {item ? <><BadgeArtwork family={item.family} tier={item.tier} size={110} className="mx-auto h-auto max-w-full"/><span className="mt-2 block break-words text-xs font-medium text-violet-50">{achievementDisplayName(item)}</span></> : <><span className="mx-auto flex aspect-square w-full max-w-[100px] items-center justify-center rounded-full border border-dashed border-white/20 bg-white/[.03]"><Plus size={24} className="text-violet-200/35"/></span><span className="mt-3 block text-xs text-violet-200/45">留给一枚纪念</span></>}
                </button>
                {editing && item && <button type="button" className="absolute right-0 top-0 rounded-full border border-white/20 bg-violet-950/80 p-1.5 text-violet-100 hover:bg-violet-800 disabled:opacity-40" disabled={busy} aria-label={'移出展示架：' + achievementDisplayName(item)} onClick={() => void toggleShowcase(item.id)}><X size={13}/></button>}
              </div>;
            })}
          </div>
        </div>
      </section>
      {editing && <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-accent/10 px-4 py-3 text-xs text-accent"><span>打开下方系列选择徽章，最多三枚。已选 {shelf.length} 枚。</span><Button size="sm" variant="secondary" isDisabled={busy || snapshot.earned.length === 0} onPress={() => void updatePreferences({ showcaseIds: recommendShowcase(snapshot) }).catch(() => undefined)}><Sparkles size={13}/>使用推荐组合</Button></div>}

      <dl className="my-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ['累计活跃', snapshot.summary.activeDays + ' 天'], ['当前连续', snapshot.summary.currentStreak + ' 天'],
          ['历史最长', (snapshot.records.find(item => item.id === 'longest-streak')?.value ?? 0) + ' 天'], ['已解锁系列', new Set(snapshot.earned.map(item => item.family)).size + ' / 14'],
        ].map(([label, value]) => <div key={label} className="rounded-2xl border border-border/70 bg-surface px-4 py-3"><dt className="text-xs text-muted">{label}</dt><dd className="mt-1.5 text-xl font-semibold tabular-nums">{value}</dd></div>)}
      </dl>
      {snapshot.earned.length === 0 && <div className="mb-6 rounded-2xl border border-dashed border-border p-5 text-sm leading-6 text-muted"><Sparkles size={18} className="mb-2 text-accent"/><p className="font-medium text-foreground">第一枚成就，等你留下记录。</p><p>使用一次 Agent 并同步用量后，符合条件的成就会自动点亮。已有历史也会一起整理。</p></div>}

      {snapshot.earned.length > 0 && <section aria-label="最近获得" className="my-7">
        <div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-sm font-semibold">最近获得</h2><span className="text-xs text-muted">点开徽章，回看这一刻</span></div>
        <ul className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {snapshot.earned.slice(0, 4).map(item => <li key={item.id}><button type="button" className="flex h-full w-full items-center gap-2 rounded-2xl border border-border bg-surface px-2 py-3 text-left transition-colors hover:border-accent/40" aria-label={'查看' + achievementDisplayName(item)} onClick={() => openDetails(item.id)}>
            <BadgeArtwork family={item.family} tier={item.tier} size={66} className="shrink-0"/>
            <span className="min-w-0"><span className="block break-words text-xs font-semibold">{achievementDisplayName(item)}</span><span className="mt-1 block text-[11px] text-muted">{item.achievedOn ?? '已获得'}</span>{snapshot.unreadIds.includes(item.id) && <span className="mt-1 block text-[9px] font-semibold tracking-wider text-accent">NEW</span>}</span>
          </button></li>)}
        </ul>
      </section>}

      {closest.length > 0 && <section aria-label="正在接近" className="my-7">
        <h2 className="mb-3 flex items-center gap-1.5 text-sm font-semibold"><Flame size={15} className="text-orange-400"/>正在接近</h2>
        <div className="grid gap-3 md:grid-cols-3">{closest.map(item => <button type="button" key={item.id} onClick={() => openDetails(item.id)} className="rounded-2xl border border-border bg-surface p-4 text-left hover:border-accent/40">
          <div className="flex items-center justify-between gap-2"><span className="text-sm font-medium">{achievementDisplayName(item)}</span><ArrowUpRight size={14} className="shrink-0 text-muted"/></div>
          <p className="mt-2 text-xs tabular-nums text-muted">{achievementProgressText(item)}</p>
          <progress className="achievement-progress mt-3" value={Math.min(item.value, item.target)} max={item.target} aria-label={achievementDisplayName(item) + '进度'}/>
        </button>)}</div>
      </section>}

      <div className="my-7 grid gap-4 lg:grid-cols-2">
        <section aria-label="个人纪录" className="rounded-2xl border border-border bg-surface p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold"><Trophy size={16} className="text-amber-400"/>个人纪录</h2>
          <div className="grid grid-cols-2 gap-4">{snapshot.records.map(record => <div key={record.id}><p className="text-xs text-muted">{record.title}</p><p className="mt-2 text-2xl font-semibold tabular-nums">{record.value}<span className="ml-1 text-xs font-normal text-muted">天</span></p><p className="mt-2 text-[11px] text-muted">{record.achievedOn ?? '等待第一条记录'}{record.period ? ' · ' + record.period : ''}</p></div>)}</div>
          <p className="mt-4 text-[11px] text-muted">每次刷新，都会留下新的个人最佳。</p>
        </section>
        <section aria-label="年度足迹" className="rounded-2xl border border-violet-400/25 bg-violet-400/[.06] p-5">
          <div className="flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">年度足迹</h2><select aria-label="足迹年份" className="rounded-lg border border-border bg-surface px-2 py-1 text-xs" value={annual?.year ?? ''} onChange={event => setYear(Number(event.target.value))}>{snapshot.annual.map(item => <option key={item.year} value={item.year}>{item.year}</option>)}</select></div>
          {annual && <><p className="mt-4 text-xs text-muted">{annual.complete ? '这一年，与 AI 一起走过' : '今年的故事，还在继续'}</p><p className="mt-2 text-xl font-semibold">{annual.activeDays} <span className="text-xs font-normal text-muted">个活跃日</span><span className="mx-3 text-muted/40">/</span>{formatAchievementAmount(annual.tokens, 'Token')} <span className="text-xs font-normal text-muted">Token</span></p><div className="mt-4 flex flex-wrap items-center justify-between gap-2"><span className="text-xs text-muted">跨越 {annual.activeMonths} 个月{annual.topSource ? ' · 常用 ' + sourceLabel(annual.topSource) : ''}</span><Button size="sm" variant="secondary" isDisabled={annual.activeDays === 0} onPress={() => share({ kind: 'annual', year: annual.year })}><Share2 size={13}/>分享年度卡</Button></div></>}
        </section>
      </div>

      <section aria-label="全部成就收藏" id="achievement-collection" className="scroll-mt-8">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h2 className="text-base font-semibold">全部收藏<span className="ml-2 text-xs font-normal text-muted">{ACHIEVEMENT_FAMILIES.length} 个系列</span></h2><div className="flex gap-2">
          <select aria-label="筛选成就系列" value={family} onChange={event => setFamily(event.target.value as AchievementFamily | 'all')} className="max-w-36 rounded-xl border border-border bg-surface px-3 py-2 text-xs"><option value="all">全部系列</option>{ACHIEVEMENT_FAMILIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
          <select aria-label="筛选成就状态" value={status} onChange={event => setStatus(event.target.value)} className="rounded-xl border border-border bg-surface px-3 py-2 text-xs"><option value="all">全部状态</option><option value="earned">已获得</option><option value="progress">进行中</option></select>
        </div></div>
        <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="成就分类">{(['all', ...Object.keys(ACHIEVEMENT_CATEGORY_LABELS)] as Array<AchievementCategory | 'all'>).map(key => <button type="button" key={key} aria-pressed={category === key} onClick={() => setCategory(key)} className={'rounded-full px-3 py-1.5 text-xs transition-colors ' + (category === key ? 'bg-accent text-accent-foreground' : 'bg-surface-secondary text-muted hover:text-foreground')}>{key === 'all' ? '全部' : ACHIEVEMENT_CATEGORY_LABELS[key]}</button>)}</div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{shown.map(group => <CollectionCard key={group.id} group={group} editing={editing} showcaseIds={snapshot.preferences.showcaseIds} unread={group.items.some(item => snapshot.unreadIds.includes(item.id))} onOpen={openFamily} onDetails={openDetails}/>)}</div>
        {shown.length === 0 && <p className="rounded-2xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted">这个分类中还没有符合条件的收藏。</p>}
      </section>
      <footer className="mt-8 space-y-1.5 border-t border-border pt-4 text-[11px] leading-5 text-muted">
        <p>基于{snapshot.coverage.fromDate ? ' ' + snapshot.coverage.fromDate + ' 起的' : ''}已采集记录 · {snapshot.coverage.timeZone} 自然日 · 成就不受用量页筛选影响。</p>
        <p>预估费用会随计价表变化；会话时长含闲置与并发。已获得的成就及达成快照永久保留。</p>
        <p>项目按仓库或已确认的根目录归属，同一仓库的子目录与 worktree 合并；当前覆盖 Claude/Codex 的逻辑消息，同一天跨 Agent 只计一次。</p>
        {snapshot.coverage.missingSessionSources.length > 0 && <p>会话与时长尚未完整覆盖：{snapshot.coverage.missingSessionSources.map(sourceLabel).join('、')}。当前展示已采集的记录。</p>}
      </footer>
    </>}
  </div>;
}

function CollectionCard({ group, editing, showcaseIds, unread, onOpen, onDetails }: { group: AchievementGroup; editing: boolean; showcaseIds: string[]; unread: boolean; onOpen: (family: AchievementFamily) => void; onDetails: (id: string) => void }) {
  const item = group.featured, next = group.next;
  const selected = group.items.filter(item => showcaseIds.includes(item.id)).length;
  const meta = ACHIEVEMENT_FAMILIES.find(family => family.id === item.family)!;
  const target = next ?? item;
  return <article className={'relative flex min-w-0 flex-col rounded-2xl border bg-surface p-4 transition-colors ' + (selected ? 'border-accent bg-accent/[.035]' : 'border-border hover:border-accent/30')}>
    <button type="button" onClick={() => onDetails(item.id)} className="flex w-full items-center gap-3 rounded-xl text-left outline-offset-4 focus-visible:outline-2 focus-visible:outline-accent" aria-label={'查看代表徽章：' + achievementDisplayName(item)}>
      <BadgeArtwork family={item.family} tier={item.tier} locked={group.earnedCount === 0} size={84} className="shrink-0"/>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{meta.label}</span><span className="mt-2 block text-xs leading-5 text-muted">{achievementGroupSummary(group)}</span><span className={'mt-1.5 block break-words text-[10px] ' + (group.earnedCount ? 'text-accent' : 'text-muted')}>{group.earnedCount ? '最高已获得：' + achievementDisplayName(item) : achievementDisplayName(item)}{unread ? ' · NEW' : ''}</span></span>
    </button>
    <div className="mt-4 min-h-16 flex-1"><p className="text-[11px] leading-5 text-muted">{next ? '最近目标：' + achievementDisplayName(next) : group.earnedCount ? '已点亮当前全部等级' : '留下记录后自动累计'}</p>{next && (next.family === 'annual' ? <p className="mt-2 text-[11px] text-muted">本年度进行中，年末结束后结算。</p> : <><p className="mt-1 text-[11px] text-muted">{achievementProgressText(target)}{target.family === 'monthly-full' && target.value >= target.target ? ' · 月底结算' : ''}</p><progress className="achievement-progress mt-2" value={Math.min(target.value, target.target)} max={target.target} aria-label={achievementDisplayName(target) + '进度'}/></>)}</div>
    <Button className="mt-3 w-full justify-between" size="sm" variant="tertiary" onPress={() => onOpen(group.family)}>{editing ? '选择本系列徽章' : '查看全部徽章'}{selected > 0 ? <span className="text-[10px] text-accent">已展示 {selected} 枚</span> : <ArrowUpRight size={13}/>}</Button>
  </article>;
}
