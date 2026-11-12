import type { MenuItemConstructorOptions } from 'electron';
import type { SupportedLocale } from 'quotern-i18n';
import { nativeText } from './native-messages.js';

export interface TrayMenuOptions {
  getLocale(): SupportedLocale;
  showMainWindow(): void;
  openSettings(): void;
  getAutostart(): Promise<boolean>;
  setAutostart(enabled: boolean): Promise<unknown>;
  pet?: {
    isEnabled(): boolean;
    setEnabled(enabled: boolean): Promise<unknown>;
  };
  quit(): void;
  onError(error: unknown): void;
}

function checkbox(
  id: string,
  label: string,
  checked: boolean,
  save: (enabled: boolean) => Promise<unknown>,
  onError: TrayMenuOptions['onError'],
): MenuItemConstructorOptions {
  return {
    id, label, type: 'checkbox', checked,
    click: async item => {
      const enabled = item.checked;
      item.enabled = false;
      try {
        await save(enabled);
      } catch (error) {
        item.checked = checked;
        onError(error);
      } finally {
        item.enabled = true;
      }
    },
  };
}

/** Read preferences on every opening, including changes made in Settings. */
export async function buildTrayMenuTemplate(options: TrayMenuOptions): Promise<MenuItemConstructorOptions[]> {
  const autostart = await options.getAutostart();
  const locale = options.getLocale();
  return [
    { id: 'main', label: nativeText(locale, 'native.tray.showMain'), click: () => options.showMainWindow() },
    checkbox('autostart', nativeText(locale, 'native.tray.autostart'), autostart,
      enabled => options.setAutostart(enabled), options.onError),
    ...(options.pet ? [checkbox('pet', nativeText(locale, 'native.tray.togglePet'), options.pet.isEnabled(),
      enabled => options.pet!.setEnabled(enabled), options.onError)] : []),
    { id: 'settings', label: nativeText(locale, 'native.tray.settings'), click: () => options.openSettings() },
    { type: 'separator' },
    { id: 'quit', label: nativeText(locale, 'native.tray.quit'), click: () => options.quit() },
  ];
}
