// Opt-in native host acceptance for login preferences and legacy fish display transitions.
// Drives the client bridge, not native tray menu clicks.
// node dsh-pet-tray-smoke.mjs <Quotern.exe> <new-output-directory>
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchProbe, wait } from './desktop-cdp.mjs';

const [host, output] = process.argv.slice(2);
assert.ok(host && output, 'Quotern.exe fresh-output-directory');
const directory = path.resolve(output);
assert.equal(existsSync(directory), false, 'use a fresh acceptance directory');
const probe = await launchProbe(host, directory, { webview2: true });
const deadline = setTimeout(() => probe.child.kill(), 45_000);
const checks = [];
const until = async (predicate, label) => {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (await predicate()) return;
    await wait(100);
  }
  throw Error(`Timed out: ${label}`);
};
try {
  const main = await probe.connect(target => target.url.includes('tauri.localhost'));
  await until(() => main.evaluate('Boolean(window.tud?.dshPet && window.tud?.pet)'), 'main bridge');
  const ev = expression => main.evaluate(expression);
  const dispatch = action => ev(`window.tud.dshPet.dispatch(${JSON.stringify(action)})`);
  const state = () => ev('window.tud.dshPet.getState()');
  const display = async () => (await state()).config.main.pets[0].display;
  const helperReady = async () => {
    const page = await probe.connect(target => target.url.includes('/dsh/index.html'));
    await until(() => page.evaluate('Boolean(window.__dshPetDebug?.configOk && document.querySelector(".pet-hit"))'), 'loaded fish');
    assert.equal(await page.evaluate('window.__dshPetDebug.errors.length'), 0);
  };
  await ev('window.tud.setOpenAtLogin(false)');
  assert.equal(await ev('window.tud.getOpenAtLogin()'), false);
  await ev('window.tud.setOpenAtLogin(true)');
  await until(() => ev('window.tud.getOpenAtLogin()'), 'save autostart preference');
  assert.equal(JSON.parse(await readFile(path.join(directory, 'profile', 'desktop-prefs.json'), 'utf8')).openAtLogin, true);
  checks.push('autostart-preference-persists-in-isolated-profile');
  const pet = (await state()).config.main.pets[0];
  await dispatch({ type: 'patch-config', patch: { notificationsEnabled: false, pets: [
    { ...pet, size: 180, display: 'both', balanceEnabled: false, fixedEnabled: true },
    { ...pet, id: 'legacy', display: 'desktop' },
  ] } });
  await ev("window.tud.pet.select({kind:'dsh'})");
  await ev('window.tud.pet.setEnabled(true)');
  await helperReady(); checks.push('fish-loads-with-existing-patches');
  for (const [visibleDisplay, hiddenDisplay] of [['both', 'web'], ['desktop', 'none']]) {
    if (await display() !== visibleDisplay) {
      await dispatch({ type: 'patch-config', patch: { pets: [{ ...pet, size: 180, display: visibleDisplay, balanceEnabled: false, fixedEnabled: true }] } });
      await helperReady();
    }
    await ev('window.tud.pet.setEnabled(false)');
    await until(async () => { const current = await state(); return !current.enabled && current.status === 'disabled'; }, 'stop companion and background tasks');
    assert.equal(await display(), visibleDisplay, 'disabling preserves the configured display bits');
    checks.push(`bridge-stops:${visibleDisplay}`);
    await ev('window.tud.pet.setEnabled(true)');
    await until(async () => await display() === visibleDisplay && (await state()).status === 'running', 'restore last fish');
    await helperReady(); checks.push(`bridge-restores:${visibleDisplay}`);
    await dispatch({ type: 'request', method: 'POST', path: '/pet-display', body: JSON.stringify({ id: 'main', display: hiddenDisplay }) });
    await until(async () => { const current = await state(); return !current.enabled && current.status === 'disabled'; }, 'fish menu hiding stops the subsystem');
    await ev('window.tud.pet.setEnabled(true)');
    await until(async () => await display() === visibleDisplay && (await state()).status === 'running', 'restore from legacy hidden state');
    await helperReady(); checks.push(`restore-hidden:${hiddenDisplay}->${visibleDisplay}`);
  }
  console.log(JSON.stringify({ ok: true, checks }));
  await writeFile(path.join(directory, 'result.json'), JSON.stringify({ ok: true, checks }, null, 2));
} finally {
  clearTimeout(deadline);
  await probe.close();
  await until(() => probe.child.exitCode !== null || probe.child.signalCode !== null, 'native host exit');
  await until(async () => { try { await access(path.join(directory, 'data', 'tud.pid')); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } }, 'owner pid removed');
}
