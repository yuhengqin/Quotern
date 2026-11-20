import assert from 'node:assert/strict';
import test from 'node:test';
import {mapCopilotQuota} from './copilot-official.js';
test('official Copilot entitlements retain measured remaining percentage, request counts and reset date',()=>{
  const resetDate='2026-12-01T00:00:00Z';
  const result=mapCopilotQuota({quotaSnapshots:{
    premium_interactions:{remainingPercentage:75.5,entitlementRequests:1000,usedRequests:245,resetDate},
    chat:{entitlementRequests:-1}, invalid:{remainingPercentage:-1}
  }});
  assert.equal(result.status,'ready');
  assert.deepEqual(result.limits,[{id:'premium_interactions',label:'premium interactions',remainingPercent:75.5,used:245,limit:1000,unit:'requests',resetsAt:Date.parse(resetDate)/1000},{id:'chat',label:'chat',unlimited:true,resetsAt:null}]);
  assert.notEqual(mapCopilotQuota({quotaSnapshots:{}}).status,'ready');
});
