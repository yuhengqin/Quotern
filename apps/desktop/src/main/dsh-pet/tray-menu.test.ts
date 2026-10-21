import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { DshPetAction, DshPetState } from '../../shared/dsh-pet.js';
import { buildDshPetTrayMenu } from './tray-menu.js';

test('one tray checkbox enables or stops the single companion without a submenu', () => {
  const actions: DshPetAction[] = [];
  const state: Pick<DshPetState, 'enabled' | 'status' | 'config'> = { enabled: true, status: 'running', config: {} };
  const pets = ['desktop', 'both', 'web', 'none'].map((display, index) => ({ id: `pet.${index}`, name: '同名宠物', display }));
  const controller = { getState: () => state, config: { vendor: { flattenPetList: () => pets } }, dispatch: async (action: DshPetAction) => { actions.push(action); } };
  const item = () => buildDshPetTrayMenu(controller, 'zh-CN')[0]!;
  assert.equal(buildDshPetTrayMenu(null, 'zh-CN').length, 0);
  assert.equal(item().type, 'checkbox');
  assert.equal(item().submenu, undefined);
  assert.equal(item().checked, true);
  const click = item().click as (item: { checked: boolean }) => void;
  click({ checked: true });
  assert.deepEqual(actions[0], { type: 'set-enabled', enabled: true });
  state.enabled = false; state.status = 'disabled';
  assert.equal(item().checked, false, 'reopening reads the latest switch state');
  (item().click as (item: { checked: boolean }) => void)({ checked: false });
  assert.deepEqual(actions[1], { type: 'set-enabled', enabled: false });
  state.status = 'starting';
  assert.equal(item().enabled, false);
  assert.equal(buildDshPetTrayMenu(controller, 'en')[0]!.label, 'Independent pet');
});

test('an invalid pet config disables its submenu instead of breaking the main tray', t => {
  t.mock.method(console, 'error', () => {});
  const controller = {
    getState: (): never => { throw Error('invalid user configuration'); },
    config: { vendor: { flattenPetList: () => [] } },
    dispatch: async () => {},
  };
  const items = buildDshPetTrayMenu(controller, 'zh-CN');
  assert.equal(items[0]!.id, 'dsh-pets');
  assert.equal(items[0]!.enabled, false);
});
