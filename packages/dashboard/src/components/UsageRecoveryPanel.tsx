import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import { request } from '@/lib/api';
import { isDemoMode } from '@/lib/demo-runtime';
import { dispatchDataSynced } from '../lib/shell-events';
import { formatTokens } from '../lib/format';
import { HelpPopover } from './HelpPopover';
import '../i18n/data-management-messages';
import '../i18n/usage-recovery-messages';

const route = '/functions/tud-local-admin/usage-recovery';
type Preview = { id: string | null; tokens: number; requests: number; duplicate: number; uncertain: number; skippedFiles: number; days: { date: string; tokens: number }[]; dayCount: number };
type Result = { tokens: number; requests: number; refreshed: boolean };
const errorKey = (value: unknown) => {
  const code = value instanceof Error ? value.message : '';
  if (code.includes('TOO_LARGE')) return 'recovery.tooLarge';
  if (code === 'RECOVERY_STORE_FULL') return 'recovery.storeFull';
  if (code === 'RECOVERY_PREVIEW_CHANGED') return 'recovery.changed';
  if (code === 'RECOVERY_OWNER_REQUIRED') return 'recovery.owner';
  if (code === 'RECOVERY_BUSY') return 'backup.locked';
  if (code === 'RECOVERY_INVALID') return 'recovery.unsupported';
  return 'admin.failed';
};

export function UsageRecoveryPanel() {
  const { t } = useTranslation();
  const id = useId(), demo = isDemoMode();
  const [capabilities, setCapabilities] = useState<{ token: string; enabled: boolean } | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [phase, setPhase] = useState<'preview' | 'apply' | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const working = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (demo) return;
    const controller = new AbortController();
    void request<{ token: string; enabled: boolean }>(route, { signal: controller.signal }).then(value => { if (!controller.signal.aborted) setCapabilities(value); })
      .catch(() => { if (!controller.signal.aborted) setUnavailable(true); });
    return () => controller.abort();
  }, [demo]);
  useEffect(() => { if (!phase && (preview || result || error)) feedback.current?.focus({ preventScroll: true }); }, [phase, preview, result, error]);
  if (demo) return null;
  const perform = async (action: 'preview' | 'apply') => {
    if (working.current || !capabilities?.enabled || (action === 'preview' ? !files.length : !preview?.id)) return;
    working.current = true;
    setError(''); setResult(null); setPhase(action);
    if (action === 'preview') setPreview(null);
    const post = <T,>(body: unknown) => request<T>(route, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Quotern-Local-Admin': capabilities.token }, body: JSON.stringify(body) });
    try {
      if (action === 'preview') {
        if (files.length > 20 || files.reduce((sum, file) => sum + file.size, 0) > 8 * 1024 * 1024) throw new Error('RECOVERY_TOO_LARGE');
        if (files.some(file => !/\.jsonl$/i.test(file.name))) throw new Error('RECOVERY_INVALID');
        setPreview(await post<Preview>({ action, files: await Promise.all(files.map(file => file.text())) }));
      } else {
        setResult(await post<Result>({ action, id: preview!.id }));
        setPreview(null);
        dispatchDataSynced();
      }
    } catch (reason) {
      if (reason instanceof Error && reason.message === 'RECOVERY_PREVIEW_CHANGED') setPreview(null);
      setError(errorKey(reason));
    } finally { working.current = false; setPhase(null); }
  };

  return <section aria-labelledby={`${id}-title`} className="space-y-3 rounded-xl bg-surface-secondary p-4">
    <div className="flex items-center gap-2"><h3 id={`${id}-title`} className="text-sm font-medium">{t('recovery.title')}</h3><HelpPopover title={t('recovery.title')}><p>{t('recovery.help')}</p></HelpPopover></div>
    {unavailable ? <p className="text-xs text-muted">{t('admin.localOnly')}</p> : capabilities?.enabled === false ? <p className="text-xs text-muted">{t('recovery.owner')}</p> : <>
      <div className="space-y-1"><label htmlFor={id} className="block text-xs text-muted">{t('recovery.choose')}</label>
        <input id={id} type="file" multiple accept=".jsonl,application/x-ndjson" disabled={!capabilities || Boolean(phase)} onChange={event => {
          setFiles(Array.from(event.currentTarget.files ?? [])); setPreview(null); setResult(null); setError('');
        }} className="block w-full min-w-0 rounded-md border border-separator p-2 text-xs file:mr-2 file:rounded file:border-0 file:bg-surface file:px-2 file:py-1 file:text-foreground" />
      </div>
      <Button size="sm" variant="secondary" onPress={() => void perform('preview')} isDisabled={!capabilities || !files.length || Boolean(phase)}>{t('recovery.preview')}</Button>
    </>}
    {phase && <p role="status" className="text-sm text-muted">{t(phase === 'preview' ? 'recovery.scanning' : 'recovery.applying')}</p>}
    <div ref={feedback} tabIndex={-1} className="space-y-2 empty:hidden">
      {error && <p role="alert" className="text-sm text-danger">{t(error)}</p>}
      {preview && <div className="space-y-2 border-t border-separator pt-3 text-sm">
        <p className="font-medium">{preview.id ? t('recovery.total', { tokens: formatTokens(preview.tokens), count: preview.requests }) : t('recovery.empty')}</p>
        {(preview.duplicate > 0 || preview.uncertain > 0 || preview.skippedFiles > 0) && <p className="text-xs text-muted">{t('recovery.excluded', { duplicate: preview.duplicate, uncertain: preview.uncertain, files: preview.skippedFiles })}</p>}
        {preview.days.length > 0 && <details className="text-xs"><summary className="w-fit cursor-pointer text-muted">{t('recovery.dates')}</summary>
          <dl className="mt-2 max-h-40 space-y-1 overflow-y-auto pr-2">{preview.days.map(day => <div key={day.date} className="flex flex-wrap justify-between gap-2"><dt>{day.date}</dt><dd>{formatTokens(day.tokens)} Token</dd></div>)}</dl>
          {preview.dayCount > preview.days.length && <p className="mt-1 text-muted">{t('recovery.moreDates', { shown: preview.days.length, total: preview.dayCount })}</p>}
        </details>}
        {preview.id && <Button size="sm" variant="primary" isDisabled={Boolean(phase)} onPress={() => void perform('apply')}>{t('recovery.confirm')}</Button>}
      </div>}
      {result && <p role="status" className="text-sm">{t('recovery.applied', { tokens: formatTokens(result.tokens), count: result.requests })}{!result.refreshed && <> · {t('recovery.refreshPending')}</>}</p>}
    </div>
  </section>;
}
