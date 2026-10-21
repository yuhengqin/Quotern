import { open, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import type { ActivityEvent, SourceCapabilities, WorkStatusState } from '../../shared/dsh-pet.js';

type ObjectValue = Record<string, unknown>;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
interface ActivityContext { source: string; sessionId: string; now: number; goalRound?: boolean; closing?: string | null }
export interface ActivityRoot { source: string; path: string }

/** Read explicit record semantics only; task completion is not proof of goal success. */
export function parseActivityRecord(raw: ObjectValue, context: ActivityContext): ActivityEvent | null {
  const payload = object(raw.payload), message = object(raw.message), data = object(raw.data);
  const value = raw.timestamp ?? raw.time ?? message.timestamp ?? payload.completed_at;
  const timestamp = typeof value === 'number' ? (value < 1e12 ? value * 1000 : value) : typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp) || timestamp < context.now - 120_000 || timestamp > context.now + 60_000) return null;
  let state: WorkStatusState | null | undefined, terminal = false, task: string | null | undefined, taskOnly = false;
  const type = String(raw.type ?? '');
  let evidence = type;
  if (context.source === 'codex') {
    if (type === 'event_msg') {
      evidence += `:${String(payload.type ?? '')}`;
      if (payload.type === 'task_started') state = 'working';
      else if (payload.type === 'task_complete') { state = 'result'; terminal = true; }
      else if (payload.type === 'turn_aborted') { state = null; terminal = true; }
    } else if (type === 'response_item') {
      evidence += `:${String(payload.type ?? '')}`;
      if (['function_call', 'custom_tool_call'].includes(String(payload.type))) state = 'working';
      else if (['function_call_output', 'custom_tool_call_output'].includes(String(payload.type)) || (payload.type === 'message' && payload.role === 'assistant')) state = 'result';
    }
  } else if (context.source === 'claude') {
    const content = Array.isArray(message.content) ? message.content.map(object) : [];
    if (type === 'tool_use' || (type === 'assistant' && content.some(part => part.type === 'tool_use'))) state = 'working';
    else if (type === 'tool_result' || (type === 'user' && content.some(part => part.type === 'tool_result')) || type === 'assistant') state = 'result';
  } else if (context.source === 'dsh') {
    if (type === 'turn/start') { state = 'thinking'; task = null; }
    else if (type === 'todo/write' && Array.isArray(data.todos)) {
      const todos = data.todos.map(object), current = todos.filter(todo => todo.status === 'in_progress').at(-1) ?? todos.find(todo => todo.status === 'pending');
      const content = typeof current?.content === 'string' ? current.content.trim() : '';
      const points = Array.from(content); task = content ? points.slice(0, 40).join('') + (points.length > 40 ? '…' : '') : null; taskOnly = true; state = null;
    }
    else if (type === 'tool/call') state = data.name === 'ask_user_question' ? 'waiting' : 'working';
    else if (type === 'approval/asked') state = 'waiting';
    else if (['tool/result', 'assistant/message', 'step/end'].includes(type)) state = 'result';
    else if (['step/start', 'assistant/attempt'].includes(type)) state = 'working';
    else if (type === 'turn/end') {
      terminal = true;
      const reason = String(object(data.reason).kind ?? ''); evidence += `:${reason}`;
      state = reason === 'completed' ? context.goalRound && !context.closing ? 'result' : context.closing === 'blocked' ? 'error' : 'success'
        : ['error', 'max-tokens', 'timeout'].includes(reason) ? 'error' : reason === 'blocked' ? 'waiting' : null;
    }
  }
  if (state === undefined) return null;
  const sessionId = typeof raw.sessionId === 'string' ? raw.sessionId : context.sessionId;
  const turn = payload.turn_id ?? data.turnId ?? data.turn;
  const id = createHash('sha256').update(context.source).update(sessionId).update(JSON.stringify(raw)).digest('hex');
  return { id, source: context.source, sessionId, timestamp: new Date(timestamp).toISOString(), state, evidence, terminal, ...(task !== undefined ? { task, taskOnly } : {}), ...(turn !== undefined ? { turnId: String(turn) } : {}) };
}

