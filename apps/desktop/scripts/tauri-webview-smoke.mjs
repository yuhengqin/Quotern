import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { launchProbe, wait } from './desktop-cdp.mjs';

const root=await mkdtemp(join(tmpdir(),'quotern-tauri-webview-'));
const executable=resolve(process.argv[2] || 'apps/desktop/src-tauri/target/debug/Quotern.exe');
const probe=await launchProbe(executable,root,{webview2:true,prepare:async env=>{
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
  const cards=await client.evaluate("(async()=>(await window.tud.quota.getState()).providers.map(p=>[p.id,p.access.method,p.access.connected]))()");
  assert.equal(cards.length,14);assert.ok(cards.every(row=>row[2]===false));
  const owner=JSON.parse(await readFile(join(root,'data','tud.pid'),'utf8'));
  assert.equal(owner.kind,'desktop');
  assert.notEqual(owner.pid,probe.child.pid);
  const summary=await client.evaluate("window.tud.api.request('/functions/tud-usage-summary')");
  assert.equal(summary.status,200);
  const work=performance.now();
  const timings=await client.evaluate(`(async()=>{const start=performance.now();let delays=[],prev=start,running=true;function sample(t){if(!running)return;delays.push(t-prev);prev=t;requestAnimationFrame(sample)}requestAnimationFrame(sample);const replies=await Promise.all([...Array.from({length:10},()=>window.tud.api.request('/functions/tud-session-list?limit=10')),window.tud.api.request('/functions/tud-usage-summary'),window.tud.api.request('/functions/tud-trigger-sync',{method:'POST'}),new Promise(r=>setTimeout(r,1200))]);running=false;return {status:replies.slice(0,12).map(r=>r.status),syncOk:replies[11].body.data?.ok,frames:delays.length,maxMs:Math.max(...delays.slice(1))}})()`);
  assert.deepEqual(timings.status,Array(12).fill(200));assert.equal(timings.syncOk,true);assert.ok(timings.frames>0);
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
  console.log(JSON.stringify({profile:root,hostPid:probe.child.pid,sidecarPid:owner.pid,quotaAndHealthMs:Math.round(work-cold),totalTokens:summary.body.data.totalTokens,...timings,image,video,media}));
  assert.ok(summary.body.data.totalTokens>=300000000,JSON.stringify(summary));
} finally { await probe.close(); }
await assert.rejects(access(join(root,'data','tud.pid')), {code:'ENOENT'});
