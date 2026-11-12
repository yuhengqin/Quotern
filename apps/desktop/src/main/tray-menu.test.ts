import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { MenuItem, MenuItemConstructorOptions } from 'electron';
import { buildTrayMenuTemplate, type TrayMenuOptions } from './tray-menu.js';

function fixture() {
  const state = { autostart: false, pet: true };
  const errors: unknown[] = [];
  const actions: string[] = [];
  const options: TrayMenuOptions = {
    getLocale: () => 'zh-CN',
    showMainWindow: () => { actions.push('main'); },
    openSettings: () => { actions.push('settings'); },
    quit: () => { actions.push('quit'); },
    getAutostart: async () => state.autostart,
    setAutostart: async enabled => { state.autostart = enabled; },
    pet: {
      isEnabled: () => state.pet,
      setEnabled: async enabled => { state.pet = enabled; },
    },
    onError: error => { errors.push(error); },
  };
  return { state, errors, actions, options };
}

async function click(item: MenuItemConstructorOptions, checked?: boolean) {
  const nativeItem = { checked, enabled: true } as MenuItem;
  await item.click?.(nativeItem, undefined, {} as Electron.KeyboardEvent);
  return nativeItem;
}

test('tray keeps main/settings/quit and shows only autostart and the current pet as switches', async () => {
  const { options, actions } = fixture();
  const menu = await buildTrayMenuTemplate(options);
  assert.deepEqual(menu.map(item => item.label ?? item.type), [
    '显示主窗口', '自启动', '桌面宠物', '设置', 'separator', '退出',
  ]);
  assert.equal(menu[1]!.type, 'checkbox');
  assert.equal(menu[1]!.checked, false);
  assert.equal(menu[2]!.type, 'checkbox');
  assert.equal(menu[2]!.checked, true);
  await click(menu[0]!);
  await click(menu[3]!);
  await click(menu[5]!);
  assert.deepEqual(actions, ['main', 'settings', 'quit']);
});

test('tray switches use the selected state and reopening reads settings changed elsewhere', async () => {
  const { options, state } = fixture();
  const menu = await buildTrayMenuTemplate(options);
  await click(menu[1]!, true);
  await click(menu[2]!, false);
  assert.deepEqual(state, { autostart: true, pet: false });
  let next = await buildTrayMenuTemplate(options);
  assert.equal(next[1]!.checked, true);
  assert.equal(next[2]!.checked, false);
  state.autostart = false;
  state.pet = true;
  next = await buildTrayMenuTemplate(options);
  assert.equal(next[1]!.checked, false);
  assert.equal(next[2]!.checked, true);
});

test('failed native switch restores its check and reports the error', async () => {
  const { options, errors, state } = fixture();
  const failure = new Error('login registration failed');
  options.setAutostart = async () => { throw failure; };
  const menu = await buildTrayMenuTemplate(options);
  const nativeItem = await click(menu[1]!, true);
  assert.equal(nativeItem.checked, false);
  assert.equal(nativeItem.enabled, true);
  assert.equal(state.autostart, false);
  assert.deepEqual(errors, [failure]);
});

test('platforms without a pet controller omit the pet switch', async () => {
  const { options } = fixture();
  delete options.pet;
  const menu = await buildTrayMenuTemplate(options);
  assert.deepEqual(menu.filter(item => item.type === 'checkbox').map(item => item.label), ['自启动']);
});
