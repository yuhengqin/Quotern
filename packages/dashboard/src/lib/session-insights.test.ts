import test from 'node:test';
import assert from 'node:assert/strict';
import { sessionThreads, sessionCsv, sessionGroups, filterSessionBranches, sessionBranchRows } from './session-insights.ts';
import type { SessionActivity } from 'quotern-core';
const row=(source:string,sessionId:string,parentId?:string)=>({source,sessionId,insights:parentId?{parentId,relationConflict:false}:undefined}) as SessionActivity;
test('threads retain children whose parent was filtered out and isolate source identity',()=>{
  const rows=[row('codex','root'),row('codex','child','root'),row('dsh','child','root'),row('codex','orphan','absent')];
  const tree=sessionThreads(rows);
  assert.deepEqual(tree.roots.map(r=>r.sessionId),['root','child','orphan']);
  assert.equal(tree.children.get('["codex","root"]')?.length,1);
  assert.equal(sessionThreads([rows[1]!]).roots.length,1);
});
test('browser export is formula-safe and does not export local directories',()=>{
  const csv=sessionCsv([{...row('codex','a'),sessionTitle:'=1+1',insights:{workingDirectory:'PRIVATE_DIR'}} as SessionActivity]);
  assert.ok(csv.includes("'=1+1"));assert.ok(!csv.includes('PRIVATE_DIR'));
});
test('session CSV exports original Token counts and costs rather than rounded display values', () => {
  const csv = sessionCsv([{
    ...row('codex', 'precision'), tokens: 3_684_765, costUsd: 1.422123456789,
    insights: { ownCostUsd: 1.422123456789, combinedTokens: 4_567_891, combinedCostUsd: 2.345678912345 },
  } as SessionActivity]);
  const lines = csv.trim().split('\r\n');
  const cells = lines[1]!.split(',').map(value => value.slice(1, -1));
  assert.equal(cells[5], '3684765');
  assert.equal(cells[6], '1.422123456789');
  assert.equal(cells[11], '4567891');
  assert.equal(cells[12], '2.345678912345');
});
test('date groups use the statistics timezone at UTC midnight boundaries',()=>{
  const rows=[{...row('codex','a'),lastActivityAt:'2026-10-21T17:00:00Z'},{...row('codex','b'),lastActivityAt:'2026-10-22T01:00:00Z'}];
  const groups=sessionGroups(rows,'date','en-US');assert.equal(groups.length,1);assert.equal(groups[0]?.sessions.length,2);
});
test('deep valid chains remain reachable and corrupt cycles remain standalone',()=>{
  const rows=Array.from({length:25},(_,i)=>row('codex',String(i),i?String(i-1):undefined));
  const tree=sessionThreads(rows);let reached=0;const visit=(r:SessionActivity)=>{reached++;for(const c of tree.children.get(JSON.stringify([r.source,r.sessionId]))??[])visit(c);};tree.roots.forEach(visit);assert.equal(reached,25);
  assert.equal(sessionThreads([row('codex','a','b'),row('codex','b','a')]).roots.length,2);
});
test('child model filtering preserves the path to matching grandchildren',()=>{
  const rows=[{...row('codex','root'),model:'a'},{...row('codex','child','root'),model:'b'},{...row('codex','grandchild','child'),model:'c'}];
  const tree=sessionThreads(rows);
  assert.deepEqual(sessionBranchRows(tree.roots,tree.children).map(r=>r.model),['a','b','c']);
  assert.deepEqual(filterSessionBranches(tree.children.get('["codex","root"]')!,tree.children,'c').map(r=>r.sessionId),['child']);
});
