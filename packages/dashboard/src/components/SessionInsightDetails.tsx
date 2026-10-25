import { useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import type { ContextAudit } from 'quotern-core';
import { request } from '@/lib/api';
import { formatSessionTokens } from '@/lib/session-metric-format';

export { SessionDetailDialog as SessionInsightDetails } from './SessionDetailDialog';

export function ContextAuditButton(){
  const {t}=useTranslation();const [open,setOpen]=useState(false),[data,setData]=useState<ContextAudit|null>(null),[error,setError]=useState(false);
  const load=async()=>{setOpen(true);setError(false);try{setData(await request<ContextAudit>('/functions/tud-context-audit'));}catch{setError(true);}};
  return <><Button size="sm" variant="tertiary" onPress={()=>void load()}>{t('usage.insights.contextAudit')}</Button>
    <Modal isOpen={open} onOpenChange={setOpen}><Modal.Backdrop><Modal.Container><Modal.Dialog className="max-w-3xl"><Modal.CloseTrigger/><Modal.Header><Modal.Heading>{t('usage.insights.contextAudit')}</Modal.Heading></Modal.Header><Modal.Body className="space-y-4">
      <p className="text-sm text-muted">{t('usage.insights.contextNote')}</p>
      {error?<p role="status">{t('usage.activity.readError')}</p>:!data?<p role="status">{t('usage.activity.loading')}</p>:<>
        <p>{t('usage.insights.discoveredTokens')}: {formatSessionTokens(data.estimatedDiscoveredTokens)} · {t('usage.insights.actualUnknown')}</p>
        <p className="text-xs text-muted">MCP: {data.mcp.declaredServerCount} · {data.discoveredBytes.toLocaleString()} bytes</p>
        {(data.truncated||data.unreadableCount>0)&&<p role="status" className="text-xs text-warning">{t('usage.insights.auditTruncated')}</p>}
        <ul className="divide-y divide-separator">{data.items.map((item,index)=><li key={index} className="flex min-w-0 justify-between gap-3 py-2 text-xs"><span className="min-w-0 break-all">{item.name}</span><span className="shrink-0 tabular-nums">{item.bytes} B · {formatSessionTokens(item.estimatedTokens)} Token</span></li>)}</ul>
      </>}
    </Modal.Body></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
  </>;
}
