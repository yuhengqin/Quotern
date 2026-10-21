// Opt-in Windows acceptance against the built app with a private profile/data.
// node scripts/pet-selection-smoke.mjs <electron.exe> <fresh-output-directory>
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchProbe, wait } from './desktop-cdp.mjs';

const [executable, output] = process.argv.slice(2);
assert.ok(executable && output, 'electron.exe fresh-output-directory');
const directory = path.resolve(output);
const desktop = fileURLToPath(new URL('../', import.meta.url));
const profile = path.join(directory, 'profile');
await mkdir(profile, { recursive: true });
const checks = [];
const until = async (predicate, label) => {
  for (let i = 0; i < 150; i++) {
    if (await predicate()) return;
    await wait(100);
  }
  throw Error(`Timed out: ${label}`);
};
const start = async (name, userData = profile) => {
  const probe = await launchProbe(executable, path.join(directory, name), { args: [desktop], env: { QUOTERN_DESKTOP_USER_DATA: userData } });
  try {
    const page = await probe.connect(target => /index\.html/.test(target.url));
    await until(() => page.evaluate('Boolean(window.tud?.pet?.select)'), 'preload');
    await page.evaluate("window.tud.setLocalePreference('zh-CN')");
    const state = () => page.evaluate('Promise.all([window.tud.pet.getState(), window.tud.dshPet.getState()])');
    const root = `document.querySelector('section[aria-label="桌面宠物设置"]')`;
    await until(async () => {
      await page.evaluate("window.dispatchEvent(new CustomEvent('tud:open-settings',{detail:{tab:'pet'}})); true;");
      return page.evaluate(`Boolean((${root})?.querySelector('[role="switch"]'))`);
    }, 'settings mount');
    const idle = () => until(() => page.evaluate(`!(${root}).querySelector('[role="switch"]').disabled`), 'settings idle');
    await idle();
    const tile = name => `[...(${root}).querySelectorAll('button[aria-pressed]')].find(el => el.textContent.includes(${JSON.stringify(name)}))`;
    const button = name => `[...(${root}).querySelectorAll('button')].find(el => el.checkVisibility() && el.textContent.trim() === ${JSON.stringify(name)})`;
    const click = async expression => { await page.click(expression); await wait(60); await idle(); };
    const toggle = () => click(`(${root}).querySelector('[data-slot="switch-control"]')`);
    return { probe, page, state, root, tile, button, click, toggle };
  } catch (error) { await probe.close(); throw error; }
};

