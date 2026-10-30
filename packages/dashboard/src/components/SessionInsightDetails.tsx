import { useEffect, useRef, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import type { ContextAudit } from 'quotern-core';
import { request } from '@/lib/api';
import { formatSessionTokens } from '@/lib/session-metric-format';

export { SessionDetailDialog as SessionInsightDetails } from './SessionDetailDialog';

export function ContextAuditButton() {
  const { t, i18n } = useTranslation();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<ContextAudit | null>(null);
  const [error, setError] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const load = async () => {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    setOpen(true); setData(null); setError(false);
    try {
      const result = await request<ContextAudit>('/functions/tud-context-audit', { signal: current.signal });
      if (!current.signal.aborted) setData(result);
    } catch { if (!current.signal.aborted) setError(true); }
  };
  return <>
    <Button size="sm" variant="ghost" className="!h-8 !min-h-8 !px-2 !text-xs" onPress={() => void load()}>{t('usage.insights.contextAudit')}</Button>
    <Modal isOpen={open} onOpenChange={next => { setOpen(next); if (!next) controller.current?.abort(); }}>
      <Modal.Backdrop><Modal.Container scroll="inside"><Modal.Dialog className="max-w-3xl">
        <Modal.CloseTrigger aria-label={t('usage.detail.close')} />
        <Modal.Header><Modal.Heading>{t('usage.insights.contextAudit')}</Modal.Heading></Modal.Header>
        <Modal.Body className="space-y-4">
          <p className="text-sm text-muted">{t('usage.insights.contextNote')}</p>
          {error ? <div className="space-y-2"><p role="status">{t('usage.activity.readError')}</p><Button size="sm" variant="secondary" onPress={() => void load()}>{t('usage.detail.retry')}</Button></div> : !data ? <p role="status">{t('usage.activity.loading')}</p> : <>
            <p>{t('usage.insights.discoveredTokens')}: {formatSessionTokens(data.estimatedDiscoveredTokens)} · {t('usage.insights.actualUnknown')}</p>
            <p className="text-xs text-muted">MCP: {data.mcp.declaredServerCount} · {data.discoveredBytes.toLocaleString(i18n.language)} bytes</p>
            {(data.truncated || data.unreadableCount > 0) && <div className="space-y-2">
              <p role="status" className="text-xs text-warning">{data.diagnostics ? t('usage.insights.auditCounts', { skipped: data.truncatedCount ?? 0, unreadable: data.unreadableCount }) : t('usage.insights.auditTruncated')}</p>
              {data.diagnostics?.length ? <details className="rounded-lg border border-separator p-3 text-xs">
                <summary className="cursor-pointer rounded font-medium outline-offset-4 focus-visible:outline-2">{t('usage.insights.auditDetails')}</summary>
                <p className="mt-2 leading-5 text-muted">{t('usage.insights.auditCoverage')}</p>
                <ul className="mt-2 divide-y divide-separator">{data.diagnostics.map((item, index) => <li key={index} className="space-y-1 py-2">
                  <p className="break-all font-mono">{item.name}</p>
                  <p>{t(`usage.insights.auditReason.${item.reason}`)}{item.errorCode && <span className="ml-1 font-mono text-muted">({item.errorCode})</span>}</p>
                  <p className="text-muted">{t(item.reason === 'invalid_json' ? 'usage.insights.auditMcpImpact' : item.target === 'directory' ? 'usage.insights.auditDirectoryImpact' : 'usage.insights.auditFileImpact')}</p>
                </li>)}</ul>
                {data.diagnosticsTruncated && <p className="text-warning">{t('usage.insights.auditDetailsLimited')}</p>}
              </details> : <p className="text-xs text-muted">{t('usage.insights.auditNoDetails')}</p>}
            </div>}
            <ul className="divide-y divide-separator">{data.items.map((item, index) => <li key={index} className="flex min-w-0 flex-wrap justify-between gap-x-3 gap-y-1 py-2 text-xs"><span className="min-w-0 break-all">{item.name}</span><span className="shrink-0 tabular-nums">{item.bytes} B · {formatSessionTokens(item.estimatedTokens)} Token</span></li>)}</ul>
          </>}
        </Modal.Body>
      </Modal.Dialog></Modal.Container></Modal.Backdrop>
    </Modal>
  </>;
}
