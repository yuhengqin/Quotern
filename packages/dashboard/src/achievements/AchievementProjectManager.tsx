import { useState } from 'react';
import { Button } from '@heroui/react';
import { useAchievements } from './AchievementProvider';

export function AchievementProjectManager() {
  const { snapshot, busy, updateProject } = useAchievements();
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState(''), [mergeInto, setMergeInto] = useState(''), [error, setError] = useState<string | null>(null);
  if (!snapshot) return null;
  const projects = snapshot.projects ?? [];
  const shown = projects.filter(item => item.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (filter === 'all' || filter === 'pending' && !item.confirmed && !item.ignored && !item.mergeInto || filter === 'ignored' && item.ignored || filter === 'active' && item.confirmed && !item.ignored && !item.mergeInto));
  const change = async (operation: Parameters<typeof updateProject>[0]) => { try { setError(null); await updateProject(operation); return true; } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试'); return false; } };
  return <div>
    <p className="mb-2 text-xs leading-5 text-muted">同一仓库的子目录与 worktree 合并累计，同一天跨 Agent 只计一次。</p>
    <p className="mb-3 text-xs leading-5 text-muted">普通工作目录需确认后才累计新的项目成就。重命名只改变显示；合并会按日期去重，可随时撤回。忽略目录后，已获得的徽章仍会保留。</p>
    <div className="mb-4 flex flex-wrap gap-2"><input type="search" aria-label="搜索项目设置" className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-xs" value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索项目或目录"/><select aria-label="筛选项目设置" value={filter} onChange={event => setFilter(event.target.value)} className="rounded-xl border border-border bg-surface px-3 py-2 text-xs"><option value="all">全部目录</option><option value="active">已确认项目</option><option value="pending">待确认</option><option value="ignored">已忽略</option></select></div>
    {error && <p role="alert" className="mb-3 text-xs text-danger">{error}</p>}
    <ul className="space-y-2">{shown.map(project => {
      const setting = snapshot.projectSettings?.find(item => item.id === project.id), target = projects.find(item => item.id === project.mergeInto);
      return <li key={project.id} className="rounded-xl border border-border p-3">
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-sm font-medium">{project.label}</p><p className="mt-1 text-[11px] text-muted">{project.ignored ? '已忽略' : target ? '已合并到 ' + target.label : project.confirmed ? project.kind === 'repository' ? 'Git 仓库' : project.kind === 'manifest' ? '项目配置根目录' : '已手动确认' : '待确认目录'} · {project.activeDays} 个活跃日</p></div><Button size="sm" variant="tertiary" aria-label={'编辑项目：' + project.label} isDisabled={busy} onPress={() => { setEditingId(project.id); setName(setting?.name ?? ''); setMergeInto(project.mergeInto ?? ''); setError(null); }}>编辑</Button></div>
        {editingId === project.id && <form className="mt-3 space-y-3 border-t border-border pt-3" onSubmit={event => { event.preventDefault(); void change({ id: project.id, name: name.trim() || null, mergeInto: mergeInto || null }).then(ok => { if (ok) setEditingId(null); }); }}>
          <div className="text-xs"><label htmlFor={'project-name-' + project.id}>显示名称</label><input id={'project-name-' + project.id} value={name} onChange={event => setName(event.target.value)} maxLength={80} placeholder="留空使用原名称" className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2"/></div>
          <div className="text-xs"><label htmlFor={'project-owner-' + project.id}>项目归属</label><select id={'project-owner-' + project.id} value={mergeInto} onChange={event => setMergeInto(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2"><option value="">保持独立 / 撤回合并</option>{projects.filter(item => item.id !== project.id && item.confirmed && !item.ignored && !item.mergeInto).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
          <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" isDisabled={busy}>保存名称与归属</Button><Button type="button" size="sm" variant="secondary" isDisabled={busy} onPress={() => setEditingId(null)}>取消</Button></div>
        </form>}
        <div className="mt-2 flex flex-wrap gap-2">
          {!project.confirmed && !project.mergeInto && <Button size="sm" variant="secondary" isDisabled={busy} aria-label={'确认为项目：' + project.label} onPress={() => void change({ id: project.id, confirmed: true, ignored: false })}>确认为项目</Button>}
          {project.kind === 'unconfirmed' && project.confirmed && !project.mergeInto && <Button size="sm" variant="tertiary" isDisabled={busy} aria-label={'撤回项目确认：' + project.label} onPress={() => void change({ id: project.id, confirmed: false })}>撤回确认</Button>}
          <Button size="sm" variant="tertiary" isDisabled={busy} aria-label={(project.ignored ? '恢复目录：' : '忽略目录：') + project.label} onPress={() => void change({ id: project.id, ignored: !project.ignored })}>{project.ignored ? '恢复目录' : '忽略目录'}</Button>
          {project.mergeInto && <Button size="sm" variant="tertiary" isDisabled={busy} aria-label={'撤回合并：' + project.label} onPress={() => void change({ id: project.id, mergeInto: null })}>撤回合并</Button>}
        </div>
      </li>;
    })}</ul>
    {!shown.length && <p className="py-8 text-center text-sm text-muted">没有符合条件的目录。</p>}
  </div>;
}
