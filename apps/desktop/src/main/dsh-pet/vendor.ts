import { createRequire } from 'node:module';
import path from 'node:path';
import type { MergedConfig } from '../../shared/dsh-pet.js';

export interface ConfigPaths { defaultFile: string; userFile: string; petDir: string }
export interface PetInstance { entry: string; conf: Record<string, unknown>; pet: Record<string, unknown> }
export interface VendorHost {
  readAllConfig(paths: ConfigPaths): MergedConfig;
  configVersion(paths: ConfigPaths): string;
  findPetInstance(config: MergedConfig, id: string): PetInstance | undefined;
  flattenPetList(config: MergedConfig): Record<string, unknown>[];
  saveUserConfig(raw: unknown, existing?: Record<string, unknown>): Record<string, unknown> | null;
  [key: string]: unknown;
}

export function loadVendor(runtimeRoot: string): VendorHost {
  const requireModule = createRequire(__filename);
  return requireModule(path.join(runtimeRoot, 'host.cjs')) as VendorHost;
}
