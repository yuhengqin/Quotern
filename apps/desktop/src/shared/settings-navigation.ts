import type { PetSelection } from './pet.js';

const SETTINGS_TAB_IDS = ['sync', 'pet', 'app', 'subscription', 'appearance', 'integrations', 'data', 'about'] as const;
export type SettingsTabId = (typeof SETTINGS_TAB_IDS)[number];
export interface PetSettingsRequest { target: PetSelection; requestId: string }
export interface OpenSettingsDetail { tab?: SettingsTabId; pet?: PetSettingsRequest }

/** Keep main/preload/renderer on one checked, browser-safe navigation contract. */
export function parseOpenSettingsDetail(value: unknown): OpenSettingsDetail {
  if (!value || typeof value !== 'object') return {};
  const raw = value as { tab?: unknown; pet?: { target?: unknown; requestId?: unknown } }, result: OpenSettingsDetail = {};
  const tab = SETTINGS_TAB_IDS.find((id) => id === raw.tab);
  if (tab) result.tab = tab;
  const pet = raw.pet, target = pet?.target as { kind?: unknown; character?: unknown } | undefined;
  if (pet && typeof pet.requestId === 'string' && pet.requestId.length > 0 && pet.requestId.length <= 100) {
    if (target?.kind === 'dsh') result.pet = { requestId: pet.requestId, target: { kind: 'dsh' } };
    else if (target?.kind === 'builtin' && typeof target.character === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(target.character)) result.pet = { requestId: pet.requestId, target: { kind: 'builtin', character: target.character } };
  }
  return result;
}
