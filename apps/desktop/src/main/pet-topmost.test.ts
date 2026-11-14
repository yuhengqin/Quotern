import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { transformSync } from 'esbuild';

// Removing a reassertion or leaking its timer must break these lifecycle tests.
// Electron is replaced at its native boundary; the controller and geometry stay real.
function fixture(platform = 'win32') {
  const windows: PetWindow[] = [];
  const noop = () => {};
  class PetWindow extends EventEmitter {
    destroyed = false;
    visible = false;
    assertions: Array<[boolean, string]> = [];
    webContents = { on: noop, send: noop, setWindowOpenHandler: noop };
    constructor(private bounds: { x: number; y: number; width: number; height: number }) {
      super(); windows.push(this);
    }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    isAlwaysOnTop() { return true; } // The reported flag can stay true after native z-order is lost.
    setAlwaysOnTop(flag: boolean, level: string) { this.assertions.push([flag, level]); }
    setIgnoreMouseEvents() {}
    getBounds() { return this.bounds; }
    setBounds(bounds: typeof this.bounds) { this.bounds = bounds; }
    showInactive() { this.visible = true; this.emit('show'); }
    hide() { this.visible = false; this.emit('hide'); }
    loadFile() { return Promise.resolve(); }
    destroy() { this.visible = false; this.destroyed = true; this.emit('closed'); }
    static getAllWindows() { return []; }
  }
  const source = path.resolve('src/main/pet-controller.ts');
  const code = transformSync(readFileSync(source, 'utf8'), {
    loader: 'ts', format: 'cjs', target: 'node22',
    define: { 'import.meta.url': JSON.stringify(pathToFileURL(source).href), 'process.platform': JSON.stringify(platform) },
  }).code;
  const module = { exports: {} };
  new Function('require', 'module', 'exports', code)((id: string) => {
    if (id === 'electron') return {
      app: {}, BrowserWindow: PetWindow,
      screen: {
        getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
        getDisplayNearestPoint: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
        getCursorScreenPoint: () => ({ x: -10000, y: -10000 }),
        removeListener: noop,
      },
      ipcMain: { removeHandler: noop, removeAllListeners: noop },
    };
    if (id === 'quotern-core') return {};
    if (id === 'quotern-core/timezone') return { localDateNow: () => '2026-11-03' };
    if (id === './DesktopWindow') return { defaultPreloadPath: noop, resolveAppIconPath: noop };
    if (id === './pet-catalog') return { PetCatalog: class { unregisterAssetProtocol() {} } };
    if (id === './native-messages') return { nativeText: () => 'Pet' };
    if (id === './local-runtime') return {};
    if (id.startsWith('./') || id.startsWith('../')) return require(`${id}.js`);
    return require(id);
  }, module, module.exports);
  const { PetController } = module.exports as {
    PetController: new (options: unknown) => { setVisible(visible: boolean): void; dispose(): void };
  };
  const controller = new PetController({ getLocale: () => 'en' });
  return { controller, windows };
}

test('visible pet reasserts native topmost within five seconds even when the reported flag remains true', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { controller, windows } = fixture();
  try {
    controller.setVisible(true);
    const pet = windows[0]!;
    assert.deepEqual(pet.assertions, [[true, 'screen-saver']], 'showing immediately restores native z-order');
    t.mock.timers.tick(4999);
    assert.equal(pet.assertions.length, 1, 'reassertions are low frequency');
    t.mock.timers.tick(1);
    assert.deepEqual(pet.assertions, [[true, 'screen-saver'], [true, 'screen-saver']]);
  } finally { controller.dispose(); }
});

test('hiding stops topmost work and showing again starts a fresh single recovery interval', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { controller, windows } = fixture();
  try {
    controller.setVisible(true);
    const pet = windows[0]!;
    t.mock.timers.tick(500);
    controller.setVisible(false);
    const hiddenCount = pet.assertions.length;
    t.mock.timers.tick(2900);
    assert.equal(pet.assertions.length, hiddenCount, 'hidden pets do not reassert');
    controller.setVisible(true);
    assert.equal(pet.assertions.length, hiddenCount + 1, 'reshowing restores immediately');
    controller.setVisible(true);
    const shownCount = pet.assertions.length;
    t.mock.timers.tick(4999);
    assert.equal(pet.assertions.length, shownCount, 'the hidden interval was cancelled');
    t.mock.timers.tick(1);
    assert.equal(pet.assertions.length, shownCount + 1, 'repeated showing does not duplicate timers');
  } finally { controller.dispose(); }
});

test('closing and recreating a pet cannot leave an old recovery timer acting on the new window', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { controller, windows } = fixture();
  try {
    controller.setVisible(true);
    const first = windows[0]!;
    t.mock.timers.tick(1000);
    first.destroy();
    controller.setVisible(true);
    const second = windows[1]!;
    assert.deepEqual(second.assertions, [[true, 'screen-saver']]);
    t.mock.timers.tick(4999);
    assert.equal(first.assertions.length, 1, 'the closed window is never touched');
    assert.equal(second.assertions.length, 1, 'the old window interval was cancelled');
    t.mock.timers.tick(1);
    assert.equal(second.assertions.length, 2);
    controller.dispose();
    t.mock.timers.tick(10000);
    assert.equal(second.assertions.length, 2, 'disposal stops recovery');
  } finally { controller.dispose(); }
});

for (const platform of ['darwin', 'linux']) {
  test(`topmost recovery leaves ${platform} window levels unchanged`, t => {
    t.mock.timers.enable({ apis: ['setInterval'] });
    const { controller, windows } = fixture(platform);
    try {
      controller.setVisible(true);
      t.mock.timers.tick(10000);
      assert.deepEqual(windows[0]!.assertions, [], 'only Windows receives native topmost recovery');
    } finally { controller.dispose(); }
  });
}
