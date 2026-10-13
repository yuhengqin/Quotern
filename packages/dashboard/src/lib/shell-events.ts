/** Lightweight shell ↔ page bridging without lifting data hooks. */

export const DATA_SYNCED_EVENT = 'tud:data-synced';
export const OPEN_SETTINGS_EVENT = 'tud:open-settings';
export const OPEN_ABOUT_EVENT = 'tud:open-about';
export const OPEN_SHARE_EVENT = 'tud:open-share';

export type SettingsTabId = 'sync' | 'app' | 'about';

export type OpenSettingsDetail = {
  tab?: SettingsTabId;
};

export function dispatchDataSynced() {
  window.dispatchEvent(new CustomEvent(DATA_SYNCED_EVENT));
}

export function dispatchOpenSettings(detail?: OpenSettingsDetail) {
  window.dispatchEvent(
    new CustomEvent(OPEN_SETTINGS_EVENT, { detail: detail ?? {} }),
  );
}

export function dispatchOpenAbout() {
  window.dispatchEvent(new CustomEvent(OPEN_ABOUT_EVENT));
}

export function dispatchOpenShare() {
  window.dispatchEvent(new CustomEvent(OPEN_SHARE_EVENT));
}

export function shareCurrentPage() {
  dispatchOpenShare();
  return Promise.resolve();
}
