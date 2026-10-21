// Run through pet-pointer-smoke.mjs: real Electron windows/preload/renderer, private profile.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, BrowserWindow, ipcMain, Menu, screen } from 'electron';
import { PetController } from '../src/main/pet-controller';
import { registerPetAssetScheme } from '../src/main/pet-catalog';
import { petSpriteRect } from '../src/main/pet-core';
import { PET_COMMAND_CHANNEL, PET_EVENT_CHANNEL } from '../src/shared/pet';

const [output, desktop] = process.argv.slice(2);
assert.ok(output && desktop);
app.setPath('userData', path.join(output!, 'profile'));
app.setPath('sessionData', path.join(output!, 'profile/session'));
app.setAppPath(desktop!);
registerPetAssetScheme();
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const until = async (read: () => unknown | Promise<unknown>, label: string) => {
  for (let i = 0; i < 150; i++) { if (await read()) return; await wait(20); }
  throw new Error(`Timed out: ${label}`);
};

async function main() {
  assert.equal(process.platform, 'win32', 'this acceptance test targets Windows');
  await mkdir(app.getPath('userData'), { recursive: true });
  const checks: string[] = [], ignores: Array<{ ignore: boolean; forward?: boolean }> = [];
  const commands: string[] = [], positions: unknown[] = [];
  let cursor = { x: -10000, y: -10000 }, polls = 0, menus = 0;
  const originalCursor = screen.getCursorScreenPoint;
  screen.getCursorScreenPoint = () => { polls++; return { ...cursor }; };
  const originalIgnore = BrowserWindow.prototype.setIgnoreMouseEvents;
  BrowserWindow.prototype.setIgnoreMouseEvents = function(ignore, options) {
    ignores.push({ ignore, forward: options?.forward });
    return originalIgnore.call(this, ignore, options);
  };
  const originalPopup = Menu.prototype.popup;
  Menu.prototype.popup = function() { menus++; };
  const controller = new PetController({
    toggleMainWindow() {}, isMainWindowVisible: () => false, openSettings() {},
    getDark: () => false, getLocale: () => 'zh-CN',
  });
  // Keep controller input and native APIs real; bypass unrelated data collection.
  const internals = controller as any;
  internals.refreshData = async () => {};
  let pet: BrowserWindow | undefined;
  try {
    await controller.initialize();
    ipcMain.on(PET_COMMAND_CHANNEL, (_event, command) => commands.push(command));
    controller.toggle();
    await until(() => { pet = BrowserWindow.getAllWindows()[0]; return pet?.isVisible(); }, 'visible pet');
    await until(() => pet!.webContents.executeJavaScript('Boolean(document.querySelector("#pet-root svg"))'), 'real renderer');
    assert.ok(ignores.length);
    assert.ok(ignores.every(item => item.forward === false), 'Windows must never install mouse forwarding');
    checks.push('windows-forwarding-disabled');
    const originalSend = pet!.webContents.send.bind(pet!.webContents);
    pet!.webContents.send = (channel: string, ...args: any[]) => {
      if (channel === PET_EVENT_CHANNEL && args[0]?.type === 'pet:cursor-position') positions.push(args[0].detail);
      originalSend(channel, ...args);
    };
    const bounds = pet!.getBounds(), sprite = petSpriteRect(bounds);
    const x = Math.round(sprite.x + 12), y = Math.round(sprite.y + sprite.height / 2);
    cursor = { x: bounds.x + x, y: bounds.y + y };
    await until(() => pet!.webContents.executeJavaScript('window.__ttPetHover === true'), 'hover without DOM movement');
    await until(() => positions.length > 0, 'local cursor sample');
    assert.equal(ignores.at(-1)!.ignore, false);
    const lean = 'document.querySelector("#pet-root > div > div:nth-child(2) > div").style.transform';
    await until(async () => (await pet!.webContents.executeJavaScript(lean)).includes('translateX(-'), 'sampled hover lean');
    checks.push('hover-and-lean-without-forwarded-dom-events');
    await wait(60);
    const stationary = positions.length, ignoreCount = ignores.length;
    await wait(100);
    assert.equal(positions.length, stationary, 'stationary cursor does not send repeated IPC');
    assert.equal(ignores.length, ignoreCount, 'unchanged hit tests do not repeat native calls');
    checks.push('stationary-samples-and-native-calls-deduplicated');

    // Pointer capture must survive leaving the hit area before crossing 10px.
    pet!.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x, y });
    await until(() => commands.includes('pointer-down'), 'press lease');
    cursor = { x: bounds.x + 20, y: bounds.y + 10 };
    await wait(65);
    assert.equal(ignores.at(-1)!.ignore, false, 'pressed pointer remains interactive outside the sprite');
    pet!.webContents.sendInputEvent({ type: 'mouseMove', x: x + 6, y });
    pet!.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x: x + 6, y });
    await until(() => commands.includes('pointer-up'), 'release lease');
    assert.ok(!commands.some(command => command.startsWith('drag-')), 'small movement remains a tap');
    await until(() => ignores.at(-1)!.ignore, 'release restores passthrough');
    checks.push('press-lease-small-movement-and-release');

    cursor = { x: bounds.x + x, y: bounds.y + y };
    await until(() => !ignores.at(-1)!.ignore, 'return to sprite');
    pet!.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x, y });
    pet!.webContents.sendInputEvent({ type: 'mouseMove', x: x + 25, y });
    await until(() => commands.includes('drag-right'), 'drag threshold');
    cursor = { x: cursor.x + 75, y: cursor.y };
    await until(() => pet!.getBounds().x > bounds.x + 30, 'native right drag');
    cursor = { x: cursor.x - 120, y: cursor.y };
    await until(() => pet!.webContents.executeJavaScript('window.__ttPetDragState === "running-left"'), 'reverse direction');
    pet!.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x, y });
    await until(() => pet!.webContents.executeJavaScript('window.__ttPetDragState === null'), 'drag release');
    checks.push('captured-drag-moves-reverses-and-ends');

    const cancelledBounds = pet!.getBounds();
    cursor = { x: cancelledBounds.x + x, y: cancelledBounds.y + y };
    await until(() => !ignores.at(-1)!.ignore, 'cancel hit');
    pet!.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x, y });
    const releases = commands.filter(command => command === 'pointer-up').length;
    await until(() => internals.pointerPressed, 'pressed before cancel');
    await pet!.webContents.executeJavaScript('document.querySelector("#pet-root > div").dispatchEvent(new PointerEvent("pointercancel", { bubbles: true, pointerId: 1 }))');
    await until(() => commands.filter(command => command === 'pointer-up').length > releases, 'cancel releases lease');
    pet!.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x, y });
    cursor = { x: -10000, y: -10000 };
    await until(() => ignores.at(-1)!.ignore, 'cancel restores passthrough');
    checks.push('pointer-cancel-releases-input');

    const now = pet!.getBounds();
    cursor = { x: now.x + x, y: now.y + y };
    await until(() => !ignores.at(-1)!.ignore, 'context menu hit');
    pet!.webContents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, x, y });
    pet!.webContents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, x, y });
    await until(() => menus === 1, 'native context menu callback');
    checks.push('right-click-menu-callback');

    cursor = { x: -10000, y: -10000 };
    await until(() => ignores.at(-1)!.ignore, 'transparent outside');
    await until(() => pet!.webContents.executeJavaScript('window.__ttPetHover === false'), 'hover leave');
    await wait(40);
    const outside = positions.length;
    for (let i = 0; i < 8; i++) { cursor.x -= 10; await wait(20); }
    assert.equal(positions.length, outside, 'distant movement does not stream coordinates');
    checks.push('leave-restores-passthrough-and-stops-coordinate-stream');

    // Reach the edge through the real drag path, then cross its transparent gap.
    const beforeDock = pet!.getBounds();
    const work = screen.getAllDisplays().map(display => display.workArea)
      .reduce((rightmost, area) => area.x + area.width > rightmost.x + rightmost.width ? area : rightmost);
    cursor = { x: beforeDock.x + x, y: beforeDock.y + y };
    await until(() => !ignores.at(-1)!.ignore, 'dock drag hit');
    const starts = commands.filter(command => command === 'drag-right').length;
    pet!.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, x, y });
    pet!.webContents.sendInputEvent({ type: 'mouseMove', x: x + 25, y });
    await until(() => commands.filter(command => command === 'drag-right').length > starts, 'dock drag starts');
    cursor = { x: work.x + work.width - 2, y: work.y + Math.min(work.height - 1, y + 50) };
    await until(() => pet!.getBounds().x >= work.x + work.width - bounds.width, 'drag reaches edge');
    pet!.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, x, y });
    await until(() => internals.dragging === null, 'edge drag release');
    cursor = { x: -10000, y: -10000 };
    const tuckedX = Math.round(work.x + work.width - sprite.x - 30);
    await until(() => pet!.getBounds().x === tuckedX, 'edge tucks');
    const dockBounds = pet!.getBounds();
    cursor = { x: work.x + work.width - 5, y: dockBounds.y + y };
    await until(() => pet!.getBounds().x === work.x + work.width - bounds.width, 'hover reveals edge');
    await wait(70);
    assert.equal(await pet!.webContents.executeJavaScript('window.__ttPetHover'), true);
    assert.equal(ignores.at(-1)!.ignore, true, 'transparent edge gap still passes clicks through');
    cursor = { x: -10000, y: -10000 };
    await until(() => pet!.getBounds().x === tuckedX, 'leave tucks edge');
    checks.push('edge-reveal-gap-passthrough-and-tuck');

    await controller.hide();
    const hiddenPolls = polls;
    await wait(100);
    assert.equal(polls, hiddenPolls, 'hiding stops OS cursor polling');
    assert.equal(ignores.at(-1)!.ignore, true);
    assert.ok(ignores.every(item => item.forward === false));
    checks.push('hide-stops-polling-without-forwarding');
    controller.toggle();
    await until(() => pet!.isVisible(), 'show existing window again');
    cursor = { x: work.x + work.width - 5, y: pet!.getBounds().y + y };
    await until(() => pet!.webContents.executeJavaScript('window.__ttPetHover === true'), 'hover after showing again');
    checks.push('reshow-resumes-hover');
    await writeFile(path.join(output!, 'result.json'), JSON.stringify({ ok: true, checks, ignores }, null, 2));
    console.log(JSON.stringify({ ok: true, checks }));
  } catch (error) {
    const failure = { message: String(error), checks, cursor, bounds: pet?.getBounds(),
      workAreas: screen.getAllDisplays().map(display => display.workArea),
      base: internals.basePosition, docked: internals.docked, pressed: internals.pointerPressed,
      dragging: internals.dragging, bubbleBand: internals.state.bubbleBand, commands: commands.slice(-15) };
    console.error(JSON.stringify(failure));
    await writeFile(path.join(output!, 'failure.json'), JSON.stringify(failure, null, 2));
    throw error;
  } finally {
    controller.dispose();
    screen.getCursorScreenPoint = originalCursor;
    BrowserWindow.prototype.setIgnoreMouseEvents = originalIgnore;
    Menu.prototype.popup = originalPopup;
  }
}
const deadline = setTimeout(() => app.exit(2), 30_000);
void app.whenReady().then(main).then(() => { clearTimeout(deadline); app.exit(0); }, error => {
  clearTimeout(deadline); console.error(error); app.exit(1);
});
