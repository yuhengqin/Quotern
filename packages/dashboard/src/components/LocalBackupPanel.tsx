import { useEffect, useId, useRef, useState } from 'react';
import { Button, Input, Label, TextField } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import type { BackupSummary, DataBackup } from 'quotern-core';
import { request } from '@/lib/api';
import { isDemoMode } from '@/lib/demo-runtime';
import { HelpPopover } from './HelpPopover';
import '../i18n/data-management-messages';
import '../i18n/insights-messages';

const route = '/functions/tud-local-admin/backup';
type Capabilities = { token: string; dataDir: string; suggestedTarget: string };
function errorKey(error: unknown) {
  const code = error instanceof Error ? error.message : '';
  if (code === 'BACKUP_TARGET_EXISTS') return 'backup.exists';
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
  const [fileName, setFileName] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState(''), [restored, setRestored] = useState('');
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
  const create = async () => {
    setBusy(true); setError(''); setNotice(''); setRestored('');
    try {
      const result = await post<{ backup: DataBackup; summary: BackupSummary }>({ action: 'create' });
      const name = `quotern-backup-${result.backup.createdAt.slice(0, 10)}.json`;
      const url = URL.createObjectURL(new Blob([JSON.stringify(result.backup)], { type: 'application/json' }));
      const link = document.createElement('a'); link.href = url; link.download = name; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
      setBackup(result.backup); setSummary(result.summary); setFileName(name); setNotice('backup.downloaded');
    } catch (error) { setError(errorKey(error)); }
    finally { setBusy(false); }
  };
  const verify = async (file: File) => {
    setBusy(true); setError(''); setNotice(''); setRestored(''); setBackup(null); setSummary(null); setFileName(file.name);
    try {
      if (file.size > 256 * 1024 * 1024) throw new Error('BACKUP_TOO_LARGE');
      let input: unknown; try { input = JSON.parse(await file.text()); } catch { throw new Error('BACKUP_INVALID'); }
      const result = await post<BackupSummary>({ action: 'verify', backup: input });
      setBackup(input as DataBackup); setSummary(result);
    } catch (error) { setError(errorKey(error)); }
    finally { setBusy(false); }
  };
  const restore = async () => {
    if (!backup) return;
    setBusy(true); setError(''); setNotice(''); setRestored('');
    try { const result = await post<BackupSummary & { target: string }>({ action: 'restore', backup, target }); setRestored(result.target); }
    catch (error) { setError(errorKey(error)); }
    finally { setBusy(false); }
  };
  return <section ref={panel} tabIndex={-1} aria-label={t('backup.title')} className="space-y-3 rounded-xl bg-surface-secondary p-4">
    <div className="flex items-center gap-2"><h3 className="text-sm font-medium">{t('backup.title')}</h3><HelpPopover title={t('backup.title')}><p>{t('backup.help')}</p></HelpPopover></div>
    <Button size="sm" variant="secondary" onPress={() => void create()} isDisabled={!capabilities || busy}>{t('backup.create')}</Button>
    <div className="space-y-1"><label htmlFor={id} className="block text-xs text-muted">{t('backup.pick')}</label><input id={id} type="file" accept="application/json,.json" disabled={!capabilities || busy} onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void verify(file); event.currentTarget.value = ''; }} className="block w-full min-w-0 rounded-md border border-separator p-2 text-xs file:mr-2 file:rounded file:border-0 file:bg-surface file:px-2 file:py-1 file:text-foreground" /></div>
    {busy && <p role="status" className="text-sm text-muted">{t('backup.busy')}</p>}
    {summary && <div className="space-y-3 border-t border-separator pt-3"><div><p className="break-all text-sm font-medium">{fileName}</p><p className="mt-1 text-xs text-muted">{t('backup.verified', { count: summary.fileCount, size: (summary.bytes / 1024 / 1024).toLocaleString(i18n.resolvedLanguage, { maximumFractionDigits: 2 }) })} · {new Date(summary.createdAt).toLocaleString(i18n.resolvedLanguage)}</p></div>
      <TextField value={target} onChange={value => { setTarget(value); setError(''); setRestored(''); }} isDisabled={busy}><Label className="text-xs">{t('backup.target')}</Label><Input className="min-w-0 text-sm" /></TextField>
      <p className="text-xs text-muted">{t('backup.note')}</p><Button size="sm" variant="secondary" isDisabled={busy || !target.trim() || Boolean(restored)} onPress={() => void restore()}>{t('backup.restore')}</Button>
    </div>}
    {error && <div role="alert" className="space-y-2"><p className="text-sm text-danger">{t(error)}</p>{!capabilities && <Button size="sm" variant="secondary" onPress={() => setReload(value => value + 1)}>{t('insights.retry')}</Button>}</div>}
    {notice && <p role="status" className="text-sm text-success">{t(notice)}</p>}
    {restored && <p role="status" className="break-all text-sm text-success">{t('backup.restored')} {restored}</p>}
  </section>;
}
