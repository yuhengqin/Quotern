import { useEffect, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import type { AgentActivity } from 'quotern-core/agent/activity';
import { request } from '@/lib/api';
import { isDemoMode } from '@/lib/demo-runtime';
import { HelpPopover } from './HelpPopover';
import '../i18n/quota-experience-messages';

export function AgentActivityList() {
  const { t, i18n } = useTranslation(), [rows, setRows] = useState<AgentActivity[] | null>(null), [error, setError] = useState(false), [retry, setRetry] = useState(0), [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const controller = new AbortController(); let pending = false;
    const load = async () => {
      if (document.hidden || pending) return; pending = true;
      try { const next = await request<AgentActivity[]>('/functions/tud-agent/activity', { signal: controller.signal }); if (!controller.signal.aborted) { setRows(next); setError(false); } }
      catch { if (!controller.signal.aborted) setError(true); } finally { pending = false; }
    };
    void load(); const timer = window.setInterval(() => { setNow(Date.now() / 1000); void load(); }, 5000); const visible = () => { if (!document.hidden) { setNow(Date.now() / 1000); void load(); } };
    document.addEventListener('visibilitychange', visible);
    return () => { controller.abort(); clearInterval(timer); document.removeEventListener('visibilitychange', visible); };
  }, [retry]);
  return <div className="space-y-3" data-agent-activity>
    <div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-medium">{t('experience.activity')}</h3><HelpPopover title={t('experience.activity')}><p>{t('experience.activityHelp')}</p></HelpPopover><Button size="sm" variant="ghost" className="ml-auto" onPress={() => setRetry(value => value + 1)}>{t(error ? 'agent.retry' : 'usage.quota.refresh')}</Button></div>
    {error && <p role="status" className="text-xs text-danger">{t('agent.failed')}</p>}
    {!rows && !error && <p role="status" className="text-xs text-muted">{t('agent.load')}</p>}
    {rows?.length === 0 && <p className="text-xs text-muted">{t('experience.activityEmpty')}</p>}
    <ul className="space-y-2">{rows?.map(row => <li key={`${row.source}:${row.sessionId}`} className="min-w-0 rounded-xl bg-surface-secondary p-3 text-xs">
      <div className="flex flex-wrap justify-between gap-2"><span className="break-words font-medium">{row.project || t('experience.unknownProject')}</span><span>{row.source === 'claude' ? 'Claude Code' : 'Codex'}</span></div>
      <p className={`mt-1 ${row.stale || error || now - row.observedAt > 120 ? 'text-muted' : row.state === 'approval-requested' || row.state === 'tool-error' ? 'text-warning' : 'text-foreground'}`}>{row.stale || error || now - row.observedAt > 120 ? t('experience.stale') : t(`experience.${row.state}`)}{row.tool ? ` · ${row.tool}` : ''}</p>
      <p className="mt-1 flex flex-wrap justify-between gap-2 tabular-nums text-muted"><span>{t('experience.elapsed', { minutes: Math.max(0, Math.floor((row.observedAt - row.startedAt) / 60)) })}</span><time dateTime={new Date(row.observedAt * 1000).toISOString()}>{new Date(row.observedAt * 1000).toLocaleTimeString(i18n.resolvedLanguage)}</time></p>
    </li>)}</ul>
  </div>;
}

export function AgentActivityButton() {
  const { t } = useTranslation(), [open, setOpen] = useState(false);
  if (isDemoMode()) return null;
  return <><Button size="sm" variant="ghost" className="h-7 text-xs" onPress={() => setOpen(true)} aria-haspopup="dialog">{t('experience.activity')}</Button><Modal.Backdrop isOpen={open} onOpenChange={setOpen}><Modal.Container placement="center" scroll="inside"><Modal.Dialog aria-label={t('experience.activity')} className="w-full max-w-lg"><Modal.CloseTrigger aria-label={t('usage.quota.closeDetails')} /><Modal.Header><Modal.Heading>{t('experience.activity')}</Modal.Heading></Modal.Header><Modal.Body>{open && <AgentActivityList />}</Modal.Body></Modal.Dialog></Modal.Container></Modal.Backdrop></>;
}
