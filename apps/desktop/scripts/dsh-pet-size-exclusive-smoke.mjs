// Opt-in Windows acceptance: real settings, independent helper and legacy startup.
// node scripts/dsh-pet-size-exclusive-smoke.mjs <electron.exe> <fresh-output-directory>
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchProbe, wait } from './desktop-cdp.mjs';

const [executable, output] = process.argv.slice(2);
assert.ok(executable && output, 'electron.exe fresh-output-directory');
const desktop = fileURLToPath(new URL('../', import.meta.url));
const directory = path.resolve(output);
const profile = path.join(directory, 'seeded-profile');
await mkdir(path.join(profile, 'dsh-pet'), { recursive: true });
await writeFile(path.join(profile, 'pet-settings.json'), JSON.stringify({ visible: true, character: 'clawd', size: 'medium' }));
await writeFile(path.join(profile, 'dsh-pet/preferences.json'), JSON.stringify({ enabled: true }));
const probe = await launchProbe(executable, directory, { args: [desktop], env: { QUOTERN_DESKTOP_USER_DATA: profile } });
const checks = [];
const until = async (predicate, label) => {
  for (let i = 0; i < 150; i++) { if (await predicate()) return; await wait(100); }
  throw Error(`Timed out: ${label}`);
};
try {
  const page = await probe.connect(target => !/pet\.html/.test(target.url));
  const ev = expression => page.evaluate(expression);
  await until(() => ev('Boolean(window.tud?.dshPet && window.tud?.pet)'), 'preload');
  const state = () => ev('Promise.all([window.tud.pet.getState(), window.tud.dshPet.getState()])');
  await until(async () => (await state())[1].status === 'running', 'startup helper');
  assert.equal((await state())[0].settings.visible, false);
  assert.equal(JSON.parse(await readFile(path.join(profile, 'pet-settings.json'), 'utf8')).visible, false);
  checks.push('legacy double-enabled startup persists only dsh-pet');
  await until(() => ev('document.querySelectorAll("button").length > 3'), 'application mount');
  await wait(500);
  await ev("window.dispatchEvent(new CustomEvent('tud:open-settings',{detail:{tab:'app'}})); true;");
  await until(() => ev('Boolean(document.querySelector("[data-pet-settings=dsh]"))'), 'settings');
  await page.click("[...document.querySelectorAll('button')].find(el=>el.textContent.includes('dsh-pet'))");
  const section = 'document.querySelector("[data-pet-settings=dsh]")';
  await page.click(`(${section}).querySelector('summary')`);
  const text = await ev(`(${section}).innerText`);
  assert.doesNotMatch(text, /初始角落|水平偏移|垂直偏移|仅运行一只桌宠|模型 API|自动碎碎念|清除聊天记忆/);
  checks.push('removed settings and model UI absent');
  for (const [label, width] of [['小', 160], ['中', 204], ['大', 264]]) {
    const button = `[...(${section}).querySelectorAll('button')].find(el=>el.textContent.trim()===${JSON.stringify(label)})`;
    await page.click(button);
    await until(async () => { const [, pet] = await state(); return pet.config.main.pets[0].size === width && pet.status === 'running'; }, `size ${label}`);
    assert.equal(await ev(`(${button}).getAttribute('aria-pressed')`), 'true');
    checks.push(`size ${label}: ${width}px canvas`);
  }
  await page.screenshot(path.join(directory, 'settings.png'));
  await ev('window.tud.pet.setSettings({visible:true})');
  let [builtin, dsh] = await state();
  assert.equal(builtin.settings.visible, true); assert.equal(dsh.enabled, false); assert.equal(dsh.status, 'disabled');
  checks.push('enabling Clawd closes and disables dsh helper');
  await page.click(`(${section}).querySelector('[data-slot="switch-control"]')`);
  await until(async () => (await state())[1].status === 'running', 'UI dsh enable');
  [builtin, dsh] = await state(); assert.equal(builtin.settings.visible, false); assert.equal(dsh.enabled, true);
  checks.push('enabling dsh from UI persists Clawd off');
  await ev('Promise.all([window.tud.pet.setSettings({visible:true}),window.tud.dshPet.dispatch({type:"set-enabled",enabled:true})])');
  [builtin, dsh] = await state(); assert.equal(Number(builtin.settings.visible) + Number(dsh.enabled), 1);
  checks.push('concurrent cross-controller activation leaves one pet');
  await ev('Promise.all([window.tud.pet.setSettings({visible:true}),window.tud.pet.setSettings({visible:false})])');
  assert.equal((await state())[0].settings.visible, false);
  await ev('Promise.all([window.tud.dshPet.dispatch({type:"set-enabled",enabled:true}),window.tud.dshPet.dispatch({type:"set-enabled",enabled:false})])');
  assert.equal((await state())[1].enabled, false);
  checks.push('both controllers preserve rapid enable then disable order');
  await ev('window.tud.dshPet.dispatch({type:"set-enabled",enabled:true})');
  for (const route of ['/chat', '/whisper']) {
    const response = await ev(`window.tud.dshPet.dispatch({type:'request',method:'POST',path:${JSON.stringify(route)},body:'{"text":"removed"}'})`);
    assert.equal(response.status, 404);
  }
  checks.push('removed service endpoints return 404');
  await writeFile(path.join(directory, 'result.json'), JSON.stringify({ ok: true, checks }, null, 2));
  console.log(JSON.stringify({ ok: true, checks, directory }, null, 2));
} catch (error) {
  const page = await probe.connect(target => !/pet\.html/.test(target.url));
  await page.screenshot(path.join(directory, 'failure.png'));
  await writeFile(path.join(directory, 'failure.txt'), await page.evaluate('document.body.innerText'));
  throw error;
} finally { await probe.close(); }
