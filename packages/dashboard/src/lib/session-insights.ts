import type { SessionActivity } from 'quotern-core';
import {localDateAndHour,DEFAULT_STATS_TIMEZONE} from './stats-timezone.ts';
export const sessionIdentity = (row: Pick<SessionActivity,'source'|'sessionId'>) => JSON.stringify([row.source,row.sessionId]);
export function sessionThreads(rows: SessionActivity[]) {
  const visible=new Set(rows.map(sessionIdentity));
  const byId=new Map(rows.map(row=>[sessionIdentity(row),row]));
  const children=new Map<string,SessionActivity[]>(),roots:SessionActivity[]=[];
  for(const row of rows){
    const parent=row.insights?.parentId;
    let cursor:SessionActivity|undefined=row;const ancestors=new Set<string>();let cycle=false;
    while(cursor?.insights?.parentId){const id=sessionIdentity(cursor);if(ancestors.has(id)){cycle=true;break;}ancestors.add(id);cursor=byId.get(sessionIdentity({source:cursor.source,sessionId:cursor.insights.parentId}));}
    if(parent&&!cycle&&!row.insights?.relationConflict&&visible.has(sessionIdentity({source:row.source,sessionId:parent}))){
      const key=sessionIdentity({source:row.source,sessionId:parent});const list=children.get(key)??[];list.push(row);children.set(key,list);
    }else roots.push(row);
  }
  return {roots,children};
}
/** Include ancestor paths when a model match is deeper than the direct children. */
export function sessionBranchRows(rows: SessionActivity[], children: Map<string, SessionActivity[]>): SessionActivity[] {
  const result: SessionActivity[] = [], seen = new Set<string>(), pending = [...rows];
  while (pending.length) {
    const row = pending.shift()!, id = sessionIdentity(row);
    if (seen.has(id)) continue;
    seen.add(id); result.push(row); pending.push(...children.get(id) ?? []);
  }
  return result;
}
export function filterSessionBranches(rows: SessionActivity[], children: Map<string, SessionActivity[]>, model: string): SessionActivity[] {
  return model === 'all' ? rows : rows.filter(row => sessionBranchRows([row], children).some(item => item.model === model || item.models?.some(usage => usage.model === model)));
}
export function sessionGroups(rows:SessionActivity[],mode:'none'|'date'|'project',locale:string){
  const groups=new Map<string,SessionActivity[]>();
  for(const row of rows){const key=mode==='project'?row.projectLabel:mode==='date'?new Date(`${localDateAndHour(row.lastActivityAt).date}T12:00:00+08:00`).toLocaleDateString(locale,{timeZone:DEFAULT_STATS_TIMEZONE}):'';const list=groups.get(key)??[];list.push(row);groups.set(key,list);}
  return [...groups].map(([label,sessions])=>({label,sessions}));
}
export {sessionsToCsv as sessionCsv} from 'quotern-core/session-csv';
