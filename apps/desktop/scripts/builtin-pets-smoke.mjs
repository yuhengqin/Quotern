// Opt-in Windows acceptance: node scripts/builtin-pets-smoke.mjs <electron.exe> <fresh-output-directory>
import assert from 'node:assert/strict';
import { access, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchProbe, wait } from './desktop-cdp.mjs';

const [executable, output] = process.argv.slice(2);
assert.ok(executable && output, 'electron.exe fresh-output-directory');
const desktop = fileURLToPath(new URL('../', import.meta.url));
const directory = path.resolve(output);
const ids = ['doro', 'guga', 'ikun', 'luoxiaohei2d', 'monthly-salary-cat', 'xiaoba'];
const probe = await launchProbe(executable, directory, { args: [desktop] });
let page;
const until = async (predicate, label) => {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await predicate()) return;
    await wait(100);
  }
  throw Error(`Timed out: ${label}`);
};
try {
  page = await probe.connect(target => /index\.html/.test(target.url));
  await until(() => page.evaluate('Boolean(window.tud?.pet?.select)'), 'pet preload');
  await page.evaluate("window.tud.setLocalePreference('zh-CN')");
  const pets = await page.evaluate('(async () => (await window.tud.pet.getState()).catalog)()');
  assert.deepEqual(pets.map(pet => pet.id), ['clawd', 'bot', ...ids]);
  assert.ok(pets.every(pet => !pet.custom));
  await assert.rejects(access(path.join(directory, 'electron/pets')), { code: 'ENOENT' });
  const root = 'document.querySelector(\'section[aria-label="桌面宠物设置"]\')';
  await until(async () => {
    await page.evaluate("window.dispatchEvent(new CustomEvent('tud:open-settings',{detail:{tab:'pet'}})); true");
    return page.evaluate(`Boolean((${root})?.querySelector('[role="switch"]'))`);
  }, 'pet settings');
  const results = [];
  for (const id of ids) {
    const pet = pets.find(entry => entry.id === id);
    const dimensions = await page.evaluate(`(async () => { const image = new Image(); image.src = ${JSON.stringify(pet.assetUrl)}; await image.decode(); return [image.naturalWidth, image.naturalHeight]; })()`);
    assert.deepEqual(dimensions, [1536, 1872]);
    const tile = `[...(${root}).querySelectorAll('button[aria-pressed]')].find(el => el.textContent.includes(${JSON.stringify(pet.displayName)}))`;
    await page.click(tile);
    const preview = `(${root}).querySelector('.pet-atlas-animated[style*="${id}/spritesheet.webp"]')`;
    await until(() => page.evaluate(`Boolean((${preview})?.checkVisibility())`), `${id} preview`);
    await page.evaluate(`window.tud.pet.select({kind:'builtin',character:${JSON.stringify(id)}})`);
    await page.evaluate('window.tud.pet.setEnabled(true)');
    const overlay = await probe.connect(target => /pet\.html/.test(target.url));
    await until(() => overlay.evaluate(`Boolean(document.querySelector('.pet-atlas-animated[style*="${id}/spritesheet.webp"]'))`), `${id} desktop overlay`);
    assert.deepEqual(overlay.errors, []);
    results.push({ id, dimensions, preview: true, overlay: true });
  }
  for (const pathname of ['/pets/unknown/spritesheet.webp', '/pets/doro/pet.json', '/pets/sprout/spritesheet.webp']) {
    assert.equal(await page.evaluate(`fetch(${JSON.stringify(`quotern-pet://builtin${pathname}`)}).then(response => response.status)`), 404);
  }
  await page.screenshot(path.join(directory, 'builtin-pets.png'));
  assert.deepEqual(page.errors, []);
  await page.evaluate('window.tud.pet.setEnabled(false)');
  await probe.close();
  const saved = JSON.parse(await readFile(path.join(directory, 'electron/pet-settings.json'), 'utf8'));
  assert.equal(saved.character, 'xiaoba');
  await assert.rejects(access(path.join(directory, 'electron/pets')), { code: 'ENOENT' });
  await writeFile(path.join(directory, 'result.json'), JSON.stringify({ ok: true, pets: results }, null, 2));
  console.log(JSON.stringify({ ok: true, pets: results, directory }, null, 2));
} catch (error) {
  await page?.screenshot(path.join(directory, 'failure.png')).catch(() => {});
  throw error;
} finally { if (probe.child.exitCode === null) await probe.close(); }
