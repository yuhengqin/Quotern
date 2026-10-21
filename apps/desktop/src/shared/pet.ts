import type { PetCatalogEntry, PetSettings, PetStats } from '../main/pet-core';
import type { PetLimit } from '../main/pet-limits';

export const PET_GET_CHANNEL = 'pet:get';
export const PET_SET_CHANNEL = 'pet:set';
export const PET_STATE_CHANNEL = 'pet:state';
export const PET_COMMAND_CHANNEL = 'pet:command';
export const PET_CATALOG_CHANNEL = 'pet:catalog';
export const PET_EVENT_CHANNEL = 'pet:event';
export const PET_SELECT_CHANNEL = 'pet:select';
export const PET_ENABLE_CHANNEL = 'pet:enable';
export const PET_SELECTION_GET_CHANNEL = 'pet:selection:get';
export const PET_SELECTION_STATE_CHANNEL = 'pet:selection:state';

export type PetKind = 'builtin' | 'dsh';
export type PetSelection = { kind: 'builtin'; character: string } | { kind: 'dsh' };
export interface PetActivationState { currentKind: PetKind; enabled: boolean }

export interface PetState {
  currentKind: PetKind;
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
