// Live fish window acceptance. The native pointer and menu drivers exercise OS interactions separately.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { launchProbe, wait } from './desktop-cdp.mjs';
import { eventually, ownedPetWindow } from './native-pet-probe.mjs';
const [host, output] = process.argv.slice(2);
assert.ok(host && output,'Quotern.exe fresh-output-directory');
const probe = await launchProbe(host,output,{webview2:true});
try {
  const main = await probe.connect(p=>p.url.includes('tauri.localhost'));
  await eventually(()=>main.evaluate('Boolean(window.tud?.dshPet)'),'main bridge');
  const action = value => main.evaluate('window.tud.dshPet.dispatch('+JSON.stringify(value)+')');
  await main.evaluate("window.tud.pet.select({kind:'dsh'}).then(()=>window.tud.pet.setEnabled(true))");
  async function connect(){
    const page=await probe.connect(p=>p.url.includes('/dsh/index.html'));
    await eventually(()=>page.evaluate('window.__dshPetDebug?.configOk && Boolean(document.querySelector(".pet-hit"))'),'loaded fish');
    return page;
  }
  let page=await connect();
  for (const width of [204,264,364]) {
    await action({type:'patch-pet',petId:'main',patch:{size:width,fixedEnabled:true}});
    page=await connect();
    await eventually(()=>page.evaluate(`(()=>{const r=document.querySelector('.pet-hit').getBoundingClientRect();return Math.abs(r.height-${width}*285/640)<2 && Math.abs(r.width-${width}*240/640)<2})()`),'fish size '+width);
    await page.screenshot(path.join(output,'size-'+width+'.png'));
  }
  const dock=await page.evaluate('(()=>{const p=sprites[0],a=WORK_AREAS.at(-1);p.stopMove();p.stopThrow();p.sendBounds(a.x+a.width-p.hitRect.x-p.hitRect.w,a.y+a.height*.5);return p.tryCompanionDock();})()');
  assert.equal(dock,true);
  await eventually(()=>page.evaluate('Boolean(window.petBridge.readCompanionPosition("main")?.dock || sprites[0].companionDock)'),'saved dock');
  await action({type:'retry'});page=await connect();
  await eventually(()=>page.evaluate('Boolean(sprites[0].companionDock)'),'restored dock after window recreation');
  await page.evaluate('sprites[0].goHome(); true');
  await page.click('document.querySelector(".pet-hit")');
  await eventually(()=>page.evaluate('sprites[0].companionClickIndex>0'),'click changes animation');
  assert.ok(await page.evaluate('document.querySelector(".pet-video.is-front")?.src'));
  await ownedPetWindow(probe,'dsh')('close-window');
  await eventually(()=>main.evaluate("window.tud.dshPet.getState().then(s=>s.status==='error')"),'unexpected fish window closure');
  await action({type:'retry'});page=await connect();
  assert.equal(await page.evaluate('window.__dshPetDebug.spriteCount'),1);
  await main.evaluate('window.tud.pet.setEnabled(false)');
  await eventually(async()=>!(await probe.pages()).some(p=>p.url.includes('/dsh/index.html')),'fish hidden');
  await writeFile(path.join(output,'result.json'),JSON.stringify({sizes:[204,264,364],dockRestored:true,unexpectedCloseRecovered:true}));
} finally {await probe.close();}
