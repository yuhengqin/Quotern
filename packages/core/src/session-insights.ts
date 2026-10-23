import { createHash } from 'node:crypto';
import type { SessionActivity } from './session-observation.js';
import type { SessionMessage } from './session-metrics.js';

export type SessionRelationKind = 'fork' | 'subagent' | 'unknown';
export interface SessionEvidence {
  source: string; sessionId: string; id: string; timestamp: string;
  kind: 'metadata' | 'request' | 'turn' | 'tool' | 'retry' | 'error' | 'compaction' | 'coverage';
  complete?: boolean;
  parentId?: string; relationKind?: SessionRelationKind; relationConflict?: boolean; agentRole?: string; agentNickname?: string;
  workingDirectory?: string; projectId?: string; model?: string; turnId?: string;
  edit?: boolean; outputTokens?: number; durationMs?: number; ttftMs?: number;
}
export interface SessionInsights {
  parentId: string | null; relationKind: SessionRelationKind; relationConflict: boolean; orphan: boolean;
  agentRole: string | null; agentNickname: string | null; workingDirectory: string | null;
  firstActivityAt: string | null; messageCount: number | null; ownTokens: number | null; ownCostUsd: number | null;
  subagentTokens: number | null; subagentCostUsd: number | null; combinedTokens: number | null;
  combinedCostUsd: number | null; combinedKnownCostUsd: number; descendantCount: number;
  performance: { tokensPerSecond: number | null; estimatedRequestCount: number; estimatedDurationMs: number | null; ttftMs: number | null; ttftSampleCount: number; kind: 'estimated' };
  signals: { toolCalls: number | null; editTurns: number | null; retryTurns: number | null; firstPass: boolean | null; errorCount: number | null; compactionCount: number | null; costPerEdit: number | null; tokensPerEdit: number | null; coverage: 'complete' | 'partial' | 'unsupported' };
  resumeCommand: string | null;
}
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const str = (v: unknown): string => typeof v === 'string' ? v : '';
const num = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const transient = new WeakMap<object, { prompt?: string; nodes: Map<string, number>; requests:Map<string,{start:number|undefined;first:boolean;output:number|undefined}> }>();
export interface EvidenceContext { sessionId: string; insightTurnId?: string; insightModel?: string; insightStart?: number; insightOutputAt?: number; insightTotalTokens?: number; insightBlocked?: boolean }
/** Only allowlisted metadata survives this function. Tool inputs and prompt fingerprints never enter the context or result. */
export function extractSessionEvidence(source: string, record: Obj, context: EvidenceContext): SessionEvidence[] {
  const p = obj(record.payload), m = obj(record.message);
  const rawClock=record.timestamp??record.time??record.createdAt;
  const stamp = typeof rawClock === 'number' ? rawClock < 1e12 ? rawClock * 1000 : rawClock : Date.parse(str(rawClock));
  if (!Number.isFinite(stamp) || Math.abs(stamp) >= 8.64e15) return [];
  const clock = new Date(stamp).toISOString();
  const state = transient.get(context) ?? { nodes: new Map<string, number>(), requests:new Map<string,{start:number|undefined;first:boolean;output:number|undefined}>() };
  transient.set(context, state);
  const out: SessionEvidence[] = [];
  const emit = (kind: SessionEvidence['kind'], id: unknown, fields: Partial<SessionEvidence> = {}) => out.push({ source, sessionId: context.sessionId, timestamp: new Date(clock).toISOString(), kind, id: `${kind}:${hash(id)}`, ...fields });
  if (source === 'codex' && record.type === 'session_meta') {
    context.sessionId = str(p.id) || context.sessionId;
    const origin = obj(obj(p.source).subagent), spawn = obj(origin.thread_spawn);
    const parents = [spawn.parent_thread_id, origin.parent_thread_id, p.parent_thread_id, p.forked_from_id].map(str).filter(Boolean);
    const parent = parents[0], kind = str(p.thread_kind ?? p.thread_source);
    const subagent = Object.keys(origin).length > 0 || kind === 'subagent' || Boolean(p.parent_thread_id);
    emit('metadata', 'session', { ...(parent ? { parentId: parent, relationKind: subagent ? 'subagent' : 'fork', relationConflict: new Set(parents).size > 1 } : {}), workingDirectory: str(p.cwd), agentRole: str(p.agent_role ?? spawn.agent_role), agentNickname: str(p.agent_nickname ?? spawn.agent_nickname) });
  }
  if (source === 'codex' && record.type === 'turn_context') {
    if(str(p.turn_id)!==context.insightTurnId){context.insightStart=Date.parse(clock);context.insightOutputAt=undefined;context.insightBlocked=false;}
    context.insightTurnId = str(p.turn_id) || context.insightTurnId;
    context.insightModel = str(p.model) || context.insightModel;
    if (str(p.cwd)) emit('metadata', 'cwd', { workingDirectory: str(p.cwd) });
  }
  if (source === 'dsh' && record.type === 'session') {
    context.sessionId = str(record.id) || context.sessionId;
    if (str(record.parentSession)) emit('metadata', 'parent', { parentId: str(record.parentSession), relationKind: 'fork' });
  }
  if (source === 'claude' && str(record.cwd)) emit('metadata', 'cwd', { workingDirectory: str(record.cwd) });
  const turnId = str(p.turn_id) || context.insightTurnId;
  if (source === 'codex' && record.type === 'event_msg') {
    if (p.type === 'task_started') { context.insightTurnId = str(p.turn_id) || context.insightTurnId; emit('turn', p.turn_id ?? record.timestamp, { turnId }); }
    if (p.type === 'task_complete' && turnId && num(p.time_to_first_token_ms) !== undefined) emit('request', ['ttft', turnId], { turnId, ttftMs: num(p.time_to_first_token_ms), model: context.insightModel });
    if (['error', 'api_error'].includes(str(p.type))) {context.insightBlocked=true;emit('error', [record.timestamp, p.type]);}
    if(p.type==='turn_aborted')context.insightBlocked=true;
    if(p.type==='token_count'){
      const info=obj(p.info),usage=obj(info.last_token_usage),total=num(obj(info.total_token_usage).total_tokens),output=num(usage.output_tokens);
      const changed=total===undefined||total!==context.insightTotalTokens;
      const duration=context.insightStart!==undefined&&context.insightOutputAt!==undefined?context.insightOutputAt-context.insightStart:0;
      if(changed&&!context.insightBlocked&&output!==undefined&&output>=200&&duration>=1000&&duration<=3600000)emit('request',['usage',info.total_token_usage,info.last_token_usage,turnId],{model:context.insightModel,turnId,outputTokens:output,durationMs:duration});
      if(total!==undefined)context.insightTotalTokens=total;
      context.insightOutputAt=undefined;
    }
  }
  if(source==='codex'&&record.type==='response_item'){
    if(['function_call_output','custom_tool_call_output'].includes(str(p.type))||p.type==='message'&&p.role==='user'){context.insightStart=Date.parse(clock);context.insightOutputAt=undefined;context.insightBlocked=false;}
    else if(['reasoning','function_call','custom_tool_call'].includes(str(p.type))||p.type==='message'&&p.role==='assistant')context.insightOutputAt=Date.parse(clock);
  }
  if (source === 'codex' && record.type === 'compacted') {context.insightBlocked=true;emit('compaction', p.compaction_response_id ?? record.timestamp);}
  if (source === 'claude' && record.type === 'system' && record.subtype === 'compact_boundary') emit('compaction', record.uuid ?? record.timestamp);
  if (source === 'claude' && (record.isApiErrorMessage === true || m.error)) emit('error', record.uuid ?? record.timestamp);
  const tools = source === 'claude' && record.type === 'assistant' && Array.isArray(m.content) ? m.content.map(obj).filter(x => x.type === 'tool_use')
    : source === 'codex' && record.type === 'response_item' && ['function_call', 'custom_tool_call'].includes(str(p.type)) ? [p] : [];
  for (const tool of tools) {
    const name = str(tool.name).toLowerCase().replace(/^(functions|tools)\./, '');
    const id = tool.call_id ?? tool.id;
    if (!id) continue;
    emit('tool', id, { turnId: source === 'claude' ? str(record.parentUuid) || undefined : turnId, edit: ['apply_patch', 'edit', 'write', 'multiedit', 'notebookedit'].includes(name) });
  }
  const human = source === 'claude' && record.type === 'user' && !record.isMeta && !record.isCompactSummary
    ? m.content : source === 'codex' && record.type === 'response_item' && p.type === 'message' && p.role === 'user' ? p.content : undefined;
  if (human !== undefined) {
    const text = typeof human === 'string' ? human : Array.isArray(human) ? human.map(obj).filter(x => ['text', 'input_text'].includes(str(x.type))).map(x => str(x.text)).join(' ') : '';
    if (text.trim()) { const fingerprint = hash(text.replace(/\s+/g, ' ').trim()); if (state.prompt === fingerprint) emit('retry', record.uuid ?? p.id ?? record.timestamp); state.prompt = fingerprint; }
    if (source === 'claude' && str(record.uuid)) { state.nodes.set(str(record.uuid), Date.parse(clock)); if (state.nodes.size > 2000) state.nodes.delete(state.nodes.keys().next().value!); }
  }
  if (source === 'claude' && record.type === 'assistant' && str(m.id)) {
    const requestKey=hash([m.id,record.requestId]),previous=state.requests.get(requestKey);
    const request={start:previous?.start??state.nodes.get(str(record.parentUuid)),first:(previous?.first??false)||num(record.apiBlockIndex??0)===0,output:num(obj(m.usage).output_tokens)??previous?.output};
    state.requests.set(requestKey,request);if(state.requests.size>2000)state.requests.delete(state.requests.keys().next().value!);
    const duration=request.start===undefined?undefined:Date.parse(clock)-request.start;
    if(record.isApiErrorMessage||m.error)emit('request',[m.id,record.requestId]);
    else if(request.first&&['end_turn','tool_use','max_tokens','stop_sequence'].includes(str(m.stop_reason))&&request.output!==undefined&&request.output>=200&&duration!==undefined&&duration>=1000&&duration<=3600000)emit('request',[m.id,record.requestId],{model:str(m.model),outputTokens:request.output,durationMs:duration});
  }
  return out;
}

