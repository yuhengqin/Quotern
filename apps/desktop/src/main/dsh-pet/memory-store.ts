import { existsSync, lstatSync, readFileSync, renameSync } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { atomicPrivateFile } from './storage.js';

export interface MemoryMessage { role: 'user' | 'assistant'; content: string; ts: number }
type MemoryData = Record<string, Record<string, { messages: MemoryMessage[] }>>;
export class DshPetMemoryStore {
  private data: MemoryData = Object.create(null) as MemoryData;
  private writes: Promise<void> = Promise.resolve();
  private readonly file: string;
  constructor(root: string) {
    this.file = path.join(root, 'memory.json');
    if (!existsSync(this.file)) return;
    if (lstatSync(this.file).isSymbolicLink()) throw new Error('记忆文件不能是链接');
    try {
      const raw: unknown = JSON.parse(readFileSync(this.file, 'utf8'));
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('invalid memory');
      for (const [assetRoot, value] of Object.entries(raw)) {
        if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
        const entries: MemoryData[string] = Object.create(null) as MemoryData[string];
        for (const [petId, entry] of Object.entries(value)) {
          const messages = (entry as { messages?: unknown } | null)?.messages;
          if (!Array.isArray(messages)) continue;
          entries[petId] = { messages: messages.filter((message): message is MemoryMessage => message && ['user', 'assistant'].includes(message.role) && typeof message.content === 'string' && Number.isFinite(message.ts)) };
        }
        this.data[assetRoot] = entries;
      }
    } catch {
      renameSync(this.file, `${this.file}.bak-${Date.now()}-${randomBytes(4).toString('hex')}`);
      this.data = Object.create(null) as MemoryData;
    }
  }
  get(assetRoot: string, petId: string, rounds: number): MemoryMessage[] {
    const messages = this.data[assetRoot]?.[petId]?.messages ?? [];
    return rounds <= 0 ? [] : messages.slice(-Math.floor(rounds) * 2).map(message => ({ ...message }));
  }
  append(assetRoot: string, petId: string, messages: MemoryMessage[]): Promise<void> {
    return this.update(() => ({ ...this.data, [assetRoot]: { ...this.data[assetRoot], [petId]: { messages: [...(this.data[assetRoot]?.[petId]?.messages ?? []), ...messages] } } }));
  }
  clear(petId: string): Promise<void> {
    return this.update(() => {
      const next: MemoryData = Object.create(null) as MemoryData;
      for (const [root, entries] of Object.entries(this.data)) { next[root] = { ...entries }; delete next[root]![petId]; }
      return next;
    });
  }
  private update(make: () => MemoryData): Promise<void> {
    const run = this.writes.then(async () => { const data = make(); await atomicPrivateFile(this.file, JSON.stringify(data)); this.data = data; });
    this.writes = run.catch(() => {});
    return run;
  }
}
