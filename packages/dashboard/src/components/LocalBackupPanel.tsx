import { useEffect, useId, useRef, useState } from 'react';
import { Button, Checkbox, Input, Label, TextField } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import type { BackupSummary, DataBackup, ProtectedRestoreResult } from 'quotern-core';
import { request } from '@/lib/api';
import { isDemoMode } from '@/lib/demo-runtime';
import { HelpPopover } from './HelpPopover';
import { sourceLabel } from '../lib/tokens';
import '../i18n/data-management-messages';
import '../i18n/insights-messages';

const route = '/functions/tud-local-admin/backup';
type Capabilities = { token: string; dataDir: string; suggestedTarget: string; protectedRestore?: boolean };
function errorKey(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  if (code === 'BACKUP_TARGET_EXISTS') return 'backup.exists';
  if (code === 'BACKUP_PROTECTION_FAILED') return 'backup.protectionFailed';
  if (code === 'BACKUP_RUNTIME_ACTIVE') return 'backup.active';
  if (code === 'BACKUP_BUSY') return 'backup.locked';
  if (code === 'BACKUP_TARGET_ABSOLUTE') return 'backup.path';
  if (code.includes('TOO_LARGE')) return 'backup.tooLarge';
  if (code.startsWith('BACKUP_')) return 'backup.invalid';
  return 'admin.failed';
}

