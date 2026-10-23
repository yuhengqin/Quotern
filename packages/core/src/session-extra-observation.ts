import { createHash } from 'node:crypto';
import type { ObservationContext, SessionObservation } from './session-observation.js';
import { computeRowCost, isModelPriced } from './pricing/index.js';
import type { TokenParts } from './pricing/request-pricing.js';
type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => v && typeof v === 'object' && !Array.isArray(v) ? v as Obj : {};
const text = (v: unknown) => typeof v === 'string' ? v : '';
const n = (v: unknown) => typeof v === 'number' && Number.isSafeInteger(Math.floor(v)) && v >= 0 ? Math.floor(v) : 0;
export function extractAdditionalObservations(source: string, record: Obj, context: ObservationContext): SessionObservation[] {
  const data = obj(record.data), out: SessionObservation[] = [];
  const grokMeta=obj(obj(record.params)._meta??record._meta);
  const rawClock = source==='grok'?grokMeta.agentTimestampMs??grokMeta.timestampMs??record.timestamp??record.time:record.timestamp ?? record.time;
  const clock = typeof rawClock === 'number' ? rawClock < 1e12 ? rawClock * 1000 : rawClock : Date.parse(String(rawClock ?? ''));
  if (!Number.isFinite(clock) || Math.abs(clock) >= 8.64e15) return out;
  const timestamp = new Date(clock).toISOString();
  const add = (id: string, model: string, parts: TokenParts | undefined, total: number, requestKnown: boolean, cumulative = false) => {
    if (!id || !Number.isSafeInteger(total) || total <= 0 || !context.sessionId) return;
    if (parts && Object.values(parts).reduce((sum, value) => sum + value, 0) !== total) parts = undefined;
    const costUsd = parts && isModelPriced(model, source) ? computeRowCost({ ...parts, hour_start: timestamp, source, model, project: '', total_tokens: total, conversation_count: 0 }) : null;
    out.push({ id, source, sessionId: context.sessionId, timestamp, model: model || 'unknown', tokens: total, usageKnown: true, costUsd, costKind: costUsd === null ? 'unknown' : 'estimated', requestKnown, ...(parts ? { tokenParts: parts, costBasis:'request-facts' as const } : {}), ...(cumulative ? { cumulative: true } : {}), ...(typeof record.seq==='number'?{seq:record.seq}:{}), billing: { service: 'unknown', mode: 'unknown', accountRef: null, evidence: 'unknown' }, ...(context.projectLabel ? { projectLabel: context.projectLabel } : {}) });
  };
  if (source === 'copilot' && record.type === 'session.shutdown') {
    for (const [model, metric] of Object.entries(obj(data.modelMetrics))) {
      const usage = obj(obj(metric).usage), read = n(usage.cacheReadTokens), write = n(usage.cacheWriteTokens);
      const parts = { input_tokens: Math.max(0,n(usage.inputTokens)-read), output_tokens:n(usage.outputTokens), cached_input_tokens:read, cache_creation_input_tokens:write, reasoning_output_tokens:0 };
      add(`shutdown:${timestamp}:${model}`,model,parts,Object.values(parts).reduce((s,v)=>s+v,0),false);
    }
  } else if (source === 'dsh') {
    if (record.type === 'request/header') context.observationModel = text(obj(obj(data.header).config).model) || context.observationModel;
    if (record.type !== 'assistant/message') return out;
    const usage = obj(data.usage), message = obj(data.message), model = text(obj(message.source).model) || context.observationModel || 'unknown';
    const rawOutput=n(usage.outputTokens),reasoning=n(usage.reasoningTokens);
    const parts={input_tokens:n(usage.inputTokens),output_tokens:Math.max(0,rawOutput-reasoning),reasoning_output_tokens:reasoning,cached_input_tokens:n(usage.cacheReadTokens),cache_creation_input_tokens:n(usage.cacheWriteTokens)};
    const total=Math.max(n(usage.totalTokens),Object.values(parts).reduce((s,v)=>s+v,0));
    add(`message:${text(message.id) || record.seq}`,model,Object.values(parts).reduce((s,v)=>s+v,0)===total?parts:undefined,total,!!text(message.id));
  } else if (source === 'zcode' && record.sessionUsage === true) {
    context.sessionId=text(record.sessionId)||context.sessionId;
    const read=n(record.cache_read_input_tokens),write=n(record.cache_creation_input_tokens),input=n(record.input_tokens),output=n(record.output_tokens),reasoning=n(record.reasoning_tokens);
    const parts={input_tokens:Math.max(0,input-read-write),output_tokens:output,reasoning_output_tokens:reasoning,cached_input_tokens:read,cache_creation_input_tokens:write};
    add(`usage:${record.id}`,text(record.model_id),parts,(n(record.computed_total_tokens)||input+output)+reasoning,true);
  } else if (source === 'zcode') {
    const usage=obj(record.tokens),cache=obj(usage.cache);
    context.sessionId=text(record.sessionID ?? record.sessionId)||context.sessionId;
    const parts={input_tokens:n(usage.input),output_tokens:n(usage.output),reasoning_output_tokens:n(usage.reasoning),cached_input_tokens:n(cache.read),cache_creation_input_tokens:n(cache.write)};
    add(`message:${record.id}`,text(record.modelID ?? record.model),parts,Object.values(parts).reduce((s,v)=>s+v,0),false);
  } else if (source === 'droid') {
    const usage=obj(record.tokenUsage),model=text(record.model)||'droid-unknown';
    const parts={input_tokens:n(usage.inputTokens),output_tokens:n(usage.outputTokens),reasoning_output_tokens:n(usage.thinkingTokens),cached_input_tokens:n(usage.cacheReadTokens),cache_creation_input_tokens:n(usage.cacheCreationTokens)};
    const sum=Object.values(parts).reduce((s,v)=>s+v,0),total=Math.max(n(usage.totalTokens),sum);
    add(`snapshot:${createHash('sha256').update(JSON.stringify([timestamp,model,total])).digest('hex')}`,model,sum===total?parts:undefined,total,false,true);
  } else if (source === 'grok') {
    const total=Object.keys(grokMeta).length?n(grokMeta.totalTokens):Math.max(n(record.totalTokens),n(record.totalTokensBeforeCompaction)+(typeof record.contextTokensUsed==='number'?n(record.contextTokensUsed):n(record.totalTokens)));
    const model=text(record.primaryModelId ?? record.model) || (Array.isArray(record.modelsUsed)?text(record.modelsUsed[0]):'') || context.observationModel || 'grok-build';
    add(`snapshot:${timestamp}:${model}:${total}`,model,undefined,total,false,true);
    const event=out[0];if(event){const input=Math.floor(total*0.8);event.estimatedTokenParts={input_tokens:input,output_tokens:total-input,cached_input_tokens:0,cache_creation_input_tokens:0,reasoning_output_tokens:0};event.costBasis='request-facts';event.costAssumption='grok-80-20';}
  }
  return out;
}
