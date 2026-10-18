import { useState } from 'react';
import { Button } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { useAchievements } from './AchievementProvider';

export function AchievementProjectManager() {
  const { t } = useTranslation();
  const { snapshot, busy, updateProject } = useAchievements();
  const [query, setQuery] = useState(''), [filter, setFilter] = useState('all'), [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState(''), [mergeInto, setMergeInto] = useState(''), [error, setError] = useState<string | null>(null);
  if (!snapshot) return null;
  const projects = snapshot.projects ?? [];
  const shown = projects.filter(item => item.label.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()) && (filter === 'all' || filter === 'pending' && !item.confirmed && !item.ignored && !item.mergeInto || filter === 'ignored' && item.ignored || filter === 'active' && item.confirmed && !item.ignored && !item.mergeInto));
  const change = async (operation: Parameters<typeof updateProject>[0]) => { try { setError(null); await updateProject(operation); return true; } catch { setError(t('achievement.project.saveFailed')); return false; } };
  return <div>
    <p className="mb-2 text-xs leading-5 text-muted">{t('achievement.project.mergeNote')}</p>
    <p className="mb-3 text-xs leading-5 text-muted">{t('achievement.project.rulesNote')}</p>
    <div className="mb-4 flex flex-wrap gap-2"><input type="search" aria-label={t('achievement.project.searchSettings')} className="min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 py-2 text-xs" value={query} onChange={event => setQuery(event.target.value)} placeholder={t('achievement.project.searchPlaceholder')}/><select aria-label={t('achievement.project.filterSettings')} value={filter} onChange={event => setFilter(event.target.value)} className="rounded-xl border border-border bg-surface px-3 py-2 text-xs"><option value="all">{t('achievement.project.allDirectories')}</option><option value="active">{t('achievement.project.confirmed')}</option><option value="pending">{t('achievement.project.pending')}</option><option value="ignored">{t('achievement.project.ignored')}</option></select></div>
    {error && <p role="alert" className="mb-3 text-xs text-danger">{error}</p>}
    <ul className="space-y-2">{shown.map(project => {
      const setting = snapshot.projectSettings?.find(item => item.id === project.id), target = projects.find(item => item.id === project.mergeInto);
      const projectStatus = project.ignored ? t('achievement.project.ignored') : target ? t('achievement.project.mergedInto', { name: target.label }) : project.confirmed ? project.kind === 'repository' ? t('achievement.project.repository') : project.kind === 'manifest' ? t('achievement.project.manifestRoot') : t('achievement.project.manuallyConfirmed') : t('achievement.project.pendingDirectory');
      return <li key={project.id} className="rounded-xl border border-border p-3">
        <div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="break-words text-sm font-medium">{project.label}</p><p className="mt-1 text-[11px] text-muted">{t('achievement.project.statusDays', { status: projectStatus, count: project.activeDays })}</p></div><Button size="sm" variant="tertiary" aria-label={t('achievement.project.editAria', { name: project.label })} isDisabled={busy} onPress={() => { setEditingId(project.id); setName(setting?.name ?? ''); setMergeInto(project.mergeInto ?? ''); setError(null); }}>{t('achievement.project.edit')}</Button></div>
        {editingId === project.id && <form className="mt-3 space-y-3 border-t border-border pt-3" onSubmit={event => { event.preventDefault(); void change({ id: project.id, name: name.trim() || null, mergeInto: mergeInto || null }).then(ok => { if (ok) setEditingId(null); }); }}>
          <div className="text-xs"><label htmlFor={'project-name-' + project.id}>{t('achievement.project.displayName')}</label><input id={'project-name-' + project.id} value={name} onChange={event => setName(event.target.value)} maxLength={80} placeholder={t('achievement.project.namePlaceholder')} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2"/></div>
          <div className="text-xs"><label htmlFor={'project-owner-' + project.id}>{t('achievement.project.owner')}</label><select id={'project-owner-' + project.id} value={mergeInto} onChange={event => setMergeInto(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-surface px-3 py-2"><option value="">{t('achievement.project.standalone')}</option>{projects.filter(item => item.id !== project.id && item.confirmed && !item.ignored && !item.mergeInto).map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></div>
          <div className="flex flex-wrap gap-2"><Button type="submit" size="sm" isDisabled={busy}>{t('achievement.project.save')}</Button><Button type="button" size="sm" variant="secondary" isDisabled={busy} onPress={() => setEditingId(null)}>{t('achievement.project.cancel')}</Button></div>
        </form>}
        <div className="mt-2 flex flex-wrap gap-2">
          {!project.confirmed && !project.mergeInto && <Button size="sm" variant="secondary" isDisabled={busy} aria-label={t('achievement.project.confirmAria', { name: project.label })} onPress={() => void change({ id: project.id, confirmed: true, ignored: false })}>{t('achievement.project.confirm')}</Button>}
          {project.kind === 'unconfirmed' && project.confirmed && !project.mergeInto && <Button size="sm" variant="tertiary" isDisabled={busy} aria-label={t('achievement.project.undoConfirmAria', { name: project.label })} onPress={() => void change({ id: project.id, confirmed: false })}>{t('achievement.project.undoConfirm')}</Button>}
          <Button size="sm" variant="tertiary" isDisabled={busy} aria-label={t(project.ignored ? 'achievement.project.restoreAria' : 'achievement.project.ignoreAria', { name: project.label })} onPress={() => void change({ id: project.id, ignored: !project.ignored })}>{t(project.ignored ? 'achievement.project.restore' : 'achievement.project.ignore')}</Button>
          {project.mergeInto && <Button size="sm" variant="tertiary" isDisabled={busy} aria-label={t('achievement.project.undoMergeAria', { name: project.label })} onPress={() => void change({ id: project.id, mergeInto: null })}>{t('achievement.project.undoMerge')}</Button>}
        </div>
      </li>;
    })}</ul>
    {!shown.length && <p className="py-8 text-center text-sm text-muted">{t('achievement.project.noDirectories')}</p>}
  </div>;
}
