// Actual settings UI acceptance. Local mock model, dedicated profile/data only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { transform } from 'esbuild';
import { connectPage, launchProbe, unusedPort, wait } from './desktop-cdp.mjs';

const [executable, output, appPath] = process.argv.slice(2);
assert.ok(executable && output, 'exe output');
const localeSource = await readFile(new URL('../src/renderer/i18n/dsh-pet-messages.ts', import.meta.url), 'utf8');
const module = await transform(localeSource, { loader: 'ts', format: 'esm' });
const { dshPetRows } = await import(`data:text/javascript;base64,${Buffer.from(module.code).toString('base64')}`);
const text = key => dshPetRows[`desktop.dshPet.${key}`][0];
const results = [];
let modelRequests = 0;
const api = createServer(async (request, response) => {
  let body = ''; for await (const chunk of request) body += chunk;
  modelRequests++;
  const data = JSON.parse(body), last = data.messages.at(-1)?.content ?? '';
  response.setHeader('content-type', 'application/json');
  if (last.includes('audit-model-error')) { response.statusCode = 503; response.end('{}'); return; }
  response.end(JSON.stringify({ choices: [{ message: { content: `UI本地回复 ${modelRequests}` }, finish_reason: 'stop' }] }));
});
await new Promise(resolve => api.listen(0, '127.0.0.1', resolve));
const inspectorPort = await unusedPort();
const probe = await launchProbe(executable, output, { args: [...(appPath ? [path.resolve(appPath)] : []), `--inspect=127.0.0.1:${inspectorPort}`] });
let page, inspector;
try {
  page = await probe.connect(target => /index\.html/.test(target.url));
  const ev = page.evaluate;
  const section = `document.querySelector('[data-pet-settings="dsh"]')`;
  const petSection = `(${section}).closest('section')`;
  const petTile = name => `[...(${petSection}).querySelectorAll('button[aria-pressed]')].find(el=>el.textContent.includes(${JSON.stringify(name)}))`;
  const group = key => `[...(${section}).querySelectorAll('details')].find(el=>el.querySelector('summary')?.textContent===${JSON.stringify(text(key))})`;
  const button = (key, within = section, index = 0) => `[...(${within}).querySelectorAll('button')].filter(el=>el.textContent.trim()===${JSON.stringify(text(key))})[${index}]`;
  const field = (key, index = 0) => `[...(${section}).querySelectorAll('label')].filter(el=>el.childNodes[0]?.textContent===${JSON.stringify(text(key))} || el.textContent.trim()===${JSON.stringify(text(key))})[${index}]?.querySelector('input,select,textarea')`;
  const state = () => ev('window.tud.dshPet.getState()');
  const idle = async () => {
    for (let i = 0; i < 150; i++) { if (await ev(`!!(${section})?.querySelector('input[role="switch"]') && !(${section}).querySelector('input[role="switch"]').disabled && (${section}).getAttribute('aria-busy')!=='true'`)) return; await wait(100); }
    throw Error('Settings stayed busy');
  };
  const click = async expression => { await page.click(expression); await wait(60); await idle(); };
  const edit = async (key, value, index = 0) => { await page.fill(field(key, index), value); await page.key('Tab'); await wait(60); await idle(); };
  const select = async (key, value, index = 0) => {
    const expression = field(key, index);
    const info = await ev(`(() => {const el=(${expression});return {value:el.value,options:[...el.options].map(o=>o.value)}})()`);
    const target = info.options.indexOf(value);
    assert.ok(target >= 0, `Missing option ${key}=${value}`);
    if (info.value === value) return;
    await ev(`(${expression}).focus(); true;`);
    await page.key(target === info.options.length - 1 ? 'End' : 'Home'); await wait(60); await idle();
    if (target !== info.options.length - 1) for (let i = 0; i < target; i++) { await ev(`(${expression}).focus(); true;`); await page.key('ArrowDown'); await wait(60); await idle(); }
    assert.equal(await ev(`(${expression}).value`), value, `${key} selection`);
  };
  const check = async (name, fn) => {
    try { await fn(); results.push({ name, ok: true }); }
    catch (error) { results.push({ name, ok: false, error: String(error.stack ?? error) }); await page.screenshot(path.join(probe.directory, `failure-${results.length}.png`)).catch(() => {}); }
    console.log(JSON.stringify(results.at(-1)));
  };
  for (let i = 0; i < 100; i++) { try { if (await state()) break; } catch {} await wait(100); }
  const defaults = (await state()).config.main;
  for (let i=0; i<100; i++) {
    await ev(`window.dispatchEvent(new CustomEvent('tud:open-settings',{detail:{tab:'app'}})); true;`);
    await wait(100);
    if (await ev(`!!(${section})`)) break;
  }
  await idle();
  await page.click(petTile(text('title')));
  await check('unified-pet-settings-and-preserved-drafts', async () => {
    assert.equal(await ev(`(${petSection}).querySelectorAll('h3').length`), 1, 'one desktop pet card');
    assert.equal(await ev(`(${section}).querySelectorAll('section').length`), 0, 'companion settings are embedded');
    const before = await state(), builtinBefore = await ev('window.tud.pet.getState()');
    await page.click(`(${group('models')}).querySelector('summary')`);
    await page.fill(`(${group('models')}).querySelector('input[name="id"]')`, 'unsaved-provider');
    await page.click(petTile('Clawd'));
    assert.equal(await ev(`(${section}).checkVisibility()`), false);
    assert.equal(await ev(`(${petSection}).querySelector('h4').textContent`), 'Clawd');
    assert.equal(await ev(`(${petSection}).querySelector('input[type="checkbox"]').checked`), builtinBefore.settings.visible);
    await page.click(petTile(text('title')));
    assert.equal(await ev(`(${section}).checkVisibility()`), true);
    assert.equal(await ev(`(${group('models')}).querySelector('input[name="id"]').value`), 'unsaved-provider');
    assert.equal((await state()).enabled, before.enabled, 'view selection must not toggle the companion');
    assert.equal((await ev('window.tud.pet.getState()')).settings.visible, builtinBefore.settings.visible, 'view selection must not toggle the built-in pet');
    await page.fill(`(${group('models')}).querySelector('input[name="id"]')`, '');
    await page.click(`(${group('models')}).querySelector('summary')`);
  });
  for (const key of ['instances','behavior','models','controls','activity','advanced']) {
    await check(`fold:${key}`, async () => {
      const summary = `(${group(key)}).querySelector('summary')`;
      assert.equal(await ev(`(${group(key)}).open`), false);
      await page.click(summary); assert.equal(await ev(`(${group(key)}).open`), true);
      await ev(`(${summary}).focus(); true;`); await page.key('Enter');
      assert.equal(await ev(`(${group(key)}).open`), false);
      await page.key(' '); assert.equal(await ev(`(${group(key)}).open`), true);
    });
    if (!await ev(`(${group(key)}).open`)) await page.click(`(${group(key)}).querySelector('summary')`);
  }
  await check('single-companion-settings', async () => {
    assert.equal((await state()).config.main.pets.length, 1);
    assert.equal(await ev(`(${group('instances')}).querySelectorAll('button').length`), 0, 'no add/remove companion controls');
    assert.equal(await ev(`(${section}).textContent.includes('多宠物碰撞')`), false);
  });
  await check('name-blur-save', async () => { await edit('name','界面审计宠物'); assert.equal((await state()).config.main.pets[0].name,'界面审计宠物'); });
  await check('size-blur-save', async () => { await edit('size','248'); assert.equal((await state()).config.main.pets[0].size,248); });
  await check('pending-save-preserves-newer-draft-and-focus', async () => {
    const targets=await(await fetch(`http://127.0.0.1:${inspectorPort}/json/list`)).json();
    inspector=await connectPage(targets[0]);
    await inspector.evaluate(`(() => {
      const ipc=process.getBuiltinModule('module').createRequire(process.execPath)('electron').ipcMain;
      const original=ipc._invokeHandlers.get('dsh-pet:action');
      if(typeof original!=='function')throw Error('Missing owned test IPC handler');
      globalThis.__auditRestore=()=>{ipc.removeHandler('dsh-pet:action');ipc.handle('dsh-pet:action',original);};
      let once=true;ipc.removeHandler('dsh-pet:action');ipc.handle('dsh-pet:action',async(event,action)=>{
        if(once&&action.type==='patch-pet'){once=false;await new Promise(resolve=>{globalThis.__auditRelease=resolve;});}
        return original(event,action);
      });return true;
    })()`);
    await page.fill(field('name'),'保存中的旧名称');
    try {
      await page.key('Tab');
      for(let i=0;i<50&&!await inspector.evaluate('Boolean(globalThis.__auditRelease)');i++)await wait(50);
      assert.equal(await inspector.evaluate('Boolean(globalThis.__auditRelease)'),true,'the blur request must be in flight');
      await page.fill(field('name'),'继续输入的新名称');
      await page.key('Tab');
      await page.fill(field('name'),'保存中的旧名称');
      await ev(`window.__auditNameInput=(${field('name')}); true;`);
    } finally { await inspector.evaluate('globalThis.__auditRelease?.(); globalThis.__auditRestore?.(); true;'); }
    await wait(100); await idle();
    assert.equal((await state()).config.main.pets[0].name,'继续输入的新名称');
    assert.equal(await ev(`(${field('name')})===window.__auditNameInput && document.activeElement===window.__auditNameInput`),true,'save acknowledgement must preserve the focused input');
    assert.equal(await ev(`(${field('name')}).value`),'保存中的旧名称');
    await page.key('Tab'); await wait(100); await idle();
    assert.equal((await state()).config.main.pets[0].name,'保存中的旧名称');
    inspector.close(); inspector=undefined;
  });
  await check('blur-save-does-not-swallow-next-button', async () => {
    const count=(await state()).config.main.pets.length;
    await page.fill(field('name'),'直接移焦名称'); await click(button('clearMemory',group('controls')));
    assert.equal((await state()).config.main.pets[0].name,'直接移焦名称');
    assert.equal((await state()).config.main.pets.length,count,'the next action must keep one companion');
  });
  for (const key of ['balanceEnabled','whisperEnabled','workStatusEnabled','fixedEnabled']) await check(`companion-toggle:${key}`, async () => {
    const before = (await state()).config.main.pets[0][key];
    await click(field(key)); assert.equal((await state()).config.main.pets[0][key], !before);
    await ev(`(${field(key)}).focus(); true;`); await page.key(' '); await wait(60); await idle();
    assert.equal((await state()).config.main.pets[0][key], before);
  });
  for (const value of ['top-left','top-right','bottom-left','bottom-right']) await check(`corner:${value}`, async () => { await select('corner',value); assert.equal((await state()).config.main.pets[0].position.corner,value); });
  for (const [key,value] of [['marginX',31],['marginY',49]]) await check(`offset:${key}`, async () => { await edit(key,String(value)); assert.equal((await state()).config.main.pets[0].position[key],value); });
  for (const [key,owner,property] of [['confine',null,'confineToScreen'],['notifications',null,'notificationsEnabled'],['ceiling','physics','ceilingBounce'],['followPet','font','followPet']]) await check(`behavior-toggle:${key}`, async () => {
    const main=(await state()).config.main, before=owner?main[owner][property]:main[property]; await click(field(key));
    const after=(await state()).config.main; assert.equal(owner?after[owner][property]:after[property],!before);
  });
  for (const [key,value] of [['gravity',0.5],['restitution',0.5],['groundFriction',0.4],['throwPower',1.5]]) await check(`physics:${key}`, async () => { await edit(key,String(value)); assert.equal((await state()).config.main.physics[key],value); });
  for (const value of ['yahei','youyuan','kaiti','simsun','comic','candy','system']) await check(`font:${value}`, async () => { await select('font',value); assert.equal((await state()).config.main.font.family,value); });
  await check('font-size', async () => { await edit('fontSize','23'); assert.equal((await state()).config.main.font.size,23); });
  await check('quota-unselected', async () => { await select('quota',''); assert.equal((await state()).quotaSource,null); });
  const providerInput = name => `(${group('models')}).querySelector('input[name=${JSON.stringify(name)}]')`;
  const fillProvider = async (models='audit-one,audit-two') => {
    for (const [name,value] of Object.entries({id:'audit',name:'界面本地服务',baseUrl:`http://127.0.0.1:${api.address().port}/v1/`,models,apiKey:'local-ui-test-key'})) await page.fill(providerInput(name),value);
  };
  await check('provider-add-from-form', async () => { await fillProvider(); await click(button('saveProvider')); assert.equal((await state()).models.providers[0].apiKeyConfigured,true); assert.equal(await ev(`(${providerInput('apiKey')}).value`),''); });
  await check('provider-edit-blank-retains-key', async () => { await click(button('edit',group('models'))); assert.equal(await ev(`(${providerInput('name')}).value`),'界面本地服务'); await page.fill(providerInput('name'),'已编辑的本地服务'); await click(button('saveProvider')); assert.equal((await state()).models.providers[0].name,'已编辑的本地服务'); assert.equal((await state()).models.providers[0].apiKeyConfigured,true); });
  const ref=JSON.stringify({provider:'audit',model:'audit-one'}), second=JSON.stringify({provider:'audit',model:'audit-two'});
  for (const [key,value] of [['defaultModel',ref],['chatModel',second],['whisperModel',second]]) await check(`model-select:${key}`, async () => { await select(key,value); const current=await state(); assert.deepEqual(key==='defaultModel'?current.models.defaultModel:current.config.main[key],JSON.parse(value)); });
  for (const [key,value] of [['chatMemoryRounds',2],['chatImageLimit',3]]) await check(`model-number:${key}`, async () => { await edit(key,String(value)); assert.equal((await state()).config.main[key],value); });
  for (const [key,value] of [['balance',1234],['whisper',5678]]) await check(`interval:${key}`, async () => { await edit(`interval.${key}`,String(value)); assert.equal((await state()).config.main.eventsRefreshSec[key],value); });
  for (const [key,property] of [['chatImages','chatImageEnabled'],['whisperImages','whisperImageEnabled']]) await check(`model-toggle:${key}`, async () => { const before=(await state()).config.main[property]; await click(field(key)); assert.equal((await state()).config.main[property],!before); });
  await check('persona-blur-save', async () => { await edit('persona','中文人设\nhttps://example.com/a//b 与 /* 字面文本 */'); assert.match((await state()).config.main.whisperPrompt,/中文人设/); });
  await check('provider-model-prune-clears-default', async () => { await click(button('edit',group('models'))); await page.fill(providerInput('models'),'audit-two'); await click(button('saveProvider')); assert.equal((await state()).models.defaultModel,null); });
  // Return to a valid, explicit model after the invalidation probe.
  await select('defaultModel',second);
  await check('enable-after-settings', async () => { await click(`(${section}).querySelector('[data-slot="switch-control"]')`); assert.equal((await state()).status,'running'); await wait(1500); assert.equal((await state()).status,'running'); });
  const ownedHelper = () => {
    const command=`Get-CimInstance Win32_Process -Filter 'ParentProcessId = ${probe.child.pid}' | Where-Object { $_.CommandLine -like '*--quotern-dsh-pet-helper*' } | Select-Object -ExpandProperty ProcessId`;
    const output=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{encoding:'utf8',windowsHide:true});
    const ids=output.trim().split(/\s+/).filter(Boolean).map(Number); assert.equal(ids.length,1,'exactly one helper belonging to this private app'); return ids[0];
  };
  await check('retry-after-owned-helper-exits', async () => {
    const previous=ownedHelper(); process.kill(previous);
    for(let i=0;i<100 && (await state()).status!=='error';i++)await wait(100);
    assert.equal((await state()).status,'error');
    await click(button('retry')); assert.equal((await state()).status,'running');
    assert.notEqual(ownedHelper(),previous);
  });
  const readPetState=async()=>JSON.parse((await ev(`window.tud.dshPet.dispatch({type:'request',method:'GET',path:'/state'})`)).body);
  await check('manual-quota', async () => { await click(button('balance',group('controls'))); assert.equal(await ev(`(${section}).querySelector('[role="alert"]')?.textContent??''`),''); });
  await check('manual-single-target', async () => { assert.equal((await state()).config.main.pets.length,1); assert.equal(await ev(`(${group('controls')}).querySelectorAll('select').length`),1,'only the animation selector remains'); });
  await check('manual-animation', async () => {
    const target=(await state()).config.main.pets[0].id, before=(await readPetState()).pets[target]?.anim?.counter??0;
    const animation=await ev(`(${field('animation')}).options[1].value`); await select('animation',animation); await click(button('play',group('controls')));
    assert.ok((await readPetState()).pets[target].anim.counter>before);
  });
  await check('chat-from-form', async () => { await page.fill(field('chat'),'界面审计你好'); await click(button('send',group('controls'))); const id=(await state()).config.main.pets[0].id; const response=await ev(`window.tud.dshPet.dispatch({type:'request',method:'GET',path:${JSON.stringify('/chat?pet=')}+encodeURIComponent(${JSON.stringify(id)})})`); assert.equal(JSON.parse(response.body).messages.length,2); });
  await check('chat-error-feedback-and-draft', async () => { await page.fill(field('chat'),'audit-model-error'); await click(button('send',group('controls'))); assert.match(await ev(`(${section}).querySelector('[role="alert"]')?.textContent??''`),/503/); assert.equal(await ev(`(${field('chat')}).value`),'audit-model-error'); });
  await check('manual-whisper', async () => { const id=(await state()).config.main.pets[0].id, before=(await readPetState()).pets[id]?.say?.counter??0; await click(button('whisper',group('controls'))); assert.ok((await readPetState()).pets[id].say.counter>before); });
  await check('clear-selected-memory', async () => { const id=(await state()).config.main.pets[0].id; await click(button('clearMemory',group('controls'))); const response=await ev(`window.tud.dshPet.dispatch({type:'request',method:'GET',path:${JSON.stringify('/chat?pet=')}+encodeURIComponent(${JSON.stringify(id)})})`); assert.equal(JSON.parse(response.body).messages.length,0); });
  await check('disable-before-advanced', async () => { await click(`(${section}).querySelector('[data-slot="switch-control"]')`); assert.equal((await state()).status,'disabled'); });
  await check('load-jsonc', async () => { await click(button('loadConfig')); assert.ok((await ev(`(${section}).querySelector('textarea[name="jsonc"]').value`)).includes((await state()).config.main.pets[0].name)); });
  const jsonc=`(${section}).querySelector('textarea[name="jsonc"]')`;
  await check('invalid-jsonc-preserves-draft-and-config', async () => { const before=JSON.stringify((await state()).config); await page.fill(jsonc,'{"pets":'); await click(button('saveConfig')); assert.ok(await ev(`!!(${section}).querySelector('[role="alert"]')`)); assert.equal(await ev(`(${jsonc}).value`),'{"pets":'); assert.equal(JSON.stringify((await state()).config),before); });
  await check('advanced-save-updates-edited-inputs', async () => {
    const main=(await state()).config.main; main.pets[0].name='高级配置宠物'; main.pets[0].size=315; main.font.size=37; main.whisperPrompt='高级配置人设';
    await page.fill(jsonc,'// UI acceptance\n'+JSON.stringify(main,null,2)); await click(button('saveConfig'));
    assert.equal((await state()).config.main.pets[0].name,'高级配置宠物');
    assert.equal(await ev(`(${field('name')}).value`),'高级配置宠物'); assert.equal(await ev(`(${field('size')}).value`),'315'); assert.equal(await ev(`(${field('fontSize')}).value`),'37'); assert.equal(await ev(`(${field('persona')}).value`),'高级配置人设');
  });
  await check('advanced-config-cannot-start-another-companion', async () => {
    const main=(await state()).config.main; main.pets.push({...main.pets[0],id:'legacy-extra'});
    await page.fill(jsonc,JSON.stringify(main)); await click(button('saveConfig'));
    assert.equal((await state()).config.main.pets.length,1);
    assert.equal(await ev(`(${group('instances')}).querySelectorAll('input[type="number"]').length`),3);
  });
  await check('reset-updates-edited-inputs', async () => { await click(button('reset')); assert.equal((await state()).config.main.pets[0].name,defaults.pets[0].name); assert.equal(await ev(`(${field('name')}).value`),defaults.pets[0].name); assert.equal(await ev(`(${field('size')}).value`),String(defaults.pets[0].size)); assert.equal(await ev(`(${field('fontSize')}).value`),String(defaults.font.size)); });
  await check('reset-failure-preserves-jsonc-draft', async () => {
    await click(button('loadConfig')); const draft='// unsaved draft\n{"keep":"草稿"}'; await page.fill(jsonc,draft);
    const file=path.join(probe.directory,'electron/dsh-pet/main-config.jsonc'), backup=file+'.audit-backup';
    await rename(file,backup); await mkdir(file);
    try { await click(button('reset')); assert.ok(await ev(`!!(${section}).querySelector('[role="alert"]')`)); assert.equal(await ev(`(${jsonc})?.value`),draft); }
    finally { await rmdir(file); await rename(backup,file); }
  });
  await check('open-private-directory', async () => { await click(button('openDirectory')); assert.equal((await readFile(path.join(probe.directory,'electron/dsh-pet/.directory'),'utf8')),'Quotern dsh-pet'); assert.equal(await ev(`(${section}).querySelector('[role="alert"]')?.textContent??''`),''); });
  await check('remove-provider-clears-selected-default', async () => { await click(button('remove',group('models'))); assert.equal((await state()).models.providers.length,0); assert.equal((await state()).models.defaultModel,null); });
  assert.equal(page.errors.length,0,'Uncaught renderer errors');
  await page.screenshot(path.join(probe.directory,'settings-final.png'));
} catch (error) {
  results.push({name:'runner',ok:false,error:String(error.stack??error)});
  await page?.screenshot(path.join(probe.directory,'runner-failure.png')).catch(()=>{});
  throw error;
} finally {
  if(inspector){ await inspector.evaluate('globalThis.__auditRelease?.(); globalThis.__auditRestore?.(); true;').catch(()=>{}); inspector.close(); }
  await probe.close(); api.closeAllConnections(); await new Promise(resolve=>api.close(resolve));
  await writeFile(path.join(probe.directory,'result.json'),JSON.stringify({ok:results.length>0&&results.every(item=>item.ok),checks:results.length,passed:results.filter(item=>item.ok).length,modelRequests,results},null,2));
}
if(results.some(item=>!item.ok)) process.exitCode=1;
