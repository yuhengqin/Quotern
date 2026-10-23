import type { SessionActivity } from './session-observation.js';
/** Browser-safe shared serialization. Own amounts are additive; thread totals are derived. */
export function sessionsToCsv(rows:readonly SessionActivity[]):string {
  const columns=['source','session_id','title','project','model','own_tokens','own_cost_usd','known_cost_usd','cost_kind','parent_id','relation_kind','combined_tokens','combined_cost_usd','last_activity_at'];
  const cell=(value:unknown)=>{let text=value==null?'':String(value);if(/^[\s]*[=+\-@\t\r]/.test(text))text="'"+text;return `"${text.replace(/"/g,'""')}"`;};
  return [columns,...rows.map(r=>[r.source,r.sessionId,r.sessionTitle,r.projectLabel,r.model,r.tokens,r.insights?r.insights.ownCostUsd:r.costUsd,r.costUsd,r.costKind,r.insights?.parentId,r.insights?.relationKind,r.insights?.combinedTokens,r.insights?.combinedCostUsd,r.lastActivityAt])].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}
