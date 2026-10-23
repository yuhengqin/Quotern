import { useEffect, useState } from 'react';
import { Button, Modal } from '@heroui/react';
import { useTranslation } from 'quotern-i18n/react';
import type { ContextAudit, SessionActivity } from 'quotern-core';
import { request } from '@/lib/api';

export function SessionInsightDetails({ row }: { row: SessionActivity }) {
  const { t, i18n }=useTranslation();
  const [feedback,setFeedback]=useState('');
  const [directory,setDirectory]=useState<string|null>(null);
  useEffect(()=>{let active=true;setDirectory(null);if(['codex','claude','dsh'].includes(row.source)){const query=new URLSearchParams({source:row.source,sessionId:row.sessionId});void request<{directory:string|null}>(`/functions/tud-session-directory?${query}`).then(result=>{if(active)setDirectory(result.directory);}).catch(()=>{});}return()=>{active=false;};},[row.source,row.sessionId]);
  const insight=row.insights;
  const show=(value:number|null|undefined,suffix='')=>value==null?'—':`${value.toLocaleString(i18n.resolvedLanguage,{maximumFractionDigits:3})}${suffix}`;
  const copy=async(value:string)=>{try{await navigator.clipboard.writeText(value);setFeedback(t('usage.insights.copied'));}catch{setFeedback(t('usage.insights.copyFailed'));}};
  if(!insight)return <p className="text-xs text-muted">{t('usage.insights.unknown')}</p>;
  const metrics:[string,string][]=[
    ['usage.insights.own',`${show(insight.ownTokens)} Token · ${show(insight.ownCostUsd,' USD')}`],
    ['usage.insights.subagent',`${show(insight.subagentTokens)} Token · ${show(insight.subagentCostUsd,' USD')}`],
    ['usage.insights.combined',`${show(insight.combinedTokens)} Token · ${insight.combinedCostUsd==null?insight.combinedKnownCostUsd>0?`≥ ${show(insight.combinedKnownCostUsd,' USD')}`:t('usage.activity.amountUnknown'):show(insight.combinedCostUsd,' USD')}`],
    ['usage.insights.messageCount',show(insight.messageCount)],
    ['usage.insights.firstActivity',insight.firstActivityAt?new Date(insight.firstActivityAt).toLocaleString(i18n.resolvedLanguage):'—'],
    ['usage.insights.speed',`${show(insight.performance.tokensPerSecond,' token/s')} · ${t('usage.insights.samples')}: ${insight.performance.estimatedRequestCount} · ${show(insight.performance.estimatedDurationMs,' ms')}`],
    ['usage.insights.ttft',`${show(insight.performance.ttftMs,' ms')} · ${t('usage.insights.samples')}: ${insight.performance.ttftSampleCount}`],
    ['usage.insights.toolCalls',show(insight.signals.toolCalls)],['usage.insights.editTurns',show(insight.signals.editTurns)],
    ['usage.insights.retryTurns',show(insight.signals.retryTurns)],['usage.insights.firstPass',insight.signals.firstPass==null?'—':String(insight.signals.firstPass)],
    ['usage.insights.errorCount',show(insight.signals.errorCount)],['usage.insights.compactionCount',show(insight.signals.compactionCount)],
    ['usage.insights.costPerEdit',show(insight.signals.costPerEdit,' USD')],['usage.insights.tokensPerEdit',show(insight.signals.tokensPerEdit)],
  ];
  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2">
      {insight.resumeCommand&&<Button size="sm" variant="secondary" onPress={()=>void copy(insight.resumeCommand!)}>{t('usage.insights.copyResume')}</Button>}
      {directory&&<Button size="sm" variant="secondary" onPress={()=>void copy(directory)}>{t('usage.insights.copyDirectory')}</Button>}
      <p role="status" className="self-center text-xs text-muted">{feedback}</p>
    </div>
    {insight.resumeCommand&&<code className="block break-all rounded-lg bg-surface-secondary p-3 text-xs">{insight.resumeCommand}</code>}
    {directory&&<p className="break-all text-xs text-muted">{directory}</p>}
    {(insight.parentId||insight.agentRole||insight.agentNickname)&&<p className="break-all text-xs text-muted">{t(`usage.insights.${insight.relationKind==='fork'?'relationFork':insight.relationKind==='subagent'?'relationSubagent':'relationUnknown'}`)} · {[insight.agentNickname,insight.agentRole,insight.parentId].filter(Boolean).join(' · ')}</p>}
    <dl className="grid gap-3 rounded-xl border border-separator p-3 sm:grid-cols-2">{metrics.map(([label,value])=><div key={label} className="min-w-0"><dt className="text-xs text-muted">{t(label)}</dt><dd className="mt-1 break-words text-sm tabular-nums">{value}</dd></div>)}</dl>
    <p className="text-xs text-muted">{t('usage.insights.evidenceNote')}</p>
    <div className="space-y-2 rounded-xl border border-separator p-3">
      <p className="text-xs text-muted">{t('usage.insights.priceNote')}</p>
      {row.models?.map(model=>model.pricing&&<details key={model.model} className="text-xs"><summary className="cursor-pointer py-2 font-medium">{model.model} · {model.pricing.table??'—'} · {model.pricing.matchedModel??'—'}</summary>
        <dl className="grid grid-cols-2 gap-2 p-2">{Object.entries(model.pricing.rates??{}).map(([key,rate])=><div key={key}><dt>{key} / 1M Token</dt><dd className="tabular-nums">${rate}</dd></div>)}</dl>
        <p className="break-words text-muted">{model.pricing.matchMethod} · {model.pricing.ruleReferences.join(' · ')}</p>
        {model.pricing.assumptions?.includes('grok-80-20')&&<p className="text-muted">{t('usage.insights.grokCostAssumption')}</p>}
        {model.pricing.unpricedTokens>0&&<p className="text-warning">{t('usage.overview.unpriced')}: {model.pricing.unpricedTokens.toLocaleString(i18n.resolvedLanguage)} Token</p>}
      </details>)}
    </div>
  </div>;
}

