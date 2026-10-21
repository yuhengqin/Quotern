// Opt-in native Menu/Tray + real helper check. Uses a fresh directory and no collector.
// Bundle with esbuild (external: electron), then run with Electron:
// electron <bundle.cjs> <out/dsh-pet> <new-output-directory> <apps/desktop>
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app, Menu, Tray, nativeImage } from 'electron';
import { DshPetController } from '../src/main/dsh-pet/controller';
import { buildDshPetTrayMenu } from '../src/main/dsh-pet/tray-menu';
// @ts-ignore optional acceptance driver
import { connectPage, unusedPort, wait } from './desktop-cdp.mjs';

const [runtime, output, desktop] = process.argv.slice(2);
assert.ok(runtime && output && desktop, 'runtime output desktopAppPath');
const directory = path.resolve(output!);
assert.equal(existsSync(path.join(directory, 'host')), false, 'use a fresh acceptance directory');
app.setPath('userData', path.join(directory, 'profile'));

async function main() {
  await mkdir(directory, { recursive: true });
  const port = await unusedPort();
  const checks: string[] = [];
  const clients: Array<{ close(): void }> = [];
  let stdout = '', stderr = '';
  const controller = new DshPetController({
    root: path.join(directory, 'host'), runtimeRoot: path.resolve(runtime!),
    executable: process.execPath, appPath: path.resolve(desktop!), packaged: false,
    getQuota: () => null, showMainWindow: () => {}, openDirectory: async () => {}, roots: [],
    spawn: (exe, args, options) => {
      assert.equal(JSON.parse(options.env!.DSH_PET_PETS!).length, 1);
      const child = spawn(exe, [...args, `--remote-debugging-port=${port}`], options);
      child.stdout?.on('data', chunk => { stdout += chunk; });
      child.stderr?.on('data', chunk => { stderr += chunk; });
      return child;
    },
  });
  const tray = new Tray(nativeImage.createFromPath(path.join(desktop!, 'resources/icon.png')));
  const menu = () => {
    const result = Menu.buildFromTemplate(buildDshPetTrayMenu(controller, 'zh-CN'));
    tray.setContextMenu(result);
    return result;
  };
  const display = () => (controller.getState().config.main!.pets as Array<{ display: string }>)[0]!.display;
  const until = async (predicate: () => boolean | Promise<boolean>, label: string) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      if (await predicate()) return;
      await wait(100);
    }
    throw Error(`Timed out: ${label}; ${stderr}`);
  };
  const helperReady = async () => {
    let targets: Array<{ type: string }> = [];
    await until(async () => {
      try { targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); return targets.some(target => target.type === 'page'); } catch { return false; }
    }, 'real helper page');
    const page = await connectPage(targets.find(target => target.type === 'page'));
    clients.push(page);
    await until(() => page.evaluate('Boolean(window.__dshPetDebug?.configOk && document.querySelector(".pet-hit"))'), 'loaded helper');
    assert.equal(await page.evaluate('window.__dshPetDebug.errors.length'), 0);
  };
  try {
    const pet = (controller.getState().config.main!.pets as object[])[0]!;
    await controller.dispatch({ type: 'patch-config', patch: { notificationsEnabled: false, pets: [
      { ...pet, size: 180, display: 'both', balanceEnabled: false, fixedEnabled: true },
      { ...pet, id: 'legacy', display: 'desktop' },
    ] } });
    await controller.dispatch({ type: 'set-enabled', enabled: true });
    await helperReady(); checks.push('real-helper-loads-with-existing-patches');
    for (const [visibleDisplay, hiddenDisplay] of [['both', 'web'], ['desktop', 'none']] as const) {
      if (display() !== visibleDisplay) {
        await controller.dispatch({ type: 'patch-config', patch: { pets: [{ ...pet, size: 180, display: visibleDisplay, balanceEnabled: false, fixedEnabled: true }] } });
        await helperReady();
      }
      const item = menu().getMenuItemById('dsh-pets')!;
      assert.ok(!item.submenu, 'the single companion needs no submenu');
      assert.ok(item.checked); item.click(item, undefined, {} as KeyboardEvent);
      await until(() => !controller.getState().enabled && controller.getState().status === 'disabled', 'stop companion and background tasks');
      assert.equal(display(), visibleDisplay, 'disabling preserves the configured display bits');
      assert.equal(tray.isDestroyed(), false);
      checks.push(`single-checkbox-stops:${visibleDisplay}`);
      const restore = menu().getMenuItemById('dsh-pets')!;
      assert.equal(restore.checked, false); assert.equal(restore.enabled, true);
      restore.click(restore, undefined, {} as KeyboardEvent);
      await until(() => display() === visibleDisplay && controller.getState().status === 'running', 'restore last helper');
      await helperReady(); checks.push(`single-checkbox-restores:${visibleDisplay}`);
      await controller.dispatch({ type: 'request', method: 'POST', path: '/pet-display', body: JSON.stringify({ id: 'main', display: hiddenDisplay }) });
      await until(() => !controller.getState().enabled && controller.getState().status === 'disabled', 'helper menu hiding stops the subsystem');
      const hidden = menu().getMenuItemById('dsh-pets')!;
      assert.equal(hidden.checked, false); hidden.click(hidden, undefined, {} as KeyboardEvent);
      await until(() => display() === visibleDisplay && controller.getState().status === 'running', 'restore from legacy hidden state');
      await helperReady(); checks.push(`restore-hidden:${hiddenDisplay}->${visibleDisplay}`);
    }
    console.log(JSON.stringify({ ok: true, checks }));
    await writeFile(path.join(directory, 'result.json'), JSON.stringify({ ok: true, checks }, null, 2));
  } finally {
    for (const client of clients) client.close();
    await controller.dispose(); tray.destroy();
    await writeFile(path.join(directory, 'stdout.log'), stdout);
    await writeFile(path.join(directory, 'stderr.log'), stderr);
  }
}
const deadline = setTimeout(() => app.exit(2), 45_000);
void app.whenReady().then(main).then(() => { clearTimeout(deadline); app.exit(0); }, error => { clearTimeout(deadline); console.error(error); app.exit(1); });
