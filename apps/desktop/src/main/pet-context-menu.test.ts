import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPetContextMenu, findPetMenuItem, withDshActions, runPetMenuCommand, type PetMenuPorts } from './pet-context-menu.js';

const catalog = [{ id: 'clawd', displayName: 'Clawd' }, { id: 'custom-cat', displayName: 'My cat' }];
const model = (kind: 'builtin' | 'dsh', locale: 'zh-CN' | 'en' | 'ja' | 'ko' = 'en') => buildPetContextMenu({ kind, locale, catalog, character: 'custom-cat', size: 'medium', dshAvailable: true, syncing: false });

test('both pets expose the same base commands, all characters and their actual selected size', () => {
  for (const kind of ['builtin', 'dsh'] as const) {
    const menu = model(kind);
    assert.deepEqual(menu.items.filter(item => item.command).map(item => item.id), ['open', 'sync', 'settings', 'hide']);
    assert.equal(findPetMenuItem(menu.items, 'size:medium')?.checked, true);
    assert.equal(findPetMenuItem(menu.items, 'character:dsh')?.checked, kind === 'dsh');
    assert.equal(findPetMenuItem(menu.items, 'character:builtin:custom-cat')?.checked, kind === 'builtin');
    assert.deepEqual(findPetMenuItem(menu.items, 'characters')?.submenu?.map(item => item.label), ['大肥鱼', 'Clawd', 'My cat']);
    assert.equal(findPetMenuItem(menu.items, 'display'), undefined);
  }
});

test('dsh extras retain playable leaves and translate fixed groups without changing asset names', () => {
  const menu = withDshActions(model('dsh'), [{ label: '动作', children: [{ label: '待机', children: [{ label: '悠闲哼歌', anim: '悠闲哼歌' }] }] }]);
  const actions = findPetMenuItem(menu.items, 'actions')!;
  assert.equal(actions.label, 'Actions');
  assert.equal(actions.submenu?.[0]?.label, 'Idle');
  assert.equal(actions.submenu?.[0]?.submenu?.[0]?.label, '悠闲哼歌');
  assert.deepEqual(actions.submenu?.[0]?.submenu?.[0]?.local, { anim: '悠闲哼歌' });
  assert.equal(findPetMenuItem(menu.items, 'balance')?.label, 'View quota and balance');
  assert.deepEqual(findPetMenuItem(menu.items, 'home')?.local, { action: 'home' });
  for (const locale of ['zh-CN', 'en', 'ja', 'ko'] as const) {
    const translated = model('dsh', locale);
    for (const id of ['open', 'sync', 'sizes', 'characters', 'balance', 'actions', 'more', 'settings', 'hide']) assert.ok(findPetMenuItem(translated.items, id)?.label);
  }
});

test('the helper menu receives the same explicit appearance as the host', () => {
  const menu = buildPetContextMenu({ kind: 'dsh', locale: 'en', catalog, character: 'clawd', size: 'medium', syncing: false, dshAvailable: true, theme: 'dark' });
  assert.equal(menu.theme, 'dark');
});

test('commands use fresh state and the clicked pet, and reject disabled, local or removed entries', async () => {
  const calls: unknown[] = [];
  let current = model('dsh');
  const ports: PetMenuPorts = {
    getMenu: () => current,
    open: async () => { calls.push('open'); }, sync: async () => { calls.push('sync'); },
    size: async (kind, size) => { calls.push([kind, size]); },
    select: async target => { calls.push(target); }, settings: async target => { calls.push(['settings', target]); },
    hide: async () => { calls.push('hide'); },
  };
  await runPetMenuCommand('size:small', 'dsh', ports);
  await runPetMenuCommand('settings', 'dsh', ports);
  await runPetMenuCommand('character:builtin:custom-cat', 'dsh', ports);
  assert.deepEqual(calls, [['dsh', 'small'], ['settings', { kind: 'dsh' }], { kind: 'builtin', character: 'custom-cat' }]);
  current = buildPetContextMenu({ kind: 'dsh', locale: 'en', catalog: [], character: 'clawd', size: 'large', dshAvailable: true, syncing: true });
  for (const id of ['sync', 'character:builtin:custom-cat', 'home', 'unknown']) await assert.rejects(runPetMenuCommand(id, 'dsh', ports));
  assert.equal(calls.length, 3);
});