export function ContextAuditButton(){
  const {t}=useTranslation();const [open,setOpen]=useState(false),[data,setData]=useState<ContextAudit|null>(null),[error,setError]=useState(false);
  const load=async()=>{setOpen(true);setError(false);try{setData(await request<ContextAudit>('/functions/tud-context-audit'));}catch{setError(true);}};
  return <><Button size="sm" variant="tertiary" onPress={()=>void load()}>{t('usage.insights.contextAudit')}</Button>
    <Modal isOpen={open} onOpenChange={setOpen}><Modal.Backdrop><Modal.Container><Modal.Dialog className="max-w-3xl"><Modal.CloseTrigger/><Modal.Header><Modal.Heading>{t('usage.insights.contextAudit')}</Modal.Heading></Modal.Header><Modal.Body className="space-y-4">
      <p className="text-sm text-muted">{t('usage.insights.contextNote')}</p>
      {error?<p role="status">{t('usage.activity.readError')}</p>:!data?<p role="status">{t('usage.activity.loading')}</p>:<>
        <p>{t('usage.insights.discoveredTokens')}: {data.estimatedDiscoveredTokens.toLocaleString()} · {t('usage.insights.actualUnknown')}</p>
        <p className="text-xs text-muted">MCP: {data.mcp.declaredServerCount} · {data.discoveredBytes.toLocaleString()} bytes</p>
        {(data.truncated||data.unreadableCount>0)&&<p role="status" className="text-xs text-warning">{t('usage.insights.auditTruncated')}</p>}
        <ul className="divide-y divide-separator">{data.items.map((item,index)=><li key={index} className="flex min-w-0 justify-between gap-3 py-2 text-xs"><span className="min-w-0 break-all">{item.name}</span><span className="shrink-0 tabular-nums">{item.bytes} B · {item.estimatedTokens??'—'} Token</span></li>)}</ul>
      </>}
    </Modal.Body></Modal.Dialog></Modal.Container></Modal.Backdrop></Modal>
  </>;
}
