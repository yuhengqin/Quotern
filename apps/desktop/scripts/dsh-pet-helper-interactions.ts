// Dedicated host/controller + real packaged helper. No normal Quotern collector.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DshPetController } from '../src/main/dsh-pet/controller';
// @ts-ignore manual acceptance driver, not part of the runtime bundle
import { connectPage, unusedPort, wait } from './desktop-cdp.mjs';

async function main() {
  const [executable, runtimeRoot, output, appPath] = process.argv.slice(2);
  assert.ok(executable && runtimeRoot && output, 'exe runtimeRoot output');
  const directory=path.resolve(output); await mkdir(directory,{recursive:true});
  const results: Array<{name:string;ok:boolean;error?:string}>=[];
  let openedHost=0, synced=0, settingsOpened=0, stdout='', stderr='', child: ChildProcess | null=null;
  const clients: any[]=[];
  const port=await unusedPort();
  const inspectorPort=await unusedPort();
  const controller=new DshPetController({root:path.join(directory,'host'),runtimeRoot:path.resolve(runtimeRoot),executable:path.resolve(executable),appPath:appPath?path.resolve(appPath):path.join(path.dirname(path.resolve(executable)),'resources/app.asar'),packaged:!appPath,
    getQuota:()=>null,showMainWindow:()=>{openedHost++;},openDirectory:async()=>{},roots:[],
    getCompanion:()=>({connected:true,syncing:false,hoverText:'今日 12.3K tokens\n参考费用 USD $0.42\nCodex · 5h 已用 32%',quips:['今日 12.3K tokens','近 7 天 100K tokens','你好呀，大肥鱼！'],labels:{sync:'立即同步',settings:'宠物设置',failed:'操作失败'}}),
    sync:async()=>{synced++;},openSettings:()=>{settingsOpened++;},
    spawn:(exe,args,options)=>{const launched=spawn(exe,[...args,`--remote-debugging-port=${port}`,`--inspect=127.0.0.1:${inspectorPort}`],options);child=launched;launched.once('exit',()=>{if(child===launched)child=null;});launched.stdout?.on('data',c=>{stdout+=String(c);});launched.stderr?.on('data',c=>{stderr+=String(c);});return launched;},
  });
  let page: any, second: any, native: any;
  const pages=async()=>{try{return((await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any[]).filter(p=>p.type==='page');}catch{return[];}};
  const connect=async()=>{
    let targets:any[]=[];
    for(let i=0;i<120;i++){try{targets=await pages();}catch{}if(targets.length)break;await wait(100);}
    assert.ok(targets.length,'helper CDP pages');
    const target=targets.find(p=>new URL(p.url).searchParams.get('petIndex')==='0')??targets[0];
    page=await connectPage(target); clients.push(page);
    if(targets.length>1){second=await connectPage(targets.find(p=>p!==target));clients.push(second);}
    let ready=false;
    for(let i=0;i<100;i++){if(await page.evaluate('Boolean(window.__dshPetDebug?.configOk && document.querySelector(".pet-hit"))')){ready=true;break;}await wait(100);}
    assert.ok(ready,'helper did not load configuration');
    await page.evaluate('for (const v of [sprites[0].videoA,sprites[0].videoB]) { v.defaultPlaybackRate=16;v.playbackRate=16; } true');
    native=await connectPage((await(await fetch(`http://127.0.0.1:${inspectorPort}/json/list`)).json())[0]);clients.push(native);
  };
  const check=async(name:string,fn:()=>Promise<void>)=>{try{await fn();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:String((error as Error).stack??error)});await writeFile(path.join(directory,'stderr-live.log'),stderr);await writeFile(path.join(directory,'stdout-live.log'),stdout);if(String(error).includes('CDP timeout'))throw error;await page?.screenshot(path.join(directory,`failure-${results.length}.png`)).catch(()=>{});}console.log(JSON.stringify(results.at(-1)));};
  const ev=(code:string)=>page.evaluate(code);
  const menu='.dsh-pet-menu';
  const visibleColumns=`[...document.querySelectorAll('.dsh-pet-menu-column')].filter(el=>el.offsetWidth&&el.offsetHeight&&getComputedStyle(el).display!=='none')`;
  const menuItem=(label:string)=>`[...document.querySelectorAll('.dsh-pet-menu-item')].find(el=>el.querySelector('span')?.textContent===${JSON.stringify(label)})`;
  const clean=async()=>{await page.key('Escape');await wait(160);};
  const openMenu=async()=>{await clean();await page.click('document.querySelector(".pet-hit")','right');for(let i=0;i<30;i++){if(await ev(`!!document.querySelector('${menu}')`))return;await wait(50);}throw Error('context menu did not open');};
  const hover=async(expression:string)=>{const point=await ev(`(()=>{const e=(${expression});if(!e)throw Error('missing menu branch');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await wait(80);};
  try{
    const original=controller.getState().config.main!;
    await controller.dispatch({type:'patch-config',patch:{notificationsEnabled:false,workStatusTexts:[['思考'],['工作'],['结果'],['等待'],['本轮工作完成占位'],['发生错误占位']],pets:[
      {...(original.pets as object[])[0],size:280,fixedEnabled:true,workStatusEnabled:true,position:{corner:'top-right',marginX:20,marginY:40}},
    ]}});
    await controller.dispatch({type:'set-enabled',enabled:true}); await connect();await wait(1000);
    const restoreCheck=async()=>{
      assert.equal(await ev('(()=>{const p=sprites[0],a=WORK_AREAS.at(-1);p.stopMove();p.stopThrow();p.sendBounds(a.x+a.width-p.hitRect.x-p.hitRect.w,a.y+a.height*.5);return p.tryCompanionDock();})()'),true);
      await controller.dispatch({type:'set-enabled',enabled:false});await controller.dispatch({type:'set-enabled',enabled:true});await connect();
      const restored=await ev('({docked:Boolean(sprites[0].companionDock),ready:sprites[0].companionReady,pos:sprites[0].pos,saved:window.petBridge.readCompanionPosition("main"),error:window.__dshPetDebug.positionRestoreError})');
      assert.equal(restored.docked,true,JSON.stringify(restored));await ev('sprites[0].goHome();true');
    };
    if(process.env.QUOTERN_FISH_RESTORE_ONLY==='1'){await check('dock-position-restores-on-helper-restart',restoreCheck);if(results.some(r=>!r.ok))throw Error('restore acceptance failed');return;}
    await check('new-menu-actions-before-other-interactions',async()=>{await openMenu();await page.click(menuItem('立即同步'));await wait(300);assert.equal(synced,1);await openMenu();await page.click(menuItem('宠物设置'));await wait(200);assert.equal(settingsOpened,1);});
    await check('single-real-helper-page',async()=>{assert.equal((await pages()).length,1);assert.equal(await ev('window.__dshPetDebug.spriteCount'),1);});
    for (const width of [160,204,264]) await check(`rendered-size:${width}`,async()=>{
      await controller.dispatch({type:'patch-pet',petId:'main',patch:{size:width}});await connect();await wait(300);
      const rect=await ev(`(()=>{const r=document.querySelector('.pet-hit').getBoundingClientRect();return{width:r.width,height:r.height}})()`);
      assert.ok(Math.abs(rect.height-width*285/640)<2,JSON.stringify(rect));
      assert.ok(Math.abs(rect.width-width*240/640)<2,JSON.stringify(rect));
      await page.screenshot(path.join(directory,`size-${width}.png`));
    });
    // Controlled cursor input exercises the real native polling timer, without
    // moving the user's physical pointer or relying on injected DOM mousemove.
    await native.evaluate(`(()=>{
      const electron=process.getBuiltinModule('module').createRequire(process.execPath)('electron');
      const screen=electron.screen, prototype=electron.BrowserWindow.prototype, originalIgnore=prototype.setIgnoreMouseEvents, originalCursor=screen.getCursorScreenPoint;
      const win=electron.BrowserWindow.getAllWindows().find(w=>new URL(w.webContents.getURL()).searchParams.get('petIndex')==='0'), originalSend=win.webContents.send;
      globalThis.__pointerAudit={point:{x:-10000,y:-10000},calls:[],samples:0,win};
      prototype.setIgnoreMouseEvents=function(ignore,options){__pointerAudit.calls.push({id:this.id,ignore,forward:options?.forward});return originalIgnore.call(this,ignore,options);};
      screen.getCursorScreenPoint=()=>__pointerAudit.point;
      win.webContents.send=function(channel,...args){if(channel==='pet:cursor-position')__pointerAudit.samples++;return originalSend.call(this,channel,...args);};
      globalThis.__restorePointerAudit=()=>{screen.getCursorScreenPoint=originalCursor;prototype.setIgnoreMouseEvents=originalIgnore;win.webContents.send=originalSend;};return true;
    })()`);
    const nativePoint=async(expression:string)=>{
      const point=await ev(`(()=>{const r=(${expression}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await native.evaluate(`(()=>{const w=__pointerAudit.win,b=w.getBounds(),z=w.webContents.getZoomFactor();__pointerAudit.point={x:b.x+${point.x}*z,y:b.y+${point.y}*z};return true;})()`);await wait(100);
    };
    const outside=async()=>{await native.evaluate('__pointerAudit.point={x:-10000,y:-10000};true;');await wait(100);};
    try {
      await check('native-poll-restores-hover-without-forwarded-mousemove',async()=>{await outside();await nativePoint('document.querySelector(".pet-hit")');assert.equal(await ev('sprites[0].companionHover'),true);assert.match(await ev('document.querySelector(".pet-bubble").textContent'),/12.3K/);const calls=await native.evaluate('__pointerAudit.calls');assert.equal(calls.at(-1).ignore,false);assert.ok(calls.every((call:any)=>call.forward===false),'no Windows native call may enable the global mouse hook');await page.screenshot(path.join(directory,'hover-usage.png'));});
      await check('native-poll-clears-hover-and-restores-passthrough',async()=>{await outside();assert.equal(await ev('sprites[0].companionHover'),false);assert.equal((await native.evaluate('__pointerAudit.calls')).at(-1).ignore,true);});
      await check('native-poll-does-not-stream-far-away-desktop-movement',async()=>{await native.evaluate('__pointerAudit.samples=0;__pointerAudit.calls=[];true;');await native.evaluate('new Promise(resolve=>{let n=0;const timer=setInterval(()=>{__pointerAudit.point={x:-10000+n++,y:-10000};if(n>=100){clearInterval(timer);resolve(true);}},1);})');await wait(80);assert.equal(await native.evaluate('__pointerAudit.samples'),0);assert.equal((await native.evaluate('__pointerAudit.calls')).length,0);});
      await check('native-poll-preserves-menu-input-regions',async()=>{await nativePoint('document.querySelector(".pet-hit")');await openMenu();await nativePoint(menuItem('动作'));assert.equal((await native.evaluate('__pointerAudit.calls')).at(-1).ignore,false);await outside();assert.equal((await native.evaluate('__pointerAudit.calls')).at(-1).ignore,true);await nativePoint(menuItem('动作'));assert.equal((await native.evaluate('__pointerAudit.calls')).at(-1).ignore,false);assert.equal(await ev('window.__dshPetDebug.menuOpen'),true);await clean();});
      await check('native-poll-preserves-drag-capture-outside-window',async()=>{await nativePoint('document.querySelector(".pet-hit")');const point=await ev(`(()=>{const r=document.querySelector('.pet-hit').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await page.call('Input.dispatchMouseEvent',{type:'mousePressed',...point,button:'left',buttons:1,clickCount:1});await wait(100);await outside();assert.equal(await ev('window.__dshPetDebug.inputBusy'),true);assert.equal((await native.evaluate('__pointerAudit.calls')).at(-1).ignore,false);await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',...point,button:'left',buttons:0,clickCount:1});await wait(100);assert.equal(await ev('window.__dshPetDebug.inputBusy'),false);assert.equal(await ev('window.__dshPetDebug.tooltipOn'),false);});
      await check('click-cycles-real-videos-and-statistics',async()=>{
        await clean();await outside();await ev('sprites[0].companionClickIndex=0;sprites[0].companionQuipIndex=0;true');
        const names=await ev('sprites[0].animations.clicks');
        for(let i=0;i<names.length;i++) { await page.click('document.querySelector(".pet-hit")');await wait(180);const src=await ev('decodeURIComponent(document.querySelector(".pet-video.is-front").src)');assert.ok(src.includes(names[i]),src);assert.equal(await ev('sprites[0].companionClickIndex'),i+1); }
        assert.match(await ev('document.querySelector(".pet-bubble").textContent'),/100K/);
      });
      await check('native-cursor-idle-sleeps-and-movement-wakes',async()=>{
        await outside();await wait(900);
        await native.evaluate('globalThis.__realNow=Date.now;Date.now=()=>__realNow()+61000;true');
        try {
          for(let i=0;i<50;i++){if(await ev('sprites[0].companionPhase==="sleep"'))break;await wait(100);}
          assert.equal(await ev('sprites[0].companionPhase'),'sleep');await page.screenshot(path.join(directory,'sleep.png'));
          await page.click('document.querySelector(".pet-hit")');
          for(let i=0;i<50;i++){if(await ev('sprites[0].companionPhase==="sleep"'))break;await wait(100);}
          assert.equal(await ev('sprites[0].companionPhase'),'sleep','a stationary click must restore the automatic rest state after its actual video');
        }
        finally {await native.evaluate('Date.now=__realNow;true');}
        await nativePoint('document.querySelector(".pet-hit")');assert.equal(await ev('sprites[0].companionIdle'),false);assert.notEqual(await ev('sprites[0].companionPhase'),'sleep');
      });
      await check('dock-peek-native-hover-expands-and-leave-collapses',async()=>{
        await outside();
        assert.equal(await ev('(()=>{const p=sprites[0],a=WORK_AREAS.at(-1);p.stopMove();p.stopThrow();p.sendBounds(a.x+a.width-p.hitRect.x-p.hitRect.w,a.y+a.height*.5);return p.tryCompanionDock();})()'),true);
        await native.evaluate(`(()=>{const w=__pointerAudit.win,b=w.getBounds(),z=w.webContents.getZoomFactor();return w.webContents.executeJavaScript('({x:sprites[0].margin.l+sprites[0].hitRect.x+4,y:sprites[0].margin.t+sprites[0].hitRect.y+sprites[0].hitRect.h/2})').then(p=>{__pointerAudit.point={x:b.x+p.x*z,y:b.y+p.y*z};return true;});})()`);
        await wait(500);assert.equal(await ev('sprites[0].companionDock.expanded'),true);assert.equal(await ev('sprites[0].companionHover'),true);
        await page.screenshot(path.join(directory,'dock-expanded.png'));
        await outside();await wait(600);assert.equal(await ev('sprites[0].companionDock.expanded'),false);
        await ev('sprites[0].goHome();true');
      });
    }finally{await native.evaluate('globalThis.__restorePointerAudit?.();true;');await clean();}
    await check('ordinary-left-click-animates',async()=>{await page.click('document.querySelector(".pet-hit")');await wait(180);assert.ok(await ev(`document.querySelector('.pet-video.is-front')?.src`));assert.equal(await ev('window.__dshPetDebug.errors.length'),0);});
    await check('context-menu-escape',async()=>{await openMenu();assert.equal(await ev('window.__dshPetDebug.menuOpen'),true);await page.key('Escape');assert.equal(await ev(`!!document.querySelector('${menu}')`),false);});
    await check('three-level-animation-menu',async()=>{
      await openMenu();await hover(menuItem('动作'));
      assert.equal(await ev(`(${visibleColumns}).length`),2);
      const branch=`(${visibleColumns})[1].querySelector('.dsh-pet-menu-branch')`;
      await hover(branch);assert.equal(await ev(`(${visibleColumns}).length`),3);
      const leaf=`(${visibleColumns})[2].querySelector('.dsh-pet-menu-item')`;
      const name=await ev(`(${leaf}).querySelector('span').textContent`);await page.click(leaf);await wait(150);
      assert.equal(await ev(`!!document.querySelector('${menu}')`),false);
      const video=await ev(`document.querySelector('.pet-video.is-front')?.src??''`);assert.ok(decodeURIComponent(video).includes(name),`${name} was not played: ${video}`);
    });
    await check('menu-has-no-retired-items',async()=>{await openMenu();assert.equal(await ev(`[...document.querySelector('.dsh-pet-menu-column').querySelectorAll('.dsh-pet-menu-item span')].some(el=>['对话','碎碎念'].includes(el.textContent))`),false);await clean();});
    await check('manual-quota-without-account-explains-unavailable',async()=>{await openMenu();await page.click(menuItem('查看余额'));await wait(500);assert.ok(await ev(`document.querySelector('.pet-bubble.is-on')?.textContent`));});
    await check('open-quotern-reaches-host',async()=>{await openMenu();const before=openedHost;await page.click(menuItem('打开 Quotern'));await wait(150);assert.equal(openedHost,before+1);});
    await check('sync-and-pet-settings-menu-reach-host',async()=>{const beforeSync=synced,beforeSettings=settingsOpened;await openMenu();await page.click(menuItem('立即同步'));await wait(250);assert.equal(synced,beforeSync+1);await openMenu();await page.click(menuItem('宠物设置'));await wait(150);assert.equal(settingsOpened,beforeSettings+1);});
    await check('drag-and-go-home',async()=>{
      await clean();const start=await ev(`(()=>{const r=document.querySelector('.pet-hit').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await page.call('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',buttons:1,clickCount:1});
      for(let i=1;i<=4;i++){await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x+12*i,y:start.y+8*i,buttons:1});await wait(80);}
      await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:start.x+48,y:start.y+32,button:'left',buttons:0,clickCount:1});await wait(180);
      assert.ok(await ev('window.__dshPetDebug.lastDragRelease || window.__dshPetDebug.lastDragRaw'));
      await openMenu();await page.click(menuItem('回到初始位置'));await wait(150);assert.equal(await ev('window.__dshPetDebug.inputBusy'),false);
    });
    await check('menu-reload-replaces-helper',async()=>{await openMenu();const previous=child?.pid;await page.click(menuItem('重载配置'));for(let i=0;i<100&&child?.pid===previous;i++)await wait(100);assert.notEqual(child?.pid,previous);await connect();assert.equal(controller.getState().status,'running');});
    await check('dock-position-restores-on-helper-restart',restoreCheck);
    await check('menu-click-outside-closes',async()=>{await openMenu();await page.call('Input.dispatchMouseEvent',{type:'mousePressed',x:2,y:2,button:'left',clickCount:1});await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:2,y:2,button:'left',clickCount:1});assert.equal(await ev(`!!document.querySelector('${menu}')`),false);});
    for(const [label,value,count] of [['两者','both',1],['仅桌面','desktop',1],['仅网页','web',0],['都不','none',0]] as const){
      // Restore the fixture before testing another choice that hides its own window.
      if(!controller.getState().enabled){
        await controller.dispatch({type:'set-enabled',enabled:true});await connect();
      }
      await check(`display-menu:${value}`,async()=>{await openMenu();await hover(menuItem('显示位置'));const previous=child?.pid;await page.click(menuItem(label));for(let i=0;i<100&&child?.pid===previous;i++)await wait(100);assert.notEqual(child?.pid,previous);if(count)await connect();assert.equal((controller.getState().config.main!.pets as any[])[0].display,value);assert.equal((await pages()).length,count);if(!count)assert.equal(controller.getState().enabled,false);});
    }
    if(!controller.getState().enabled){await controller.dispatch({type:'set-enabled',enabled:true});await connect();}
    await page.screenshot(path.join(directory,'helper-final.png'));
  }catch(error){results.push({name:'runner',ok:false,error:String((error as Error).stack??error)});throw error;}
  finally{
    await controller.dispose();for(const client of clients)client.close();
    await writeFile(path.join(directory,'stdout.log'),stdout);await writeFile(path.join(directory,'stderr.log'),stderr);
    await writeFile(path.join(directory,'result.json'),JSON.stringify({ok:results.length>0&&results.every(r=>r.ok),checks:results.length,passed:results.filter(r=>r.ok).length,openedHost,results},null,2));
  }
  if(results.some(r=>!r.ok))process.exitCode=1;
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
