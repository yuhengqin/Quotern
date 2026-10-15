import type { PetCatalogEntry, PetSettings, PetStats } from '../main/pet-core';
import type { PetLimit } from '../main/pet-limits';

export const PET_GET_CHANNEL = 'pet:get';
export const PET_SET_CHANNEL = 'pet:set';
export const PET_STATE_CHANNEL = 'pet:state';
export const PET_COMMAND_CHANNEL = 'pet:command';
export const PET_CATALOG_CHANNEL = 'pet:catalog';
export const PET_EVENT_CHANNEL = 'pet:event';

export interface PetState {
  settings: PetSettings;
  catalog: PetCatalogEntry[];
  stats: PetStats;
  limits: PetLimit[];
  connected: boolean;
  syncing: boolean;
  dark: boolean;
  locale: string;
  hover: boolean;
  miniMode: boolean;
  lookDirectionIndex: number | null;
  bubbleBand: number;
}

export type PetSettingPatch = Partial<Pick<PetSettings, 'visible' | 'character' | 'size' | 'botColor'>>;

export type PetCatalogRequest =
  | { action: 'import-zip' }
  | { action: 'install-url'; url: string }
  | { action: 'list-codex' }
  | { action: 'import-codex'; ids: string[] }
  | { action: 'remove'; id: string }
  | { action: 'restore-builtins' };

export type PetCommand =
  | 'context-menu'
  | 'sync'
  | 'drag-left'
  | 'drag-right'
  | 'drag-end'
  | 'hide'
  | 'wake'
  | `move:${number}:${number}`
  | `bubble-height:${number}`;