const key = (source: string, id: string) => JSON.stringify([source, id]);
const sumKnown = (rows: SessionActivity[], field: 'tokens' | 'costUsd'): number | null => rows.some(r => (field==='costUsd'?r.insights?.ownCostUsd:r.tokens) == null) ? null : rows.reduce((s, r) => s + (field==='costUsd'?r.insights?.ownCostUsd??0:r.tokens??0), 0);
export function enrichSessionInsights(rows: SessionActivity[], messages: readonly SessionMessage[], evidence: readonly SessionEvidence[]): void {
  const grouped = new Map<string, SessionEvidence[]>(), messageGroups = new Map<string, SessionMessage[]>();
  const unique = new Map(evidence.map(e => [key(e.source, `${e.sessionId}:${e.id}`), e]));
  const forks=new Map<string,string>();for(const e of unique.values())if(e.kind==='metadata'&&e.relationKind==='fork'&&e.parentId)forks.set(key(e.source,e.sessionId),e.parentId);
  for (const e of unique.values()) {
    const parent=forks.get(key(e.source,e.sessionId));
    if(parent&&e.kind!=='metadata'&&e.kind!=='coverage'&&unique.has(key(e.source,`${parent}:${e.id}`)))continue;
    const k = key(e.source, e.sessionId); const list = grouped.get(k) ?? []; list.push(e); grouped.set(k, list);
  }
  for (const m of messages) { const k = key(m.source, m.sessionId); const list = messageGroups.get(k) ?? []; list.push(m); messageGroups.set(k, list); }
  const byKey = new Map(rows.map(row => [key(row.source, row.sessionId), row]));
  for (const row of rows) {
    const events = (grouped.get(key(row.source, row.sessionId)) ?? []).sort((a,b) => a.timestamp.localeCompare(b.timestamp));
    const meta = events.filter(e => e.kind === 'metadata'), latest = <K extends keyof SessionEvidence>(field: K) => [...meta].reverse().find(e => e[field])?.[field];
    const requests = events.filter(e => e.kind === 'request' && e.durationMs !== undefined && e.outputTokens !== undefined), ttft = events.filter(e => e.ttftMs !== undefined);
    const complete=events.some(e=>e.kind==='coverage'&&e.complete===true)&&!events.some(e=>e.kind==='coverage'&&e.complete===false);
    const tools = events.filter(e => e.kind === 'tool'), edits = tools.filter(e => e.edit), editTurns = edits.length && edits.every(e => e.turnId) ? new Set(edits.map(e => e.turnId)).size : complete&&edits.length===0?0:null;
    const duration = requests.reduce((s,e) => s + e.durationMs!, 0), output = requests.reduce((s,e) => s + e.outputTokens!, 0);
    const scopedMessages = messageGroups.get(key(row.source, row.sessionId)) ?? [];
    const parentId = latest('parentId') as string | undefined;
    const supported = ['codex', 'claude'].includes(row.source);
    const retries = events.filter(e => e.kind === 'retry').length;
    const ownCost=row.unallocatedCostUsd==null&&row.models?.some(model=>model.costUsd===null)?null:row.costUsd;
    const id = row.sessionId;
    const prefix = ({ codex: 'codex resume', claude: 'claude --resume', opencode: 'opencode --session', grok: 'grok --resume' } as Record<string,string>)[row.source];
    row.insights = { parentId: parentId ?? null, relationKind: latest('relationKind') as SessionRelationKind ?? 'unknown', relationConflict: meta.some(e => e.relationConflict) || new Set(meta.map(e=>e.parentId).filter(Boolean)).size > 1, orphan: !!parentId && !byKey.has(key(row.source,parentId)), agentRole: latest('agentRole') as string ?? null, agentNickname: latest('agentNickname') as string ?? null, workingDirectory: latest('workingDirectory') as string ?? null,
      firstActivityAt: scopedMessages.map(m=>m.timestamp).sort()[0] ?? null, messageCount: scopedMessages.length?new Set(scopedMessages.map(m=>m.id)).size:complete?0:null, ownTokens: row.tokens, ownCostUsd: ownCost, subagentTokens: 0, subagentCostUsd: 0, combinedTokens: row.tokens, combinedCostUsd: ownCost, combinedKnownCostUsd: row.costUsd ?? 0, descendantCount: 0,
      performance: { tokensPerSecond: duration > 0 ? output / (duration / 1000) : null, estimatedRequestCount: requests.length, estimatedDurationMs: duration || null, ttftMs: ttft.length ? ttft.reduce((s,e)=>s+e.ttftMs!,0)/ttft.length : null, ttftSampleCount: ttft.length, kind: 'estimated' },
      signals: { toolCalls: tools.length || (complete?0:null), editTurns, retryTurns: retries || (complete?0:null), firstPass: complete&&editTurns!==null&&editTurns>0?editTurns===1&&retries===0:null, errorCount: events.filter(e=>e.kind==='error').length || (complete?0:null), compactionCount: events.filter(e=>e.kind==='compaction').length || (complete?0:null), costPerEdit: editTurns && ownCost !== null ? ownCost/editTurns : null, tokensPerEdit: editTurns && row.tokens !== null ? row.tokens/editTurns : null, coverage: supported ? complete?'complete':'partial' : 'unsupported' },
      resumeCommand: prefix && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(id) ? `${prefix} ${id}` : null };
  }
  // Disconnect all participants in a cycle; never hide or remove a session.
  for (const row of rows) {
    const visited: SessionActivity[] = []; let cursor: SessionActivity | undefined = row;
    while (cursor?.insights?.parentId) {
      const index = visited.indexOf(cursor);
      if (index >= 0) { for (const member of visited.slice(index)) { member.insights!.relationConflict = true; } break; }
      visited.push(cursor); cursor = byKey.get(key(cursor.source,cursor.insights.parentId));
    }
  }
  const children = new Map<string, SessionActivity[]>();
  for (const row of rows) if (row.insights?.parentId && !row.insights.relationConflict) { const k = key(row.source,row.insights.parentId); const list=children.get(k)??[];list.push(row);children.set(k,list); }
  for (const row of rows) {
    const descendants: SessionActivity[] = [], seen = new Set([row]);
    const visit = (parent: SessionActivity) => { for (const child of children.get(key(parent.source,parent.sessionId))??[]) if(!seen.has(child)){seen.add(child);descendants.push(child);visit(child);} };
    visit(row); const subagents=descendants.filter(r=>r.insights?.relationKind==='subagent'), all=[row,...descendants];
    Object.assign(row.insights!, { descendantCount: descendants.length, combinedTokens: sumKnown(all,'tokens'), combinedCostUsd: sumKnown(all,'costUsd'), combinedKnownCostUsd: all.reduce((s,r)=>s+(r.costUsd??0),0), subagentTokens: sumKnown(subagents,'tokens'), subagentCostUsd: sumKnown(subagents,'costUsd') });
  }
}
export { sessionsToCsv } from './session-csv.js';
