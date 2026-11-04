// Real Desktop main/preload/renderers + real helper, private profiles and owned processes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connectPage, launchProbe, unusedPort, wait } from './desktop-cdp.mjs';

const desktop = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] ?? path.join(desktop, '.quotern-dev', `pet-menu-ui-${Date.now()}`));
const executable = createRequire(import.meta.url)('electron');
const mainPort = await unusedPort(), fishPort = await unusedPort(), fishInspectorPort = await unusedPort();
const probe = await launchProbe(executable, output, { args: [desktop, `--inspect=127.0.0.1:${mainPort}`] });
const clients = [], checks = [];
let main, inspector, builtin, fish, fishInspector;
const until = async (read, label, attempts = 150) => {
  let last;
  for (let i = 0; i < attempts; i++) { try { last = await read(); if (last) return last; } catch (error) { last = error.message; } await wait(100); }
  throw Error(`Timed out: ${label} (${JSON.stringify(last)})`);
};
const connect = async port => {
  const target = await until(async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json())[0], `inspector ${port}`);
  const client = await connectPage(target); clients.push(client); return client;
};
const installMenuAudit = async client => client.evaluate(`(()=>{
  const e=process.getBuiltinModule('module').createRequire(process.execPath)('electron');
  if(!globalThis.__menuAudit){globalThis.__menuAudit={menu:null,win:null,open:false};const original=e.Menu.prototype.popup;
    e.Menu.prototype.popup=function(options){__menuAudit.menu=this;__menuAudit.win=options.window;__menuAudit.open=true;return original.call(this,{...options,callback:()=>{__menuAudit.open=false;options.callback?.();}});};}
  return true;
})()`);
const tree = client => client.evaluate(`(()=>{const walk=m=>m.items.map(i=>({id:i.id,label:i.label,checked:i.checked,enabled:i.enabled,children:i.submenu?walk(i.submenu):undefined}));return walk(__menuAudit.menu);})()`);
const close = async client => { await client.evaluate('globalThis.__menuAudit?.menu?.closePopup();true'); await wait(100); };
const open = async (page, client, selector) => {
  await close(client);
  await page.click(selector, 'right');
  await until(() => client.evaluate('Boolean(__menuAudit.open)'), 'native menu opens');
};
const choose = async (client, id) => {
  await client.evaluate(`(()=>{const m=__menuAudit.menu,i=m.getMenuItemById(${JSON.stringify(id)});if(!i||!i.enabled)throw Error('Missing enabled command');i.click(i,__menuAudit.win,{});m.closePopup();return true;})()`);
  await wait(150);
};
const check = async (name, fn) => {
  try { await fn(); checks.push({ name, ok: true }); }
  catch (error) { checks.push({ name, ok: false, error: error.stack ?? String(error) }); throw error; }
  console.log(JSON.stringify(checks.at(-1)));
};
const selection = () => main.evaluate('window.tud.pet.getSelection()');
const connectBuiltin = async () => {
  builtin = await probe.connect(p => /\/pet\.html(?:\?|$)/.test(p.url));
  await until(() => builtin.evaluate('Boolean(document.querySelector("#pet-root svg"))'), 'builtin sprite');
};
const connectFish = async () => {
  const target = await until(async () => (await (await fetch(`http://127.0.0.1:${fishPort}/json/list`)).json()).find(p => p.type === 'page' && p.url.includes('petIndex=')), 'helper renderer');
  fish = await connectPage(target); clients.push(fish);
  await until(() => fish.evaluate('Boolean(window.__dshPetDebug?.configOk && document.querySelector(".pet-hit"))'), 'helper config');
  fishInspector = await connect(fishInspectorPort); await installMenuAudit(fishInspector);
};
const selectedPreview = name => main.evaluate(`Boolean([...document.querySelectorAll('button[aria-pressed="true"]')].find(b=>b.textContent.includes(${JSON.stringify(name)})))`);
const preview = async name => main.click(`[...document.querySelectorAll('button[aria-pressed]')].find(b=>b.textContent.trim()===${JSON.stringify(name)})`);
const hold = async (kind, page, client, selector) => {
  if (process.env.QUOTERN_PET_MENU_VISUAL !== '1') return;
  await open(page, client, selector);
  await client.evaluate(`__menuAudit.win.setTitle('Quotern menu verification ${kind}');true`);
  await writeFile(path.join(output, 'visual-stage.json'), JSON.stringify({ kind, output, awaiting: `continue-${kind}` }));
  console.log(`Visual stage: ${kind} (${output})`);
  await until(async () => { try { await access(path.join(output, `continue-${kind}`)); return true; } catch { return false; } }, `visual ${kind}`, 6000);
  await close(client);
};

try {
  main = await probe.connect(p => !p.url.includes('pet.html') && !p.url.includes('petIndex='));
  await until(() => main.evaluate('Boolean(window.tud?.pet && document.querySelector("main"))'), 'Desktop app');
  inspector = await connect(mainPort); await installMenuAudit(inspector);
  await inspector.evaluate(`(()=>{const cp=process.getBuiltinModule('child_process'),original=cp.spawn;cp.spawn=function(exe,args,options){if(args?.includes('--quotern-dsh-pet-helper'))args=[...args,'--remote-debugging-port=${fishPort}','--inspect=127.0.0.1:${fishInspectorPort}'];return original.call(this,exe,args,options);};process.getBuiltinModule('module').syncBuiltinESMExports();return true;})()`);
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
    assert.equal(await fishInspector.evaluate('__menuAudit.open'), true);
    assert.equal(await fish.evaluate('window.__dshPetDebug.menuOpen && window.__dshPetDebug.inputBusy'), true);
    await close(fishInspector);
    await until(() => fish.evaluate('!window.__dshPetDebug.inputBusy'), 'native menu cancellation after renderer leave');
  });
  for (const [size, width] of [['small', 160], ['medium', 204], ['large', 264]]) await check(`dsh-native-size:${size}`, async () => {
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
    await main.evaluate(`window.tud.setThemeMode(${JSON.stringify(theme)});true`); await wait(100);
    await open(fish, fishInspector, 'document.querySelector(".pet-hit")');
    assert.equal(await fishInspector.evaluate("process.getBuiltinModule('module').createRequire(process.execPath)('electron').nativeTheme.themeSource"), theme);
    await close(fishInspector);
  });
  await hold('dsh', fish, fishInspector, 'document.querySelector(".pet-hit")');
  await check('dsh-hide-restores-same-pet-and-size', async () => {
    await open(fish, fishInspector, 'document.querySelector(".pet-hit")'); await choose(fishInspector, 'hide');
    await until(async () => !(await selection()).enabled, 'fish hidden');
    assert.equal((await selection()).currentKind, 'dsh');
    await main.evaluate('window.tud.pet.setEnabled(true)'); await connectFish();
    assert.equal(await main.evaluate('window.tud.dshPet.getState().then(s=>s.config.main.pets[0].size)'), 264);
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
  for (const client of clients) client.close();
  await probe.close();
  await mkdir(output, { recursive: true });
  await writeFile(path.join(output, 'result.json'), JSON.stringify({ ok: checks.length > 0 && checks.every(c => c.ok), checks }, null, 2));
  console.log(`Pet menu evidence: ${output}`);
}
