import type { MenuItemConstructorOptions } from 'electron';
import type { SupportedLocale } from 'quotern-i18n';
import type { DshPetAction, DshPetState } from '../../shared/dsh-pet.js';
import { nativeText } from '../native-messages.js';

interface Controller {
  getState(): Pick<DshPetState, 'enabled' | 'status' | 'config'>;
  dispatch(action: DshPetAction): Promise<unknown>;
}

/** Use Quotern's persistent tray even when the last helper window has closed. */
export function buildDshPetTrayMenu(controller: Controller | null, locale: SupportedLocale): MenuItemConstructorOptions[] {
  if (!controller) return [];
  let state: ReturnType<Controller['getState']>;
  try {
    state = controller.getState();
  } catch {
    console.error('[tud-desktop] could not read independent pet tray configuration');
    return [{ id: 'dsh-pets', label: nativeText(locale, 'native.tray.dshPets'), enabled: false }];
  }
  const dispatch = (action: DshPetAction) => {
    void controller.dispatch(action).catch(error => {
      console.error('[tud-desktop] independent pet tray action failed:', error instanceof Error ? error.message : 'unknown');
    });
  };
  return [{
    id: 'dsh-pets',
    label: nativeText(locale, 'native.tray.dshPets'),
    type: 'checkbox', checked: state.enabled, enabled: state.status !== 'starting',
    click: item => dispatch({ type: 'set-enabled', enabled: item.checked }),
  }];
}
