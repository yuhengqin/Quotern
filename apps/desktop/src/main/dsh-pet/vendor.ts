import { createRequire } from 'node:module';
import path from 'node:path';
import type { MergedConfig, WorkStatusState } from '../../shared/dsh-pet.js';

export interface ConfigPaths { defaultFile: string; userFile: string; petDir: string }
export interface PetInstance { entry: string; conf: Record<string, unknown>; pet: Record<string, unknown> }
export interface PollLeaf { counter: number; data: unknown }
export interface PollState { sections: Record<string, PollLeaf>; pets: Record<string, Record<string, PollLeaf>> }
export interface MemeEntry { name: string; desc: string }
export interface VendorHost {
  readAllConfig(paths: ConfigPaths): MergedConfig;
  configVersion(paths: ConfigPaths): string;
  findPetInstance(config: MergedConfig, id: string): PetInstance | undefined;
  readPetConfigEntry(paths: ConfigPaths, entry: string): { path: string; raw: Record<string, unknown> | undefined } | undefined;
  flattenPetList(config: MergedConfig): Record<string, unknown>[];
  saveUserConfig(raw: unknown, existing?: Record<string, unknown>): Record<string, unknown> | null;
  animationNames(animations: unknown): string[];
  decideAnim(args: { cfg: MergedConfig; requested: string; active: string; name: unknown }): { ok: true; petId: string; name: string } | { ok: false; reason: string; message: string };
  PollStateStore: new () => { writeSection(name: string, data: unknown): void; writePet(id: string, name: string, data: unknown): void; read(): PollState };
  WorkStatusStore: new () => { setState(id: string, state: WorkStatusState, seq?: number): boolean; clear(id: string): boolean; setTask(id: string, task: string | null): boolean; snapshot(): { state: WorkStatusState | null; task: string | null; ts: number } };
  [key: string]: unknown;
}

export function loadVendor(runtimeRoot: string): VendorHost {
  const requireModule = createRequire(__filename);
  return requireModule(path.join(runtimeRoot, 'host.cjs')) as VendorHost;
}
