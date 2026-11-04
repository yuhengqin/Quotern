import type { MenuItemConstructorOptions } from 'electron';
import type { SupportedLocale } from 'quotern-i18n';
import type { PetKind, PetSelection } from '../shared/pet.js';
import type { PetSize } from './pet-core.js';
import { nativeText, type NativeMessageKey } from './native-messages.js';

export type PetMenuCommand =
  | { action: 'open' | 'sync' | 'hide' }
  | { action: 'size'; kind: PetKind; size: PetSize }
  | { action: 'select' | 'settings'; target: PetSelection };
export interface PetMenuItem {
  id: string; label?: string; type?: 'separator' | 'radio'; checked?: boolean; enabled?: boolean;
  command?: PetMenuCommand; local?: { action?: string; anim?: string }; submenu?: PetMenuItem[];
}
export interface PetContextMenu { locale: SupportedLocale; theme: 'system' | 'light' | 'dark'; items: PetMenuItem[] }
interface MenuState {
  kind: PetKind; locale: SupportedLocale; catalog: readonly { id: string; displayName: string }[];
  character: string; size: PetSize; dshAvailable: boolean; syncing: boolean;
  theme?: PetContextMenu['theme'];
}

/** JSON-only model: both Electron processes render exactly the same base menu. */
export function buildPetContextMenu(state: MenuState): PetContextMenu {
  const t = (key: NativeMessageKey) => nativeText(state.locale, key);
  const target: PetSelection = state.kind === 'dsh' ? { kind: 'dsh' } : { kind: 'builtin', character: state.character };
  const characters: PetMenuItem[] = [
    ...(state.dshAvailable ? [{ id: 'character:dsh', label: t('native.tray.dshPets'), type: 'radio' as const, checked: state.kind === 'dsh', command: { action: 'select' as const, target: { kind: 'dsh' as const } } }] : []),
    ...state.catalog.map(pet => ({ id: `character:builtin:${pet.id}`, label: pet.displayName, type: 'radio' as const, checked: state.kind === 'builtin' && state.character === pet.id, command: { action: 'select' as const, target: { kind: 'builtin' as const, character: pet.id } } })),
  ];
  return { locale: state.locale, theme: state.theme ?? 'system', items: [
    { id: 'open', label: t('native.pet.openMain'), command: { action: 'open' } },
    { id: 'sync', label: t('native.tray.sync'), enabled: !state.syncing, command: { action: 'sync' } },
    { id: 'separator-settings', type: 'separator' },
    { id: 'sizes', label: t('native.pet.size'), submenu: (['small', 'medium', 'large'] as const).map(size => ({ id: `size:${size}`, label: t(`native.pet.${size}`), type: 'radio', checked: state.size === size, command: { action: 'size', kind: state.kind, size } })) },
    { id: 'characters', label: t('native.pet.character'), submenu: characters },
    ...(state.kind === 'dsh' ? [
      { id: 'separator-extra', type: 'separator' as const },
      { id: 'balance', label: t('native.pet.balance'), local: { action: 'show-balance' } },
      { id: 'actions', label: t('native.pet.actions'), enabled: false, submenu: [] },
      { id: 'more', label: t('native.pet.more'), submenu: [
        { id: 'home', label: t('native.pet.home'), local: { action: 'home' } },
        { id: 'reload', label: t('native.pet.reload'), local: { action: 'reload' } },
      ] },
    ] : []),
    { id: 'separator-end', type: 'separator' },
    { id: 'settings', label: t('native.pet.settings'), command: { action: 'settings', target } },
    { id: 'hide', label: t('native.pet.hide'), command: { action: 'hide' } },
  ] };
}

export function findPetMenuItem(items: readonly PetMenuItem[], id: string): PetMenuItem | undefined {
  for (const item of items) {
    if (item.id === id) return item;
    const found = item.submenu && findPetMenuItem(item.submenu, id);
    if (found) return found;
  }
}

const categoryKeys: Record<string, NativeMessageKey> = {
  '待机': 'native.pet.idle', '转向': 'native.pet.turn', '拖拽': 'native.pet.drag', '点击回应': 'native.pet.click', '移动': 'native.pet.move',
  '余额档位': 'native.pet.quotaActions', '碎碎念': 'native.pet.whisper', '工作状态': 'native.pet.workStatus',
  '小动作': 'native.pet.smallActions', '玩耍': 'native.pet.play', '吃什么': 'native.pet.food', '时节': 'native.pet.season', '文字': 'native.pet.textActions',
};

/** Only authored animation names cross from renderer; tool commands come from host. */
export function withDshActions(menu: PetContextMenu, tree: unknown): PetContextMenu {
  if (!Array.isArray(tree)) throw new Error('Invalid animation menu');
  let count = 0;
  const convert = (raw: unknown, depth: number): PetMenuItem => {
    if (++count > 4096 || depth > 6 || !raw || typeof raw !== 'object') throw new Error('Invalid animation menu');
    const node = raw as { label?: unknown; children?: unknown; anim?: unknown };
    if (typeof node.label !== 'string' || node.label.length > 512) throw new Error('Invalid animation label');
    const id = `animation:${count}`;
    if (Array.isArray(node.children)) return { id, label: categoryKeys[node.label] ? nativeText(menu.locale, categoryKeys[node.label]!) : node.label, submenu: node.children.map(child => convert(child, depth + 1)) };
    if (typeof node.anim !== 'string' || !node.anim || node.anim.length > 512) throw new Error('Invalid animation action');
    return { id, label: node.label, local: { anim: node.anim } };
  };
  const root = tree[0] as { children?: unknown } | undefined;
  const submenu = Array.isArray(root?.children) ? root.children.map(child => convert(child, 0)) : [];
  return { ...menu, items: menu.items.map(item => item.id === 'actions' ? { ...item, enabled: submenu.length > 0, submenu } : item) };
}

export function toNativePetMenuTemplate(items: readonly PetMenuItem[], select: (item: PetMenuItem) => void): MenuItemConstructorOptions[] {
  return items.map(item => item.type === 'separator' ? { id: item.id, type: 'separator' } : {
    id: item.id, label: item.label, type: item.type, checked: item.checked, enabled: item.enabled,
    ...(item.submenu ? { submenu: toNativePetMenuTemplate(item.submenu, select) } : { click: () => select(item) }),
  });
}

export interface PetMenuPorts {
  getMenu(kind: PetKind): PetContextMenu;
  open(): Promise<void>; sync(): Promise<void>; hide(): Promise<void>;
  size(kind: PetKind, size: PetSize): Promise<void>;
  select(target: PetSelection): Promise<void>; settings(target: PetSelection): Promise<void>;
}

export async function runPetMenuCommand(id: string, kind: PetKind, ports: PetMenuPorts): Promise<void> {
  const menu = ports.getMenu(kind), item = findPetMenuItem(menu.items, id);
  if (!item?.command || item.enabled === false) throw new Error(nativeText(menu.locale, 'native.pet.invalidOperation'));
  const command = item.command;
  switch (command.action) {
    case 'open': return ports.open();
    case 'sync': return ports.sync();
    case 'hide': return ports.hide();
    case 'size': return ports.size(command.kind, command.size);
    case 'select': return ports.select(command.target);
    case 'settings': return ports.settings(command.target);
  }
}