let active;
try {
  active = await start('first');
  let { page, state, root, tile, button, click, toggle } = active;
  assert.equal(await page.evaluate(`(${root}).querySelectorAll('[role="switch"]').length`), 1);
  const initial = await state();
  await click(tile('Bot'));
  await click(button('思考'));
  assert.equal((await state())[0].settings.character, initial[0].settings.character);
  assert.equal((await state())[0].settings.visible, false);
  assert.equal((await state())[1].enabled, false);
  checks.push('cards and actions only preview; exactly one global switch');
  await click(button('设为当前宠物'));
  assert.equal((await state())[0].settings.character, 'bot');
  assert.equal((await state())[0].settings.visible, false);
  await toggle();
  assert.equal((await state())[0].settings.visible, true);
  await click(tile('Clawd'));
  assert.equal((await state())[0].settings.character, 'bot');
  await page.screenshot(path.join(directory, 'builtin-preview.png'));
  checks.push('explicit apply while off preserves off; enabling uses applied Bot despite another preview');
  await click(tile('大肥鱼'));
  assert.equal(await page.evaluate(`(${tile('大肥鱼')}).textContent.trim()`), '大肥鱼');
  const previewActions = [
    ['平静', '用鲸鱼尾巴拍打地面'], ['思考', '舞狮头'], ['多任务', '原地左转奔跑'],
    ['连续使用', '堆雪人'], ['庆祝', '点击回应-开心跃动'], ['休息', '哈欠连天'],
  ];
  assert.deepEqual(await page.evaluate(`Array.from((${root}).querySelector('[data-pet-settings="dsh"] [role="group"]').querySelectorAll('button'), el => el.textContent.trim())`), previewActions.map(([label]) => label));
  for (const [label, animation] of previewActions) {
    await click(button(label));
    await until(() => page.evaluate(`(() => { const video = (${root}).querySelector('video'); return video.readyState >= 2 && !video.paused; })()`), `${label} preview decodes while inactive`);
    const media = await page.evaluate(`(() => { const video = (${root}).querySelector('video'); return { name: decodeURIComponent(new URL(video.currentSrc).pathname), playing: !video.paused, selected: (${button(label)}).getAttribute('aria-pressed') }; })()`);
    assert.equal(media.name, `/${animation}.webm`);
    assert.equal(media.playing, true);
    assert.equal(media.selected, 'true');
  }
  await page.evaluate(`window.__petPreviewBeforeReplay = (${root}).querySelector('video'); true;`);
  await click(button('休息'));
  assert.equal(await page.evaluate(`(${root}).querySelector('video') !== window.__petPreviewBeforeReplay`), true);
  await page.screenshot(path.join(directory, 'dsh-preview-states.png'));
  checks.push('dsh tile only shows 大肥鱼; six shared state labels play their assigned media; repeating a state restarts preview');
  assert.equal((await state())[0].settings.visible, true);
  assert.equal((await state())[1].enabled, false);
  await click(button('设为当前宠物'));
  await until(async () => (await state())[1].status === 'running', 'dsh helper starts');
  assert.equal((await state())[0].settings.visible, false);
  assert.equal((await state())[0].currentKind, 'dsh');
  assert.equal(await page.evaluate(`(${tile('大肥鱼')}).textContent.trim()`), '大肥鱼✓ 当前宠物');
  await click(button('小'));
  await until(async () => (await state())[1].status === 'running', 'dsh size restart');
  const config = (await state())[1].config;
  await toggle();
  assert.equal((await state())[1].enabled, false);
  assert.equal((await state())[1].status, 'disabled');
  assert.deepEqual((await state())[1].config, config);
  await click(tile('Bot'));
  assert.equal((await state())[0].currentKind, 'dsh');
  await page.screenshot(path.join(directory, 'disabled-preview.png'));
  checks.push('switching systems is exclusive; disabling preserves selected dsh and its configuration');
  assert.deepEqual(page.errors, []);
  await active.probe.close(); active = undefined;

  active = await start('second');
  ({ page, state, root, tile, button, click, toggle } = active);
  assert.equal((await state())[0].currentKind, 'dsh');
  assert.equal((await state())[1].enabled, false);
  assert.deepEqual((await state())[1].config, config);
  await click(tile('Bot'));
  await toggle();
  await until(async () => (await state())[1].status === 'running', 'restore dsh after application restart');
  assert.equal((await state())[0].settings.visible, false);
  await page.screenshot(path.join(directory, 'restored-dsh-preview.png'));
  checks.push('application restart plus enable restores dsh even while previewing Bot');
  await toggle();
  await click(button('设为当前宠物'));
  assert.equal((await state())[0].currentKind, 'builtin');
  assert.equal((await state())[0].settings.character, 'bot');
  assert.equal((await state())[0].settings.visible, false);
  assert.equal((await state())[1].enabled, false);
  assert.deepEqual(page.errors, []);
  await active.probe.close(); active = undefined;

  active = await start('third');
  ({ page, state, root, tile, click, toggle } = active);
  assert.equal((await state())[0].currentKind, 'builtin');
  assert.equal((await state())[0].settings.character, 'bot');
  await click(tile('大肥鱼'));
  await toggle();
  assert.equal((await state())[0].settings.visible, true);
  assert.equal((await state())[0].settings.character, 'bot');
  assert.equal((await state())[1].enabled, false);
  checks.push('application restart plus enable restores builtin Bot despite previewing dsh');
  await page.call('Emulation.setDeviceMetricsOverride', { width: 420, height: 800, deviceScaleFactor: 1, mobile: false });
  await wait(200);
  assert.equal(await page.evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
  await page.screenshot(path.join(directory, 'narrow.png'));
  assert.deepEqual(page.errors, []);
  checks.push('420px viewport has no horizontal overflow; all three renderers have no runtime exceptions');
  const saved = JSON.parse(await readFile(path.join(profile, 'pet-selection.json'), 'utf8'));
  assert.equal(saved.kind, 'builtin');
  await active.probe.close(); active = undefined;

  const brokenProfile = path.join(directory, 'broken-dsh-profile');
  await mkdir(path.join(brokenProfile, 'dsh-pet'), { recursive: true });
  await writeFile(path.join(brokenProfile, 'dsh-pet/preferences.json'), '{invalid-json');
  active = await start('broken-dsh', brokenProfile);
  ({ page, tile, button, click, toggle } = active);
  await click(tile('Bot'));
  await click(button('设为当前宠物'));
  await toggle();
  assert.equal((await page.evaluate('window.tud.pet.getState()')).settings.visible, true);
  assert.equal((await page.evaluate('window.tud.pet.getState()')).settings.character, 'bot');
  await toggle();
  assert.equal((await page.evaluate('window.tud.pet.getState()')).settings.visible, false);
  assert.deepEqual(page.errors, []);
  checks.push('a broken dsh configuration does not prevent builtin selection, enable or disable');
  await writeFile(path.join(directory, 'result.json'), JSON.stringify({ ok: true, checks }, null, 2));
  console.log(JSON.stringify({ ok: true, checks, directory }, null, 2));
} catch (error) {
  await active?.page.screenshot(path.join(directory, 'failure.png')).catch(() => {});
  throw error;
} finally { await active?.probe.close(); }
