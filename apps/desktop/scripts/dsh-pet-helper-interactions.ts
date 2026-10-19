// Dedicated host/controller + real packaged helper. No normal Quotern collector.
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DshPetController } from '../src/main/dsh-pet/controller';
// @ts-ignore manual acceptance driver, not part of the runtime bundle
import { connectPage, unusedPort, wait } from './desktop-cdp.mjs';

async function main() {
  const [executable, runtimeRoot, output] = process.argv.slice(2);
  assert.ok(executable && runtimeRoot && output, 'exe runtimeRoot output');
  const directory=path.resolve(output); await mkdir(directory,{recursive:true});
  const results: Array<{name:string;ok:boolean;error?:string}>=[];
  let requests=0, openedHost=0, stdout='', stderr='', child: ChildProcess | null=null;
  const clients: any[]=[];
  const api=createServer(async(req,res)=>{
    let body='';for await(const chunk of req)body+=chunk;
    const raw=JSON.parse(body); requests++;
    res.setHeader('content-type','application/json');
    if(raw.messages.at(-1)?.content?.includes('audit-model-error')){res.statusCode=503;res.end('{}');return;}
    res.end(JSON.stringify({choices:[{message:{content:`Helper界面回复${requests}`},finish_reason:'stop'}]}));
  });
  await new Promise<void>(resolve=>api.listen(0,'127.0.0.1',resolve));
  const port=await unusedPort();
  const controller=new DshPetController({root:path.join(directory,'host'),runtimeRoot:path.resolve(runtimeRoot),executable:path.resolve(executable),appPath:path.join(path.dirname(path.resolve(executable)),'resources/app.asar'),packaged:true,
    secrets:{isEncryptionAvailable:()=>false,encryptString:()=>{throw Error('not used');},decryptString:()=>{throw Error('not used');}},
    getQuota:()=>null,showMainWindow:()=>{openedHost++;},openDirectory:async()=>{},roots:[],
    spawn:(exe,args,options)=>{child=spawn(exe,[...args,`--remote-debugging-port=${port}`],options);child.stdout?.on('data',c=>{stdout+=String(c);});child.stderr?.on('data',c=>{stderr+=String(c);});return child;},
  });
  let page: any, second: any;
  const pages=async()=>((await(await fetch(`http://127.0.0.1:${port}/json/list`)).json()) as any[]).filter(p=>p.type==='page');
  const connect=async()=>{
    let targets:any[]=[];
    for(let i=0;i<120;i++){try{targets=await pages();}catch{}if(targets.length)break;await wait(100);}
    assert.ok(targets.length,'helper CDP pages');
    const target=targets.find(p=>new URL(p.url).searchParams.get('petIndex')==='0')??targets[0];
    page=await connectPage(target); clients.push(page);
    if(targets.length>1){second=await connectPage(targets.find(p=>p!==target));clients.push(second);}
    for(let i=0;i<100;i++){if(await page.evaluate('Boolean(window.__dshPetDebug?.configOk && document.querySelector(".pet-hit"))'))return;await wait(100);}
    throw Error('helper did not load configuration');
  };
  const check=async(name:string,fn:()=>Promise<void>)=>{try{await fn();results.push({name,ok:true});}catch(error){results.push({name,ok:false,error:String((error as Error).stack??error)});await page?.screenshot(path.join(directory,`failure-${results.length}.png`)).catch(()=>{});}console.log(JSON.stringify(results.at(-1)));};
  const ev=(code:string)=>page.evaluate(code);
  const menu='.dsh-pet-menu', chat='.dsh-pet-chat';
  const visibleColumns=`[...document.querySelectorAll('.dsh-pet-menu-column')].filter(el=>el.offsetWidth&&el.offsetHeight&&getComputedStyle(el).display!=='none')`;
  const menuItem=(label:string)=>`[...document.querySelectorAll('.dsh-pet-menu-item')].find(el=>el.querySelector('span')?.textContent===${JSON.stringify(label)})`;
  const clean=async()=>{await page.key('Escape');await wait(160);};
  const openMenu=async()=>{await clean();await page.click('document.querySelector(".pet-hit")','right');for(let i=0;i<30;i++){if(await ev(`!!document.querySelector('${menu}')`))return;await wait(50);}throw Error('context menu did not open');};
  const hover=async(expression:string)=>{const point=await ev(`(()=>{const e=(${expression});if(!e)throw Error('missing menu branch');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',...point});await wait(80);};
  const openChat=async()=>{await openMenu();await page.click(menuItem('对话'));for(let i=0;i<30;i++){if(await ev(`!!document.querySelector('${chat} textarea')`))return;await wait(50);}throw Error('chat did not open');};
  const waitFor=async(expression:string)=>{for(let i=0;i<100;i++){if(await ev(expression))return;await wait(50);}throw Error(`Timed out: ${expression}`);};
  const poll=async()=>JSON.parse((await controller.dispatch({type:'request',method:'GET',path:'/state'}) as {body:string}).body);
  try{
    const original=controller.getState().config.main!;
    await controller.dispatch({type:'patch-config',patch:{notificationsEnabled:false,workStatusTexts:[['思考'],['工作'],['结果'],['等待'],['本轮工作完成占位'],['发生错误占位']],pets:[
      {...(original.pets as object[])[0],size:280,whisperEnabled:false,fixedEnabled:true,workStatusEnabled:true,position:{corner:'top-right',marginX:20,marginY:40}},
      {...(original.pets as object[])[0],id:'friend',name:'菜单同伴',size:200,whisperEnabled:false,fixedEnabled:true,position:{corner:'bottom-right',marginX:200,marginY:80}},
    ]}});
    await controller.dispatch({type:'save-provider',provider:{id:'local',name:'Local helper audit',baseUrl:`http://127.0.0.1:${(api.address() as any).port}/v1`,models:['audit']}});
    await controller.dispatch({type:'set-default-model',model:{provider:'local',model:'audit'}});
    await controller.dispatch({type:'set-enabled',enabled:true}); await connect();await wait(1000);
    await check('two-real-helper-pages',async()=>{assert.equal((await pages()).length,2);assert.equal(await ev('window.__dshPetDebug.spriteCount'),1);assert.equal(await second.evaluate('window.__dshPetDebug.spriteCount'),1);});
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
    await check('chat-focus-and-escape',async()=>{await openChat();assert.equal(await ev(`document.activeElement===document.querySelector('${chat} textarea')`),true);await page.key('Escape');assert.equal(await ev(`!!document.querySelector('${chat}')`),false);});
    await check('chat-composition-enter-does-not-send',async()=>{
      await openChat();await page.fill(`document.querySelector('${chat} textarea')`,'输入法确认测试');const before=requests;
      await ev(`document.querySelector('${chat} textarea').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:229,isComposing:true,bubbles:true})); true;`);
      await wait(300);assert.equal(requests,before,'IME confirmation must not send chat');assert.equal(await ev(`!!document.querySelector('${chat}')`),true);
      await clean();
    });
    await check('chat-error-remains-editable',async()=>{await openChat();await page.fill(`document.querySelector('${chat} textarea')`,'audit-model-error');await page.key('Enter');await waitFor(`Boolean(document.querySelector('${chat} .dsh-pet-chat-err')?.textContent)`);assert.equal(await ev(`document.querySelector('${chat} textarea').disabled`),false);assert.equal(await ev(`document.querySelector('${chat} textarea').value`),'audit-model-error');await page.fill(`document.querySelector('${chat} textarea')`,'保留错误提示并继续输入'.repeat(100));const r=await ev(`(()=>{const r=document.querySelector('${chat}').getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}})()`);assert.ok(r.left>=0&&r.top>=0&&r.right<=r.width&&r.bottom<=r.height,JSON.stringify(r));await clean();});
    await check('chat-growth-stays-in-viewport',async()=>{await openChat();await page.fill(`document.querySelector('${chat} textarea')`,'边缘输入框'.repeat(160));await wait(200);const r=await ev(`(()=>{const r=document.querySelector('${chat}').getBoundingClientRect();return{left:r.left,top:r.top,right:r.right,bottom:r.bottom,width:innerWidth,height:innerHeight}})()`);assert.ok(r.left>=0&&r.top>=0&&r.right<=r.width&&r.bottom<=r.height,JSON.stringify(r));await clean();});
    await check('chat-success-shows-actual-reply',async()=>{await openChat();await page.fill(`document.querySelector('${chat} textarea')`,'你好，回复可见性测试');await page.key('Enter');await waitFor(`!document.querySelector('${chat}')`);await wait(500);const bubble=await ev(`document.querySelector('.pet-bubble.is-on')?.textContent??''`);assert.match(bubble,/Helper界面回复/,'model reply must be visible instead of being hidden by the generic work status');});
    await check('manual-whisper-shows-actual-reply',async()=>{await openMenu();const before=(await poll()).pets.main?.say?.counter??0;await page.click(menuItem('碎碎念'));await wait(700);assert.ok((await poll()).pets.main.say.counter>before);assert.match(await ev(`document.querySelector('.pet-bubble.is-on')?.textContent??''`),/Helper界面回复/);});
    await check('manual-quota-without-account-explains-unavailable',async()=>{await openMenu();await page.click(menuItem('查看余额'));await wait(500);assert.ok(await ev(`document.querySelector('.pet-bubble.is-on')?.textContent`));});
    await check('open-quotern-reaches-host',async()=>{await openMenu();const before=openedHost;await page.click(menuItem('打开 Quotern'));await wait(150);assert.equal(openedHost,before+1);});
    await check('drag-and-go-home',async()=>{
      await clean();const start=await ev(`(()=>{const r=document.querySelector('.pet-hit').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
      await page.call('Input.dispatchMouseEvent',{type:'mousePressed',...start,button:'left',buttons:1,clickCount:1});
      for(let i=1;i<=4;i++){await page.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:start.x+12*i,y:start.y+8*i,buttons:1});await wait(80);}
      await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:start.x+48,y:start.y+32,button:'left',buttons:0,clickCount:1});await wait(180);
      assert.ok(await ev('window.__dshPetDebug.lastDragRelease || window.__dshPetDebug.lastDragRaw'));
      await openMenu();await page.click(menuItem('回到初始位置'));await wait(150);assert.equal(await ev('window.__dshPetDebug.inputBusy'),false);
    });
    await check('menu-reload-replaces-helper',async()=>{await openMenu();const previous=child?.pid;await page.click(menuItem('重载配置'));for(let i=0;i<100&&child?.pid===previous;i++)await wait(100);assert.notEqual(child?.pid,previous);await connect();assert.equal(controller.getState().status,'running');});
    await check('menu-click-outside-closes',async()=>{await openMenu();await page.call('Input.dispatchMouseEvent',{type:'mousePressed',x:2,y:2,button:'left',clickCount:1});await page.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:2,y:2,button:'left',clickCount:1});assert.equal(await ev(`!!document.querySelector('${menu}')`),false);});
    for(const [label,value,count] of [['两者','both',2],['仅桌面','desktop',2],['仅网页','web',1],['都不','none',1]] as const){
      // Restore the fixture before testing another choice that hides its own window.
      if((controller.getState().config.main!.pets as any[])[0].display==='web'){
        const pets=(controller.getState().config.main!.pets as any[]).map((pet,index)=>index===0?{...pet,display:'desktop'}:pet);
        await controller.dispatch({type:'patch-config',patch:{pets}});await connect();
      }
      await check(`display-menu:${value}`,async()=>{await openMenu();await hover(menuItem('显示位置'));const previous=child?.pid;await page.click(menuItem(label));for(let i=0;i<100&&child?.pid===previous;i++)await wait(100);assert.notEqual(child?.pid,previous);await connect();assert.equal((controller.getState().config.main!.pets as any[])[0].display,value);assert.equal((await pages()).length,count);});
    }
    await page.screenshot(path.join(directory,'helper-final.png'));
  }catch(error){results.push({name:'runner',ok:false,error:String((error as Error).stack??error)});throw error;}
  finally{
    await controller.dispose();for(const client of clients)client.close();api.closeAllConnections();await new Promise<void>(resolve=>api.close(()=>resolve()));
    await writeFile(path.join(directory,'stdout.log'),stdout);await writeFile(path.join(directory,'stderr.log'),stderr);
    await writeFile(path.join(directory,'result.json'),JSON.stringify({ok:results.length>0&&results.every(r=>r.ok),checks:results.length,passed:results.filter(r=>r.ok).length,requests,openedHost,results},null,2));
  }
  if(results.some(r=>!r.ok))process.exitCode=1;
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
