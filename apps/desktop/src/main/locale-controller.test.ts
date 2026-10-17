import assert from 'node:assert/strict';
import test from 'node:test';
import type { LocalePreference, SupportedLocale } from 'quotern-i18n';
import type { DesktopLocaleState } from '../shared/locale.js';
import type { createLocaleController as CreateLocaleController } from './locale-controller.js';

const { createLocaleController } = require('./locale-controller.js') as {
  createLocaleController: typeof CreateLocaleController;
};

test('system choice resolves the preferred languages and a saved choice broadcasts only after persistence', async () => {
  let saved: LocalePreference = 'system';
  let languages = ['fr-FR', 'ko-KR'];
  const events: DesktopLocaleState[] = [];
  const controller = createLocaleController({
    readPreference: async () => saved,
    writePreference: async (next: LocalePreference) => { saved = next; },
    preferredLanguages: () => languages,
    resolve: (preference: LocalePreference, systemLanguages: readonly string[]): SupportedLocale =>
      preference === 'system' ? (systemLanguages.includes('ko-KR') ? 'ko' : 'zh-CN') : preference,
    broadcast: (state: DesktopLocaleState) => events.push({ ...state }),
  });

  await controller.initialize();
  assert.deepEqual(controller.getState(), { preference: 'system', resolved: 'ko' });
  assert.deepEqual(events, []);

  await controller.setPreference('ja');
  assert.equal(saved, 'ja');
  assert.deepEqual(controller.getState(), { preference: 'ja', resolved: 'ja' });
  assert.deepEqual(events, [{ preference: 'ja', resolved: 'ja' }]);

  languages = ['en-US'];
  controller.refreshSystem();
  assert.equal(events.length, 1, 'a manual choice ignores system-language changes');
});

test('failed persistence leaves the old state visible and sends no locale event', async () => {
  const events: unknown[] = [];
  const controller = createLocaleController({
    readPreference: async () => 'system',
    writePreference: async () => { throw new Error('disk full'); },
    preferredLanguages: () => ['en-US'],
    resolve: (preference: LocalePreference): SupportedLocale => preference === 'system' ? 'en' : preference,
    broadcast: (state: unknown) => events.push(state),
  });
  await controller.initialize();

  await assert.rejects(controller.setPreference('ko'), /disk full/);
  assert.deepEqual(controller.getState(), { preference: 'system', resolved: 'en' });
  assert.deepEqual(events, []);
});

test('system choice broadcasts when the preferred OS language changes', async () => {
  let languages = ['ko-KR'];
  const events: DesktopLocaleState[] = [];
  const controller = createLocaleController({
    readPreference: async () => 'system',
    writePreference: async () => {},
    preferredLanguages: () => languages,
    resolve: (_preference: LocalePreference, systemLanguages: readonly string[]): SupportedLocale => systemLanguages[0]!.startsWith('ko') ? 'ko' : 'en',
    broadcast: (state: DesktopLocaleState) => events.push({ ...state }),
  });
  await controller.initialize();
  languages = ['en-US'];
  controller.refreshSystem();
  assert.deepEqual(controller.getState(), { preference: 'system', resolved: 'en' });
  assert.deepEqual(events, [{ preference: 'system', resolved: 'en' }]);
});
