import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchProbe, wait } from './desktop-cdp.mjs';
import { prepareQuotaCliFixture } from './tauri-quota-fixture.mjs';

const root=await mkdtemp(join(tmpdir(),'quotern-tauri-webview-'));
const executable=resolve(process.argv[2] || 'apps/desktop/src-tauri/target/debug/Quotern.exe');
let claudeSignedOut;
const probe=await launchProbe(executable,root,{webview2:true,prepare:async env=>{
  claudeSignedOut = await prepareQuotaCliFixture(root, env);
  const months=new Map();
  for(let day=1;day<=100;day++) for(let bucket=0;bucket<300;bucket++) {
    const timestamp=new Date(Date.now()-day*86400000); timestamp.setUTCHours(4,0,0,0);
    const hour_start=timestamp.toISOString(), month=hour_start.slice(0,7);
    const row={source:'codex',model:'openai/gpt-pricing-fixture',project:`Synthetic ${bucket}`,hour_start,
      input_tokens:10000,output_tokens:0,cached_input_tokens:0,cache_creation_input_tokens:0,reasoning_output_tokens:0,total_tokens:10000,conversation_count:1};
    if(!months.has(month))months.set(month,[]); months.get(month).push(JSON.stringify(row));
  }
  const queue=join(env.QUOTERN_DATA_DIR,'queue'); await mkdir(queue,{recursive:true});
  for(const [month,rows] of months)await writeFile(join(queue,`${month}.jsonl`),rows.join('\n')+'\n');
  const since=new Date(Date.now()-102*86400000).toISOString();
  await writeFile(join(env.QUOTERN_DATA_DIR,'config.json'),JSON.stringify({deviceId:'c1fa9205-51a7-4b5c-90fc-93013f43c001',hostname:'Synthetic acceptance',dataDir:env.QUOTERN_DATA_DIR,statsSince:since,localCollectSince:since,serverPort:8252,lastSyncAt:null}));
}});
const until=async (check,label)=>{for(let i=0;i<300;i++){const value=await check();if(value)return value;await wait(100);}throw Error(`Timed out: ${label}`);};
async function exerciseQuota(client) {
  const quotaCard = id => `document.querySelector('[data-quota-card="${id}"]')`;
  await client.evaluate('window.tud.setLocalePreference("en")');
  await client.evaluate('window.tud.setThemeMode("light")');
  await until(()=>client.evaluate(`${quotaCard('claude')}?.textContent.includes('63%')`), 'automatic Claude quota on the dashboard');
  await until(()=>client.evaluate(`${quotaCard('codex')}?.textContent.includes('Install the CLI')`), 'missing CLI status');
  await client.call('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 4, y: 4 });
  if (await client.evaluate('Boolean(document.querySelector(".help-popup"))')) await client.key('Escape');
  await until(()=>client.evaluate('!document.querySelector(".help-popup")'), 'previous help popup closed');
  await client.screenshot(join(root,'quota-light.png'));
  const claudeDetails = `${quotaCard('claude')}?.querySelector('button[aria-haspopup="dialog"]')`;
  await client.evaluate(`${claudeDetails}.focus()`);
  await client.key('Enter');
  await until(()=>client.evaluate('Boolean(document.querySelector("[role=dialog] [data-quota-access]"))'), 'Claude details from the keyboard');
  assert.deepEqual(await client.evaluate('[...document.querySelectorAll("[role=dialog] [data-quota-access] button")].map(button=>button.textContent.trim())'), ['Official usage page ↗']);
  await writeFile(claudeSignedOut, '');
  await client.click('document.querySelector(\'[role=dialog] button[aria-label="Refresh quota for Claude"]\')');
  await until(()=>client.evaluate('Boolean(document.querySelector("[role=dialog] [data-quota-recovery]"))'), 'sign-in guidance after refreshing');
  assert.match(await client.evaluate('document.querySelector("[role=dialog]").textContent'), /Sign in to the CLI/);
  await client.key('Escape');
  await until(()=>client.evaluate('!document.querySelector("[role=dialog]")'), 'signed-out details closed');
  await until(()=>client.evaluate(`document.activeElement === ${claudeDetails}`), 'quota details focus returned');
  await client.call('Emulation.setDeviceMetricsOverride',{ width: 390, height: 760, deviceScaleFactor: 1, mobile: false });
  await client.evaluate('window.tud.setThemeMode("dark")');
  await until(()=>client.evaluate(`document.documentElement.classList.contains("dark") && ${quotaCard('claude')}?.textContent.includes('Sign in to the CLI')`), 'narrow dark quota cards');
  await client.screenshot(join(root,'quota-dark-narrow.png'));
  await client.call('Emulation.clearDeviceMetricsOverride');
  await client.evaluate('window.tud.quota.refresh("claude")');
  await until(()=>client.evaluate(`Boolean(${quotaCard('claude')}?.closest('[data-quota-status-group]'))`), 'signed-out Claude card regrouped');
  await client.evaluate(`${claudeDetails}.focus()`);
  await client.key('Enter');
  await until(()=>client.evaluate('Boolean(document.querySelector("[role=dialog] [data-quota-recovery]"))'), 'signed-out details opened');
  await unlink(claudeSignedOut);
  await client.click('document.querySelector(\'[role=dialog] button[aria-label="Refresh quota for Claude"]\')');
  await until(()=>client.evaluate('document.querySelector("[role=dialog] [data-quota-window]")?.textContent.includes("63%")'), 'quota returned without closing the details');
  await client.key('Escape');
  await until(()=>client.evaluate('!document.querySelector("[role=dialog]")'), 'recovered quota details closed');
  await client.click(`${quotaCard('deepseek')}?.querySelector('button[data-quota-action]')`);
  await until(()=>client.evaluate('Boolean(document.querySelector(\'[role=dialog] input[type="password"]\'))'), 'API key connection still available');
  await client.key('Escape');
  await until(()=>client.evaluate('!document.querySelector("[role=dialog]")'), 'API key details closed');
}

try {
  const client=await probe.connect(page=>page.url.includes('tauri.localhost'));
  for (let i=0;i<160;i++) {
    if(await client.evaluate("!!window.tud && document.getElementById('root')?.childElementCount > 0"))break;
    await wait(100);
  }
  const state=await client.evaluate("({title:document.title,bridge:typeof window.tud,rendered:document.getElementById('root')?.childElementCount,loc:location.href,text:document.body.innerText.slice(0,400)})");
  console.log(JSON.stringify(state));
  assert.ok(state.rendered,JSON.stringify(client.errors));
  const cold=performance.now();
  assert.equal(await client.evaluate("(async()=>{const r=await window.tud.api.request('/health');return r.body.ok})()"),true);
  const cards=await client.evaluate("(async()=>(await window.tud.quota.getState()).providers)()");
  assert.equal(cards.length,14);
  assert.ok(cards.filter(row=>row.access.method!=='official-cli').every(row=>!row.access.connected));
  const owner=JSON.parse(await readFile(join(root,'data','tud.pid'),'utf8'));
  assert.equal(owner.kind,'desktop');
  assert.notEqual(owner.pid,probe.child.pid);
  const summary=await client.evaluate("window.tud.api.request('/functions/tud-usage-summary')");
  assert.equal(summary.status,200);
  const work=performance.now();
  const requests=client.evaluate(`(async()=>{const start=performance.now();let delays=[],prev=start,running=true;function sample(t){if(!running)return;delays.push(t-prev);prev=t;requestAnimationFrame(sample)}requestAnimationFrame(sample);const replies=await Promise.all([...Array.from({length:10},()=>window.tud.api.request('/functions/tud-session-list?limit=10')),window.tud.api.request('/functions/tud-usage-summary'),window.tud.api.request('/functions/tud-trigger-sync',{method:'POST'}),new Promise(r=>setTimeout(r,1200))]);running=false;return {status:replies.slice(0,12).map(r=>r.status),syncOk:replies[11].body.data?.ok,frames:delays.length,maxMs:Math.max(...delays.slice(1))}})()`);
  const settings = ['设置','Settings','設定','설정'].map(label=>'button[aria-label="'+label+'"]').join(',');
  const interaction = async () => {
    await client.click(`document.querySelector(${JSON.stringify(settings)})`);
    await until(()=>client.evaluate('Boolean(document.querySelector("[role=dialog]"))'),'settings opened during load');
    await client.key('Escape');
    await until(()=>client.evaluate('!document.querySelector("[role=dialog]")'),'settings closed during load');
  };
  const [timings]=await Promise.all([requests,interaction()]);
  assert.deepEqual(timings.status,Array(12).fill(200));assert.equal(timings.syncOk,true);assert.ok(timings.frames>0);

  const costHelp = '[aria-label="预估费用说明"]';
  const pricingLink = '.help-popup a[target="_blank"][href*="/pricing"]';
  await client.evaluate('window.tud.setLocalePreference("zh-CN")');
  await until(() => client.evaluate('Boolean(document.querySelector('+JSON.stringify(costHelp)+'))'), 'estimated cost help');
  await client.click('document.querySelector('+JSON.stringify(costHelp)+')');
  await until(() => client.evaluate('Boolean(document.querySelector('+JSON.stringify(pricingLink)+'))'), 'pricing link in cost help');
  await client.click('document.querySelector('+JSON.stringify(pricingLink)+')');
  const reference = await probe.connect(page => page.id !== client.target.id && page.url.includes('#/pricing'));
  await until(() => reference.evaluate('Boolean(window.tud)'), 'pricing reference bridge');
  assert.equal(await reference.evaluate('window.opener === null'), true);
  assert.equal(await reference.evaluate('window.tud.api.request("/functions/tud-local-admin/pricing").then(r => r.status)'), 200);
  await reference.evaluate('window.tud.close(); true');
  await until(async () => !(await probe.pages()).some(page => page.id === reference.target.id), 'pricing reference closed');

  await client.evaluate("window.tud.pet.select({kind:'builtin',character:'doro'})");
  await client.evaluate('window.tud.pet.setEnabled(true)');
  const pet=await probe.connect(page=>page.url.includes('/pet.html'));
  const image=await until(()=>pet.evaluate(`(async()=>{const background=[...document.querySelectorAll('*')].map(el=>getComputedStyle(el).backgroundImage).find(value=>value.includes('/pets/doro/spritesheet.webp'));if(!background)return null;const img=new Image();img.src='/pets/doro/spritesheet.webp';try{await img.decode();return {width:img.naturalWidth,height:img.naturalHeight,background}}catch{return null}})()`),'rendered Doro image decode');
  assert.ok(image.width>0&&image.height>0);
  await client.evaluate("window.tud.pet.select({kind:'dsh'})");
  await until(async()=>!(await probe.pages()).some(page=>page.url.includes('/pet.html')),'old Doro window closed');
  const fish=await probe.connect(page=>page.url.includes('/dsh/index.html'));
  const video=await until(()=>fish.evaluate(`(()=>{const video=document.querySelector('video');return video&&video.readyState>=2?{readyState:video.readyState,src:video.currentSrc}:null})()`),'fish video ready');
  const media=await fish.evaluate(`(async()=>{const r=await fetch(${JSON.stringify(video.src)},{headers:{Range:'bytes=0-15'}});return {status:r.status,bytes:(await r.arrayBuffer()).byteLength,contentRange:r.headers.get('content-range')}})()`);
  assert.equal(media.status,206);assert.equal(media.bytes,16);
  assert.match(media.contentRange, /^bytes 0-15\/[1-9]\d*$/);
  await client.evaluate("window.tud.pet.select({kind:'builtin',character:'doro'})");
  await until(async()=>!(await probe.pages()).some(page=>page.url.includes('/dsh/index.html')),'old fish window closed');
  const capture=await client.call('Page.captureScreenshot',{format:'png'});
  await writeFile(join(root,'main.png'),Buffer.from(capture.data,'base64'));
  const quotaClient = await probe.connect(page => page.id === client.target.id, { waitForActionability: true });
  await exerciseQuota(quotaClient);
  console.log(JSON.stringify({profile:root,hostPid:probe.child.pid,sidecarPid:owner.pid,quotaAndHealthMs:Math.round(work-cold),totalTokens:summary.body.data.totalTokens,...timings,image,video,media}));
  assert.ok(summary.body.data.totalTokens>=300000000,JSON.stringify(summary));
} finally { await probe.close(); }
await assert.rejects(access(join(root,'data','tud.pid')), {code:'ENOENT'});
