import { readFile } from 'node:fs/promises';
import { configPath } from './paths.js';
import { loadBucketsForRange } from './queue/index.js';
import { localDateDaysAgo, localDateNow,localDateAndHour } from './timezone.js';
import { readSessionHistory } from './session-collector.js';
import { aggregateSessionActivity } from './session-observation.js';
import { attachSessionTitles } from './session-titles.js';
import { enrichSessionInsights } from './session-insights.js';
import { loadCachedPricingOverlay,computeTokens } from './pricing/index.js';

/** Persisted snapshots only: no config initialization, runtime locks, sync or network. */
export async function readSessionReport(dataDir: string, query: { days?: number; fromDate?: string; toDate?: string; sources?: readonly string[]; model?: string; project?: string } = {}) {
  const config = JSON.parse(await readFile(configPath(dataDir),'utf8')) as Record<string,unknown>;
  const since=String(config.localCollectSince??config.statsSince??'');
  if(!Number.isFinite(Date.parse(since)))throw new Error('invalid_session_report_config');
  const requestedFrom=query.fromDate??localDateDaysAgo(query.days??7),collectDate=localDateAndHour(since).date;
  const fromDate=requestedFrom>collectDate?requestedFrom:collectDate,toDate=query.toDate??localDateNow();
  const inRange=(stamp:string)=>{const date=localDateAndHour(stamp).date;return date>=fromDate&&date<=toDate;};
  const options={fromDate,toDate,sources:query.sources};
  const buckets=(await loadBucketsForRange(dataDir,since)).filter(r=>(!query.sources?.length||query.sources.includes(r.source))&&inRange(r.hour_start));
  loadCachedPricingOverlay(dataDir);
  const history=await readSessionHistory(dataDir,[...new Set(buckets.map(r=>r.source))],options);
  const report=aggregateSessionActivity(history.observations,history.messages,{...options,missingSources:history.missingSources,totalTokens:buckets.reduce((s,r)=>s+computeTokens(r),0)});
  await attachSessionTitles(report.sessions,history.titles);
  enrichSessionInsights(report.sessions,history.messages.filter(m=>inRange(m.timestamp)),history.evidence.filter(e=>e.kind==='metadata'||inRange(e.timestamp)));
  report.sessions=report.sessions.filter(r=>(!query.model||r.models?.some(m=>m.model===query.model)||r.model===query.model)&&(!query.project||r.projectLabel===query.project));
  return report;
}
