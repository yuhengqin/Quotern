import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm,utimes} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {extractSessionObservations,aggregateSessionActivity} from '../src/session-observation.js';
import {syncSessionSource,readSessionHistory} from '../src/session-collector.js';
import {enrichSessionInsights} from '../src/session-insights.js';
import {readSessionReport} from '../src/session-report.js';
import {applyRemotePricingOverlay,resetPricingRuntime} from '../src/pricing/index.js';
test('Droid cumulative usage survives model changes without recharging earlier tokens',()=>{
  const context={sessionId:'s'};
  const a=extractSessionObservations('droid',{timestamp:'2026-10-22T00:00:00Z',model:'a',tokenUsage:{inputTokens:100,totalTokens:100}},context);
  const b=extractSessionObservations('droid',{timestamp:'2026-10-22T01:00:00Z',model:'b',tokenUsage:{inputTokens:150,totalTokens:150}},context);
  const report=aggregateSessionActivity([...a,...b],[],{totalTokens:150});
  assert.equal(report.sessions[0]?.tokens,150);
  assert.equal(report.sessions[0]?.models?.find(m=>m.model==='b')?.tokens,50);
});
test('Droid usage ignores newer stale copies and keeps unknown delta prices when earlier details are absent',()=>{
  try {
    applyRemotePricingOverlay({exact:{'droid-fixture':{input:2,output:4}}});
    const context={sessionId:'s'},snapshot=(timestamp:string,tokenUsage:Record<string,number>)=>extractSessionObservations('droid',{timestamp,model:'droid-fixture',tokenUsage},context);
    const unknown=snapshot('2026-10-20T00:00:00Z',{totalTokens:100000});
    const complete=snapshot('2026-10-22T00:00:00Z',{inputTokens:150000,totalTokens:150000});
    const report=aggregateSessionActivity([...unknown,...complete],[],{totalTokens:50000,fromDate:'2026-10-22'});
    assert.equal(report.sessions[0]?.tokens,50000);assert.equal(report.sessions[0]?.costUsd,null);
    const olderCopy=snapshot('2026-10-22T01:00:00Z',{inputTokens:80000,totalTokens:80000});
    assert.equal(aggregateSessionActivity([...complete,...olderCopy],[],{totalTokens:150000}).sessions[0]?.tokens,150000);
  } finally { resetPricingRuntime(); }
});
test('additional observation counters reject unsafe values and overflowing sums',()=>{
  for (const tokenUsage of [{inputTokens:1e308,outputTokens:1e308},{inputTokens:Number.MAX_SAFE_INTEGER,outputTokens:1}]) {
    assert.deepEqual(extractSessionObservations('droid',{timestamp:'2026-10-22T00:00:00Z',tokenUsage},{sessionId:'s'}),[]);
  }
});
test('Copilot shutdown keeps every model and leaves request counts unknown',()=>{
  const context={sessionId:'s'};
  const events=extractSessionObservations('copilot',{type:'session.shutdown',timestamp:'2026-10-22T00:00:00Z',data:{modelMetrics:{a:{usage:{inputTokens:100,outputTokens:20}},b:{usage:{inputTokens:50,outputTokens:10}}}}},context);
  const report=aggregateSessionActivity(events,[],{totalTokens:180});
  assert.equal(report.sessions[0]?.models?.length,2);assert.equal(report.sessions[0]?.tokens,180);
  assert.ok(report.sessions[0]?.models?.every(m=>m.requests===null));
});
test('Grok retains pre-compaction usage when contextTokensUsed is absent',()=>{
  const events=extractSessionObservations('grok',{timestamp:'2026-10-22T00:00:00Z',totalTokensBeforeCompaction:100,totalTokens:30},{sessionId:'s'});
  assert.equal(events[0]?.tokens,130);assert.equal(events[0]?.tokenParts,undefined);
});
test('Grok updates and signals retain high-water usage and disclose assumed prices without fabricating a split',()=>{
  try {
    const context={sessionId:'s',observationModel:'grok-fixture'};
    const update=(time:number,total:number)=>extractSessionObservations('grok',{params:{_meta:{agentTimestampMs:Date.parse('2026-10-22T00:00:00Z')+time,totalTokens:total}}},context);
    const events=[...update(0,1000),...update(1000,20),...update(2000,1200),...extractSessionObservations('grok',{timestamp:'2026-10-22T00:00:03Z',primaryModelId:'grok-fixture',totalTokensBeforeCompaction:1000,contextTokensUsed:200},{sessionId:'s'})];
    applyRemotePricingOverlay({exact:{'grok-fixture':{input:2,output:4}}});
    const row=aggregateSessionActivity(events,[],{totalTokens:1200}).sessions[0]!;
    assert.equal(row.tokens,1200);assert.equal(row.costKind,'estimated');
    assert.ok(Math.abs(row.costUsd!-0.00288)<1e-10);
    assert.equal(row.models?.[0]?.input_tokens,null);assert.equal(row.models?.[0]?.requests,null);
    assert.deepEqual(row.models?.[0]?.pricing?.assumptions,['grok-80-20']);
  } finally { resetPricingRuntime(); }
});
test('DSH inherited seed usage is excluded after reading v2 boundary, with fork metadata retained',async()=>{
  const root=await mkdtemp(join(tmpdir(),'quotern-seed-'));
  try{
    const path=join(root,'s.jsonl');
    const message=(seq:number,total:number)=>({type:'assistant/message',seq,time:1761091200000+seq*1000,data:{message:{id:`m${seq}`,source:{model:'unknown'}},usage:{inputTokens:total,totalTokens:total}}});
    await writeFile(path,[{type:'session',id:'s',parentSession:'parent',version:2,createdAt:'2025-10-22T00:00:00Z'},message(1,100),{type:'session/end-seed',seq:2,data:{inherited:true}},message(3,20)].map(x=>JSON.stringify(x)).join('\n')+'\n');
    await syncSessionSource(root,'dsh',{complete:true,inputs:[{path,sessionId:'s',kind:'jsonl'}]});
    const history=await readSessionHistory(root,['dsh']);const report=aggregateSessionActivity(history.observations,history.messages,{totalTokens:20});
    assert.equal(report.sessions[0]?.tokens,20);
    enrichSessionInsights(report.sessions,history.messages,history.evidence);
    assert.equal(report.sessions[0]?.insights?.parentId,'parent');
  }finally{await rm(root,{recursive:true,force:true});}
});
test('unchanged cumulative totals do not move the original observation into another day',async()=>{
  const root=await mkdtemp(join(tmpdir(),'quotern-snapshot-'));
  try{
    const path=join(root,'s.settings.json'),input={complete:true,inputs:[{path,sessionId:'s',kind:'json' as const}]};
    await writeFile(path,JSON.stringify({model:'a',tokenUsage:{inputTokens:100,totalTokens:100}}));await utimes(path,new Date('2026-10-20T00:00:00Z'),new Date('2026-10-20T00:00:00Z'));
    await syncSessionSource(root,'droid',input);
    await writeFile(path,JSON.stringify({model:'a',changedSetting:true,tokenUsage:{inputTokens:100,totalTokens:100}}));await utimes(path,new Date('2026-10-22T00:00:00Z'),new Date('2026-10-22T00:00:00Z'));
    await syncSessionSource(root,'droid',input);
    const history=await readSessionHistory(root,['droid']);
    assert.equal(history.observations.length,1);assert.equal(history.observations[0]?.timestamp,'2026-10-20T00:00:00.000Z');
    assert.ok(!(await readFile(join(root,'sessions','droid.json'),'utf8')).includes('changedSetting'));
  }finally{await rm(root,{recursive:true,force:true});}
});
test('additional observations reprice from token evidence rather than retaining old or unknown prices',()=>{
  try{
    const events=extractSessionObservations('droid',{timestamp:'2026-10-22T00:00:00Z',model:'session-unit-model',tokenUsage:{inputTokens:100000,totalTokens:100000}},{sessionId:'s'});
    applyRemotePricingOverlay({exact:{'session-unit-model':{input:2,output:4,cache_read:0,cache_write:0}}});
    assert.equal(aggregateSessionActivity(events,[],{totalTokens:100000}).sessions[0]?.costUsd,0.2);
    applyRemotePricingOverlay({exact:{'session-unit-model':{input:4,output:4,cache_read:0,cache_write:0}}});
    assert.equal(aggregateSessionActivity(events,[],{totalTokens:100000}).sessions[0]?.costUsd,0.4);
  }finally{resetPricingRuntime();}
});
test('persisted session reports use Shanghai dates, enforce collectSince and never initialize runtime state',async()=>{
  const root=await mkdtemp(join(tmpdir(),'quotern-session-report-'));
  try{
    await writeFile(join(root,'config.json'),JSON.stringify({statsSince:'2026-10-20T00:00:00+08:00',localCollectSince:'2026-10-22T00:00:00+08:00'}));
    const path=join(root,'claude.jsonl');
    const message=(id:string,timestamp:string)=>({type:'assistant',sessionId:id,requestId:id,timestamp,message:{id,model:'fixture',usage:{input_tokens:10,output_tokens:5}}});
    await writeFile(path,[message('older','2026-10-20T17:00:00Z'),message('inside','2026-10-21T17:00:00Z'),message('next-day','2026-10-22T17:00:00Z')].map(x=>JSON.stringify(x)).join('\n')+'\n');
    await syncSessionSource(root,'claude',{complete:true,inputs:[{path,sessionId:'s',kind:'jsonl'}]});
    const report=await readSessionReport(root,{fromDate:'2026-10-20',toDate:'2026-10-22'});
    assert.deepEqual(report.sessions.map(r=>r.sessionId),['inside']);
    assert.equal(report.sessions[0]?.insights?.messageCount,1);
    await assert.rejects(readFile(join(root,'tud.pid')));
  }finally{await rm(root,{recursive:true,force:true});}
});