export function LocalBackupPanel() {
  const { t, i18n } = useTranslation();
  const id = useId(), [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [reload, setReload] = useState(0), [target, setTarget] = useState('');
  const [backup, setBackup] = useState<DataBackup | null>(null), [summary, setSummary] = useState<BackupSummary | null>(null);
  const [fileName, setFileName] = useState(''), [phase, setPhase] = useState<'idle' | 'create' | 'verify' | 'restore' | 'protectRestore'>('idle'), [error, setError] = useState(''), [notice, setNotice] = useState(''), [restored, setRestored] = useState('');
  const [protect, setProtect] = useState(true), [protectionPath, setProtectionPath] = useState('');
  const working = useRef(false), busy = phase !== 'idle';
  const panel = useRef<HTMLElement>(null), restoreFocus = useRef(false);
  useEffect(() => {
    if (busy) restoreFocus.current = true;
    else if (restoreFocus.current) { restoreFocus.current = false; panel.current?.focus({ preventScroll: true }); }
  }, [busy]);
  const demo = isDemoMode();
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    void request<Capabilities>(route, { signal: controller.signal }).then(data => { if (!controller.signal.aborted) { setCapabilities(data); setTarget(data.suggestedTarget); setError(''); } })
      .catch(() => { if (!controller.signal.aborted) setError('admin.localOnly'); });
    return () => controller.abort();
  }, [demo, reload]);
  if (demo) return null;
  const post = <T,>(body: unknown) => request<T>(route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Quotern-Local-Admin': capabilities!.token }, body: JSON.stringify(body) });
  const begin = (next: typeof phase) => { if (working.current || !capabilities) return false; working.current = true; setPhase(next); setError(''); setNotice(''); setRestored(''); setProtectionPath(''); return true; };
  const finish = () => { working.current = false; setPhase('idle'); };
  const create = async () => {
    if (!begin('create')) return;
    try {
      const result = await post<{ backup: DataBackup; summary: BackupSummary }>({ action: 'create' });
      const name = `quotern-backup-${result.backup.createdAt.slice(0, 10)}.json`;
      const url = URL.createObjectURL(new Blob([JSON.stringify(result.backup)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setBackup(result.backup); setSummary(result.summary); setFileName(name); setNotice('backup.downloaded');
    } catch (error) { setError(errorKey(error)); }
    finally { finish(); }
  };
  const verify = async (file: File) => {
    if (!begin('verify')) return;
    setBackup(null); setSummary(null); setFileName(file.name);
    try {
      if (file.size > 256 * 1024 * 1024) throw new Error('BACKUP_TOO_LARGE');
      let input: unknown; try { input = JSON.parse(await file.text()); } catch { throw new Error('BACKUP_INVALID'); }
      const result = await post<BackupSummary>({ action: 'verify', backup: input });
      setBackup(input as DataBackup); setSummary(result);
    } catch (error) { setError(errorKey(error)); }
    finally { finish(); }
  };
  const restore = async () => {
    if (!backup) return;
    const withProtection = protect && capabilities?.protectedRestore;
    if (!begin(withProtection ? 'protectRestore' : 'restore')) return;
    try {
      if (withProtection) {
        const result = await post<ProtectedRestoreResult>({ action: 'restore-protected', backup, target });
        setProtectionPath(result.protection.path);
        if (result.restore.ok) setRestored(result.restore.target);
        else setError(errorKey(new Error(result.restore.code)));
      } else { const result = await post<BackupSummary & { target: string }>({ action: 'restore', backup, target }); setRestored(result.target); }
    }
    catch (error) { setError(errorKey(error)); }
    finally { finish(); }
  };
  return <section ref={panel} tabIndex={-1} aria-label={t('backup.title')} className="space-y-3 rounded-xl bg-surface-secondary p-4">
    <div className="flex items-center gap-2"><h3 className="text-sm font-medium">{t('backup.title')}</h3><HelpPopover title={t('backup.title')}><p>{t('backup.help')}</p></HelpPopover></div>
    <Button size="sm" variant="secondary" onPress={() => void create()} isDisabled={!capabilities || busy}>{t('backup.create')}</Button>
    <div className="space-y-1"><label htmlFor={id} className="block text-xs text-muted">{t('backup.pick')}</label><input id={id} type="file" accept="application/json,.json" disabled={!capabilities || busy} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void verify(file); event.currentTarget.value = ''; }} className="block w-full min-w-0 rounded-md border border-separator p-2 text-xs file:mr-2 file:rounded file:border-0 file:bg-surface file:px-2 file:py-1 file:text-foreground" /></div>
    {busy && <p role="status" className="text-sm text-muted">{t(`backup.phase.${phase}`)}</p>}
    {summary && <div className="space-y-3 border-t border-separator pt-3"><div><p className="break-all text-sm font-medium">{fileName}</p><p className="mt-1 text-xs text-muted">{t('backup.verified', { count: summary.fileCount, size: (summary.bytes / 1024 / 1024).toLocaleString(i18n.resolvedLanguage, { maximumFractionDigits: 2 }) })} · {new Date(summary.createdAt).toLocaleString(i18n.resolvedLanguage)}</p></div>
      {summary.contents && <div data-backup-preview className="space-y-2 rounded-lg bg-surface p-3 text-xs">
        <p>{summary.contents.from && summary.contents.to ? t('backup.coverage', { from: new Date(summary.contents.from).toLocaleString(i18n.resolvedLanguage, { timeZone: 'UTC' }), to: new Date(summary.contents.to).toLocaleString(i18n.resolvedLanguage, { timeZone: 'UTC' }), count: summary.contents.usageRows }) : t('backup.noUsage')}</p>
        {summary.contents.sources.length > 0 && <p className="break-words">{t('backup.sources', { sources: summary.contents.sources.map(sourceLabel).join(' · ') })}</p>}
        {summary.contents.sourcesTruncated && <p className="text-muted">{t('backup.sourcesTruncated')}</p>}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">{summary.contents.categories.map(category => <div key={category.kind} className="flex justify-between gap-2"><dt className="text-muted">{t(`backup.category.${category.kind}`)}</dt><dd>{t('backup.files', { count: category.files })}</dd></div>)}</dl>
      </div>}
      <TextField value={target} onChange={value => { setTarget(value); setError(''); setRestored(''); }} isDisabled={busy}><Label className="text-xs">{t('backup.target')}</Label><Input className="min-w-0 text-sm" /></TextField>
      <p className="text-xs text-muted">{t('backup.note')}</p>
      {capabilities?.protectedRestore && <Checkbox isSelected={protect} onChange={setProtect} isDisabled={busy}><Checkbox.Content><Checkbox.Control><Checkbox.Indicator /></Checkbox.Control><span className="text-xs">{t('backup.protect')}</span></Checkbox.Content></Checkbox>}
      <Button size="sm" variant="secondary" isDisabled={busy || !target.trim() || Boolean(restored)} onPress={() => void restore()}>{t('backup.restore')}</Button>
    </div>}
    {error && <div role="alert" className="space-y-2"><p className="text-sm text-danger">{t(error)}</p>{!capabilities && <Button size="sm" variant="secondary" onPress={() => setReload(value => value + 1)}>{t('insights.retry')}</Button>}</div>}
    {notice && <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">{t(notice)}</p>}
    {protectionPath && <p role="status" className="break-all text-sm text-emerald-700 dark:text-emerald-400">{t('backup.protected')} {protectionPath}</p>}
    {restored && <p role="status" className="break-all text-sm text-emerald-700 dark:text-emerald-400">{t('backup.restored')} {restored}</p>}
  </section>;
}
