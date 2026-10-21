import { randomBytes } from 'node:crypto';
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import type { PetActivationState, PetKind, PetSelection } from '../shared/pet.js';

interface SelectionOptions {
  file: string;
  isEnabled(): boolean;
  enable: Record<PetKind, () => Promise<unknown>>;
  selectBuiltin(character: string): Promise<unknown>;
  onChanged?(): void;
}

/** Serialize all user selection/activation requests across the independent
 * controllers. Controller-only operations bypass this queue to avoid recursion. */
export class PetActivation {
  private queue: Promise<unknown> = Promise.resolve();
  private kind: PetKind = 'builtin';
  constructor(private readonly disable: Record<PetKind, () => Promise<unknown>>, private readonly selection?: SelectionOptions) {}

  get currentKind(): PetKind { return this.kind; }
  getState(): PetActivationState { return { currentKind: this.kind, enabled: this.selection?.isEnabled() ?? false }; }

  async initialize(): Promise<void> {
    if (!this.selection) return;
    try {
      const saved = JSON.parse(await readFile(this.selection.file, 'utf8')) as { kind?: unknown };
      if (saved?.kind === 'builtin' || saved?.kind === 'dsh') this.kind = saved.kind;
    } catch (error) {
      if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  private enqueue<T>(apply: () => Promise<T>): Promise<T> {
    const operation = this.queue.then(async () => {
      try { return await apply(); }
      finally { this.selection?.onChanged?.(); }
    });
    this.queue = operation.catch(() => {});
    return operation;
  }

  private async remember(kind: PetKind): Promise<void> {
    if (this.selection) {
      const stage = `${this.selection.file}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`;
      try {
        await writeFile(stage, `${JSON.stringify({ kind })}\n`, 'utf8');
        await rename(stage, this.selection.file);
      } finally { await rm(stage, { force: true }); }
    }
    this.kind = kind;
  }

  run<T>(kind: PetKind, enabled: boolean, apply: () => Promise<T>): Promise<T> {
    return this.enqueue(async () => {
      if (enabled) {
        await this.disable[kind === 'builtin' ? 'dsh' : 'builtin']();
        await this.remember(kind);
      }
      return apply();
    });
  }

  select(target: PetSelection): Promise<void> {
    return this.enqueue(async () => {
      if (!this.selection || !target || (target.kind !== 'builtin' && target.kind !== 'dsh')) throw new Error('Invalid pet selection');
      const enabled = this.selection.isEnabled();
      // Validate catalog membership before stopping the currently running pet.
      if (target.kind === 'builtin') {
        if (typeof target.character !== 'string') throw new Error('Invalid pet character');
        await this.selection.selectBuiltin(target.character);
      }
      if (enabled) await this.disable[target.kind === 'builtin' ? 'dsh' : 'builtin']();
      await this.remember(target.kind);
      if (enabled) await this.selection.enable[target.kind]();
    });
  }

  setEnabled(enabled: boolean): Promise<void> {
    return this.enqueue(async () => {
      if (!this.selection || typeof enabled !== 'boolean') throw new Error('Invalid pet activation');
      if (enabled) {
        await this.disable[this.kind === 'builtin' ? 'dsh' : 'builtin']();
        await this.selection.enable[this.kind]();
      } else {
        await this.disable.builtin();
        await this.disable.dsh();
      }
    });
  }
}
