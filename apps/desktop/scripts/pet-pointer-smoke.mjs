// Opt-in Windows test: samples pointer hit testing on the owned window, then restores the cursor.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchProbe, wait } from './desktop-cdp.mjs';
import { defaultHost, eventually, ownedPetWindow } from './native-pet-probe.mjs';

const base = fileURLToPath(new URL('../../../.quotern-dev/', import.meta.url));
await mkdir(base, {recursive:true});
const directory = process.argv[2] || await mkdtemp(path.join(base,'pet-pointer-'));
const probe = await launchProbe(process.argv[3] || defaultHost, directory, {webview2:true});
const results = [];
try {
  const main = await probe.connect(p=>p.url.includes('tauri.localhost'));
  await eventually(()=>main.evaluate('Boolean(window.tud?.pet)'),'pet client');
  for (const kind of ['builtin','dsh']) {
    const selection = kind==='builtin' ? {kind,character:'clawd'} : {kind};
    await main.evaluate('window.tud.pet.select('+JSON.stringify(selection)+')');
    await main.evaluate('window.tud.pet.setEnabled(true)');
    const page = await probe.connect(p=>p.url.includes(kind==='builtin'?'/pet.html':'/dsh/index.html'));
    const selector = kind==='builtin' ? '#pet-root svg' : '.pet-hit';
    const point = await eventually(()=>page.evaluate(`(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)return null;let r=el.getBoundingClientRect();return r.width&&r.height?{x:r.x+r.width/2,y:r.y+r.height/2,scale:devicePixelRatio}:null})()`),'visible sprite');
    const native = ownedPetWindow(probe,kind);
    const input = await native('input',[Math.round(point.x*point.scale),Math.round(point.y*point.scale)].join(','));
    assert.deepEqual(input,{topmost:true,inputOnSprite:true,passthroughOutside:true});
    await page.click('document.querySelector('+JSON.stringify(selector)+')');
    if (kind==='dsh') {
      await eventually(()=>page.evaluate('sprites[0].companionClickIndex>0'),'fish responds to click');
    } else {
      assert.ok(await page.evaluate('Boolean(document.querySelector("#pet-root svg"))'));
    }
    await wait(100);
    await page.screenshot(path.join(directory,kind+'.png'));
    results.push({kind,...input});
  }
  await writeFile(path.join(directory,'result.json'),JSON.stringify(results,null,2));
} finally { await probe.close(); }
await assert.rejects(access(path.join(directory,'data','tud.pid')),{code:'ENOENT'});
console.log(JSON.stringify({directory,results}));