interface Cursor { offset: number; pending: Buffer; sessionId: string; birth: number; goalRound: boolean; closing: string | null; seedThrough: number }
export class DshPetActivityMonitor {
  private readonly cursors = new Map<string, Cursor>();
  private readonly observed = new Map<string, { states: Set<WorkStatusState>; at: string }>();
  private readonly seen = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private scanning: Promise<void> | null = null;
  private inputs: ActivityRoot[] = [];
  private discoveredAt = -Infinity;
  constructor(private readonly options: { roots: ActivityRoot[] | (() => Promise<ActivityRoot[]>); onEvent(event: ActivityEvent): void; now?: () => number; intervalMs?: number }) {}
  async start(): Promise<void> {
    if (this.active) return;
    this.active = true;
    await this.poll();
    if (this.active) { this.timer = setInterval(() => { void this.poll().catch(() => {}); }, this.options.intervalMs ?? 1000); this.timer.unref(); }
  }
  poll(): Promise<void> {
    if (!this.active) return Promise.resolve();
    if (this.scanning) return this.scanning;
    this.scanning = this.scan().finally(() => { this.scanning = null; });
    return this.scanning;
  }
  private async scan(): Promise<void> {
    const now = this.options.now?.() ?? Date.now();
    if (Array.isArray(this.options.roots)) this.inputs = this.options.roots;
    else if (now - this.discoveredAt >= 10_000) { this.inputs = await this.options.roots(); this.discoveredAt = now; }
    for (const input of this.inputs) {
      if (!this.active || !input.path.endsWith('.jsonl')) continue;
      const key = `${input.source}\0${input.path}`;
      try {
        const info = await stat(input.path);
        let cursor = this.cursors.get(key);
        if (cursor && info.size === cursor.offset && cursor.birth === info.birthtimeMs) continue;
        const file = await open(input.path, 'r');
        try {
          if (!cursor || info.size < cursor.offset || cursor.birth !== info.birthtimeMs) {
            const header = Buffer.alloc(Math.min(info.size, 16_384)); await file.read(header, 0, header.length, 0);
            const fallback = `file:${createHash('sha256').update(input.path).digest('hex').slice(0, 24)}`;
            cursor = { offset: info.size, pending: Buffer.alloc(0), sessionId: fallback, birth: info.birthtimeMs, goalRound: false, closing: null, seedThrough: 0 };
            try { this.metadata(JSON.parse(header.toString('utf8').split('\n')[0]!) as ObjectValue, cursor); } catch {}
            this.cursors.set(key, cursor);
            continue; // Every newly observed file gets an EOF baseline; never replay copied history.
          }
          const start = Math.max(cursor.offset, info.size - 1024 * 1024);
          if (start !== cursor.offset) cursor.pending = Buffer.alloc(0);
          const bytes = Buffer.alloc(info.size - start);
          const result = await file.read(bytes, 0, bytes.length, start);
          cursor.offset = start + result.bytesRead;
          const pending = Buffer.concat([cursor.pending, bytes.subarray(0, result.bytesRead)]);
          const end = pending.lastIndexOf(10);
          if (end === -1) { cursor.pending = pending.length <= 1024 * 1024 ? pending : Buffer.alloc(0); continue; }
          cursor.pending = pending.subarray(end + 1);
          const records: ObjectValue[] = [];
          for (const line of pending.subarray(0, end).toString('utf8').split('\n')) { try { records.push(object(JSON.parse(line))); } catch {} }
          for (const record of records) if (record.type === 'session/end-seed' && object(record.data).inherited === true) cursor.seedThrough = Number(record.seq) || 0;
          for (const record of records) {
            this.metadata(record, cursor);
            if (input.source === 'dsh' && typeof record.seq === 'number' && record.seq <= cursor.seedThrough) continue;
            const data = object(record.data);
            if (record.type === 'turn/start') { cursor.goalRound = false; cursor.closing = null; }
            if (record.type === 'user/message' && object(data.source).kind === 'goal') cursor.goalRound = true;
            if (record.type === 'tool/call' && data.name === 'update_goal') { try { const args = typeof data.arguments === 'string' ? object(JSON.parse(data.arguments)) : object(data.arguments); if (['complete', 'blocked'].includes(String(args.action))) cursor.closing = String(args.action); } catch {} }
            const event = parseActivityRecord(record, { source: input.source, sessionId: cursor.sessionId, now, goalRound: cursor.goalRound, closing: cursor.closing });
            if (!event || this.seen.has(event.id) || !this.active) continue;
            this.seen.add(event.id); if (this.seen.size > 10_000) this.seen.delete(this.seen.values().next().value!);
            const observed = this.observed.get(input.source) ?? { states: new Set<WorkStatusState>(), at: event.timestamp };
            if (event.state) observed.states.add(event.state); observed.at = event.timestamp; this.observed.set(input.source, observed);
            this.options.onEvent(event);
          }
        } finally { await file.close(); }
      } catch { /* A disappearing/unreadable source is not a task failure. */ }
    }
  }
  private metadata(record: ObjectValue, cursor: Cursor): void {
    if (record.type === 'session_meta' && typeof object(record.payload).id === 'string') cursor.sessionId = String(object(record.payload).id);
    else if (record.type === 'session' && typeof record.id === 'string') { cursor.sessionId = record.id; if (Number(record.version) < 2) cursor.seedThrough = Number(record.seedLength) || 0; }
    else if (typeof record.sessionId === 'string') cursor.sessionId = record.sessionId;
  }
  capabilities(): SourceCapabilities[] {
    const now = this.options.now?.() ?? Date.now();
    return ['codex', 'claude', 'dsh'].map(source => {
      const observed = this.observed.get(source);
      return { source, states: [...(observed?.states ?? [])], lastEventAt: observed?.at ?? null, reason: !this.inputs.some(input => input.source === source) ? '未发现活动记录；尚未接入' : !observed ? '等待新的增量事件；不回放历史' : now - Date.parse(observed.at) > 120_000 ? '活动信息已过期；当前状态未知' : '只显示日志已明确记录的状态，其余状态未接入' };
    });
  }
  dispose(): void { this.active = false; if (this.timer) clearInterval(this.timer); this.timer = null; }
}
