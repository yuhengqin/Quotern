// Windows acceptance using native menus from this test's private Tauri process.
import assert from 'node:assert/strict';
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchProbe, wait } from './desktop-cdp.mjs';
import { defaultHost, eventually as until, ownedPetWindow } from './native-pet-probe.mjs';
import { NATIVE_MESSAGES } from '../src/main/native-messages.ts';

const desktop = fileURLToPath(new URL('../',import.meta.url));
const output = path.resolve(process.argv[2] || path.join(desktop, '../../.quotern-dev', 'native-menu-'+Date.now()));
const probe = await launchProbe(process.argv[3] || defaultHost, output, { webview2:true });
const checks = [];
let main, builtin, fish, catalog;
const inspector = ownedPetWindow(probe,'builtin'), fishInspector = ownedPetWindow(probe,'dsh');
const keys = { open:'native.pet.openMain',sync:'native.tray.sync',sizes:'native.pet.size',characters:'native.pet.character',settings:'native.pet.settings',hide:'native.pet.hide',balance:'native.pet.balance',actions:'native.pet.actions','size:small':'native.pet.small','size:medium':'native.pet.medium','size:large':'native.pet.large','character:dsh':'native.tray.dshPets' };
function identify(rows, path = [], parent = '') {
  return rows.map((item,index) => {
    const route=[...path,index];
    const known = Object.entries(keys).find(([,key]) => Object.values(NATIVE_MESSAGES).some(messages=>messages[key]===item.label));
    const character = parent==='characters' && catalog.find(p => p.displayName===item.label);
    const id = item.separator ? 'separator:'+route.join('.') : character ? 'character:builtin:'+character.id : known?.[0] || 'item:'+route.join('.');
    return {...item,id,path:route.join('.'),children:item.children?identify(item.children,route,id):undefined};
  });
}
const tree = async native => identify(await native('tree') || []);
const close = async native => { await native('close'); await wait(100); };
const open = async (page, native, selector) => {
  await page.click(selector,'right');
  await until(async () => (await tree(native)).length,'owned Win32 menu');
};
const choose = async (native,id) => {
  function find(items) { for(const row of items){if(row.id===id)return row;const child=row.children&&find(row.children);if(child)return child;} }
  const row=find(await tree(native)); assert.ok(row?.enabled, 'enabled native menu item '+id);
  await native('choose',row.path); await wait(80);
};
const check = async (name, fn) => { try {await fn();checks.push({name,ok:true});} catch(error){checks.push({name,ok:false,error:String(error)});throw Error(name,{cause:error});} };
const selection = () => main.evaluate('window.tud.pet.getSelection()');
const connectBuiltin = async () => {
  builtin = await probe.connect(p=>p.url.includes('/pet.html'));
  await until(()=>builtin.evaluate('Boolean(document.querySelector("#pet-root svg"))'),'builtin sprite');
};
const connectFish = async () => {
  fish = await probe.connect(p=>p.url.includes('/dsh/index.html'));
  await until(()=>fish.evaluate('Boolean(window.__dshPetDebug?.configOk && document.querySelector(".pet-hit"))'),'fish sprite');
};
const selectedPreview = name => main.evaluate(`Boolean([...document.querySelectorAll('button[aria-pressed="true"]')].find(b=>b.textContent.includes(${JSON.stringify(name)})))`);
const preview = name => main.click(`[...document.querySelectorAll('button[aria-pressed]')].find(b=>b.textContent.trim()===${JSON.stringify(name)})`);
const hold = async (kind,page,native,selector) => {
  if(process.env.QUOTERN_PET_MENU_VISUAL!=='1') return;
  await open(page,native,selector);
  await writeFile(path.join(output,'visual-stage.json'),JSON.stringify({kind,output,awaiting:'continue-'+kind}));
  await until(()=>access(path.join(output,'continue-'+kind)).then(()=>true,()=>false),'visual inspection',600000);
  await close(native);
};
try {
  main=await probe.connect(p=>p.url.includes('tauri.localhost'));
  await until(()=>main.evaluate('Boolean(window.tud?.pet)'),'desktop bridge');
  catalog=await main.evaluate('window.tud.pet.getState().then(s=>s.catalog)');
  await main.evaluate('window.tud.setLocalePreference("zh-CN")');
  await main.evaluate('window.tud.pet.select({kind:"builtin",character:"clawd"}).then(()=>window.tud.pet.setEnabled(true))');
  await connectBuiltin();
  let baseIds;
  await check('builtin-real-native-menu-and-all-characters', async () => {
    await open(builtin, inspector, 'document.querySelector("#pet-root svg")');
    const items = await tree(inspector); baseIds = items.filter(i => !i.id.startsWith('separator')).map(i => i.id);
    assert.deepEqual(baseIds, ['open', 'sync', 'sizes', 'characters', 'settings', 'hide']);
    const roles = items.find(i => i.id === 'characters').children;
    assert.equal(roles[0].id, 'character:dsh'); assert.ok(roles.find(i => i.id === 'character:builtin:xiaoba'));
    await writeFile(path.join(output, 'builtin-menu.json'), JSON.stringify(items, null, 2));
  });
  await check('builtin-native-size-command-persists', async () => {
    await choose(inspector, 'size:large');
    await until(() => main.evaluate('window.tud.pet.getState().then(s=>s.settings.size==="large")'), 'builtin size large');
    await open(builtin, inspector, 'document.querySelector("#pet-root svg")');
    assert.equal((await tree(inspector)).find(i => i.id === 'sizes').children.find(i => i.id === 'size:large').checked, true);
    await close(inspector);
  });
  await check('builtin-settings-targets-clicked-pet-on-every-request', async () => {
    await open(builtin, inspector, 'document.querySelector("#pet-root svg")'); await choose(inspector, 'settings');
    await until(() => selectedPreview('Clawd'), 'Clawd settings');
    for (let i = 0; i < 2; i++) {
      await preview('Bot'); assert.equal(await selectedPreview('Bot'), true);
      await open(builtin, inspector, 'document.querySelector("#pet-root svg")'); await choose(inspector, 'settings');
      await until(() => selectedPreview('Clawd'), 'repeated Clawd settings');
    }
    await main.screenshot(path.join(output, 'builtin-settings.png'));
  });
  await check('builtin-hide-resumes-same-character', async () => {
    await open(builtin, inspector, 'document.querySelector("#pet-root svg")'); await choose(inspector, 'hide');
    await until(async () => !(await selection()).enabled, 'builtin hidden');
    await main.evaluate('window.tud.pet.setEnabled(true)'); assert.equal((await selection()).currentKind, 'builtin');
    await connectBuiltin();
    assert.equal(await main.evaluate('window.tud.pet.getState().then(s=>s.settings.character)'), 'clawd');
  });
  await hold('builtin', builtin, inspector, 'document.querySelector("#pet-root svg")');
  await check('native-role-menu-switches-builtin-to-dsh-exclusively', async () => {
    await open(builtin, inspector, 'document.querySelector("#pet-root svg")'); await choose(inspector, 'character:dsh');
    await until(async () => (await selection()).currentKind === 'dsh', 'current fish');
    await connectFish();
    assert.equal(await main.evaluate('window.tud.pet.getState().then(s=>s.settings.visible)'), false);
  });
  await check('dsh-native-menu-shares-base-and-preserves-extras', async () => {
    await open(fish, fishInspector, 'document.querySelector(".pet-hit")');
    const items = await tree(fishInspector);
    assert.deepEqual(items.filter(i => baseIds.includes(i.id)).map(i => i.id), baseIds);
    assert.equal(items.some(i => i.label === '显示位置'), false);
    assert.equal(items.find(i => i.id === 'balance').label, '查看额度与余额');
    assert.ok(items.find(i => i.id === 'actions').children.length);
    for (const id of ['home', 'reload', 'more']) assert.equal(items.some(i => i.id === id), false);
    await writeFile(path.join(output, 'dsh-menu.json'), JSON.stringify(items, null, 2)); await close(fishInspector);
  });
  await check('dsh-settings-overrides-another-preview', async () => {
    await preview('Bot');
    await open(fish, fishInspector, 'document.querySelector(".pet-hit")'); await choose(fishInspector, 'settings');
    await until(() => selectedPreview('大肥鱼'), 'fish settings target');
    await main.screenshot(path.join(output, 'dsh-settings.png'));
  });
  await check('dsh-native-animation-command-reaches-real-video', async () => {
    await open(fish, fishInspector, 'document.querySelector(".pet-hit")');
    const leaf = (await tree(fishInspector)).find(i => i.id === 'actions').children[0].children[0];
    await choose(fishInspector, leaf.id);
    await until(() => fish.evaluate(`decodeURIComponent(document.querySelector('.pet-video.is-front')?.src??'').includes(${JSON.stringify(leaf.label)})`), 'selected animation plays');
    assert.equal(await fish.evaluate('sprites[0].companionManual'), true);
  });
  await check('native-menu-cancel-clears-helper-input-capture', async () => {
    await open(fish, fishInspector, 'document.querySelector(".pet-hit")'); assert.equal(await fish.evaluate('window.__dshPetDebug.inputBusy'), true);
    await close(fishInspector); await until(() => fish.evaluate('!window.__dshPetDebug.inputBusy && !window.__dshPetDebug.menuOpen'), 'helper input release');
  });
  await check('renderer-leave-and-blur-do-not-dismiss-native-submenus', async () => {
    await open(fish, fishInspector, 'document.querySelector(".pet-hit")');
    await fish.evaluate('window.dispatchEvent(new Event("mouseleave"));window.dispatchEvent(new Event("blur"));true');
    assert.ok((await tree(fishInspector)).length);
    assert.equal(await fish.evaluate('window.__dshPetDebug.menuOpen && window.__dshPetDebug.inputBusy'), true);
    await close(fishInspector);
    await until(() => fish.evaluate('!window.__dshPetDebug.inputBusy'), 'native menu cancellation after renderer leave');
  });
  for (const [size, width] of [['small', 204], ['medium', 264], ['large', 364]]) await check(`dsh-native-size:${size}`, async () => {
    await open(fish, fishInspector, 'document.querySelector(".pet-hit")'); await choose(fishInspector, `size:${size}`);
    await until(() => main.evaluate(`window.tud.dshPet.getState().then(s=>s.status==='running'&&s.config.main.pets[0].size===${width})`), 'helper resize persisted');
    await connectFish();
    await until(() => fish.evaluate(`sprites[0].size===${width}`), 'resized actual sprite');
  });
  for (const [locale, openLabel] of [['en', 'Open Quotern'], ['ja', 'Quotern を開く'], ['ko', 'Quotern 열기'], ['zh-CN', '打开 Quotern']]) await check(`live-language:${locale}`, async () => {
    await main.evaluate(`window.tud.setLocalePreference(${JSON.stringify(locale)})`);
    await open(fish, fishInspector, 'document.querySelector(".pet-hit")');
    assert.equal((await tree(fishInspector)).find(i => i.id === 'open').label, openLabel); await close(fishInspector);
  });
  for (const theme of ['dark', 'light']) await check(`native-theme:${theme}`, async () => {
    await main.evaluate(`window.tud.setThemeMode(${JSON.stringify(theme)})`);
    await open(fish, fishInspector, 'document.querySelector(".pet-hit")');
    await close(fishInspector);
    assert.equal(await main.evaluate("window.tud.getTheme().then(s=>s.resolved)"), theme);
  });
  await hold('dsh', fish, fishInspector, 'document.querySelector(".pet-hit")');
  await check('dsh-hide-restores-same-pet-and-size', async () => {
    await open(fish, fishInspector, 'document.querySelector(".pet-hit")'); await choose(fishInspector, 'hide');
    await until(async () => !(await selection()).enabled, 'fish hidden');
    assert.equal((await selection()).currentKind, 'dsh');
    await main.evaluate('window.tud.pet.setEnabled(true)'); await connectFish();
    assert.equal(await main.evaluate('window.tud.dshPet.getState().then(s=>s.config.main.pets[0].size)'), 364);
  });
  await check('native-role-menu-switches-dsh-back-to-bot-exclusively', async () => {
    await open(fish, fishInspector, 'document.querySelector(".pet-hit")'); await choose(fishInspector, 'character:builtin:bot');
    await until(async () => (await selection()).currentKind === 'builtin', 'current bot');
    assert.equal(await main.evaluate('window.tud.dshPet.getState().then(s=>s.enabled)'), false);
    assert.equal(await main.evaluate('window.tud.pet.getState().then(s=>s.settings.character)'), 'bot');
  });
} catch (error) {
  console.error(error); process.exitCode = 1;
  if (!checks.some(c => !c.ok)) checks.push({ name: 'runner', ok: false, error: error.stack ?? String(error) });
} finally {
  if (process.exitCode) await Promise.allSettled([inspector('close'),fishInspector('close')]);
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: checks.length > 0 && checks.every(c => c.ok), checks }, null, 2));
  await probe.close();
  await mkdir(output, { recursive: true });
  console.log(`Pet menu evidence: ${output}`);
}
