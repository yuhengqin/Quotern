import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { ActivityEvent } from '../../shared/agent-activity.js';

/** Reads only the bounded metadata queue produced by the opt-in integration hook. */
export class AgentHookEvents {
  private active = false;
  private generation = 0;
  private readonly seen = new Set<string>();
  private pending: Promise<void> | null = null;
  constructor(private readonly options: { directory: string; onEvent(event: ActivityEvent): void; now?: () => number }) {}
  private async files() { return (await readdir(this.options.directory).catch(() => [])).filter(name => /^\d{13}-[a-f0-9]{16}\.json$/.test(name)).sort().slice(-512); }
  async start(): Promise<void> { const generation = ++this.generation; for (const file of await this.files()) this.seen.add(file); if (generation === this.generation) this.active = true; }
  poll(): Promise<void> {
    if (!this.active) return Promise.resolve();
    if (this.pending) return this.pending;
    this.pending = this.scan().finally(() => { this.pending = null; }); return this.pending;
  }
  private async scan(): Promise<void> {
    const generation = this.generation;
    const now = this.options.now?.() ?? Date.now();
    const safe = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\x00-\x1f\x7f]/.test(value);
    for (const name of await this.files()) {
      if (!this.active || generation !== this.generation || this.seen.has(name)) continue;
      this.seen.add(name); if (this.seen.size > 2048) this.seen.delete(this.seen.values().next().value!);
      try {
        const file = path.join(this.options.directory, name);
        if ((await stat(file)).size > 4096) continue;
        const row = JSON.parse(await readFile(file, 'utf8')) as Record<string, unknown>;
        const at = Number(row.at) * 1000;
        if (!this.active || generation !== this.generation || row.version !== 1 || row.id !== name.slice(0, -5) || !['claude', 'codex'].includes(String(row.source)) || !safe(row.sessionId) || !safe(row.event) || !Number.isFinite(at) || now - at > 120_000 || at - now > 60_000) continue;
        if (!['complete', 'confirmation', 'error', 'resolved', 'started'].includes(String(row.kind))) continue;
        const notice = row.kind === 'complete' || row.kind === 'confirmation' || row.kind === 'error' ? row.kind : undefined;
        const terminal = row.kind === 'complete' || row.event === 'StopFailure' || ['SessionEnd', 'Interrupt'].includes(String(row.event));
        this.options.onEvent({ id: String(row.id), source: String(row.source), sessionId: row.sessionId, timestamp: new Date(at).toISOString(), evidence: `hook:${row.event}`,
          state: row.kind === 'confirmation' ? 'waiting' : row.kind === 'error' ? 'error' : row.kind === 'started' ? 'working' : 'result',
          terminal, ...(notice ? { notice } : {}), ...(safe(row.turnId) ? { turnId: row.turnId } : {}),
          ...(safe(row.requestId) ? row.kind === 'confirmation' ? { requestId: row.requestId } : { resolvedRequestId: row.requestId } : {}),
          ...(row.kind !== 'confirmation' && safe(row.requestKey) ? { resolvedRequestKey: row.requestKey } : {}), ...(row.kind === 'started' ? { newTurn: true } : {}) });
      } catch { /* Partial/unknown files cannot prove a notification event. */ }
    }
  }
  dispose(): void { this.active = false; this.generation++; }
}
