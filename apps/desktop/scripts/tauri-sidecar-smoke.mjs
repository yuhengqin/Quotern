import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { hostNodeTriple } from './prepare-tauri-node.mjs';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const home = await mkdtemp(join(tmpdir(),'quotern-tauri-test-'));
const data = join(home,'data');
const profile = join(home,'profile');
const config = join(home,'config');
await Promise.all([data,profile,config].map(dir=>mkdir(dir,{recursive:true})));
const env = {SystemRoot:process.env.SystemRoot,PATH:process.env.PATH,TEMP:home,TMP:home,TMPDIR:home,
  HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home,XDG_CONFIG_HOME:config,XDG_DATA_HOME:data,
  QUOTERN_CONFIG_HOME:config,QUOTERN_DATA_DIR:data,QUOTERN_DESKTOP_USER_DATA:profile,QUOTERN_DEV_ISOLATED:'1'};
const exe=join(desktop,'src-tauri','binaries','quotern-node-'+hostNodeTriple()+(process.platform==='win32'?'.exe':''));
const script=join(desktop,'out','sidecar','quotern-desktop-runtime.cjs');
const child=spawn(exe,[script],{cwd:dirname(script),env,windowsHide:true,stdio:['pipe','pipe','pipe']});
const ended = once(child,'exit');
let id=0, diagnostics='', events=0;
const pending=new Map();
child.stderr.on('data',data=>{ diagnostics=(diagnostics+data.toString()).slice(-12000); });
const lines=createInterface({input:child.stdout});
lines.on('line',line=>{
  const reply=JSON.parse(line);
  if(reply.type==='event') {events++;return;}
  if(reply.type==='native'){child.stdin.write(JSON.stringify({type:'native-reply',id:reply.id,value:null})+'\n');return;}
  const call=pending.get(reply.id);
  if(!call)return;
  pending.delete(reply.id);
  if(reply.error)call.reject(new Error(reply.error));else call.resolve(reply.value);
});
function send(channel,...args) {
  return new Promise((resolve,reject)=>{
    const key=++id;pending.set(key,{resolve,reject});
    child.stdin.write(JSON.stringify({id:key,window:'main',channel,args})+'\n');
  });
}
child.on('exit',()=>{for (const call of pending.values()) call.reject(Error('Sidecar exited: '+diagnostics)); pending.clear();});
const timeout=setTimeout(()=>child.kill(),90000);
try {
  assert.equal((await send('locale:get')).preference,'system');
  const quota=await send('quota:get');
  assert.equal(quota.providers.length,14);
  assert.ok(quota.providers.every(p=>p.access?.url.startsWith('https://')&&!p.access.connected&&p.fetchedAt===null));
  await assert.rejects(send('quota:authorize','deepseek',''));
  await assert.rejects(send('quota:authorize','cursor','test'));
  await assert.rejects(send('cursor-subscription:get'));
  await assert.rejects(send('tud:api-request','https://example.org/'));
  const [health, summary]=await Promise.all(['/health','/functions/tud-usage-summary'].map(path=>send('tud:api-request',path)));
  assert.deepEqual(health,{status:200,body:{ok:true}});
  assert.equal(summary.status,200);
  assert.equal(summary.body.success,true);
  assert.equal(JSON.parse(await readFile(join(data,'tud.pid'),'utf8')).pid,child.pid);
  assert.equal((await send('locale:set','en')).resolved,'en');
  assert.equal((await send('locale:get')).resolved,'en');
  const result=await send('tud:api-request','/functions/tud-session-list?limit=5');
  assert.equal(result.status,200);
  assert.ok(events>0);
  child.stdin.end();
  const [exitCode]=await ended;
  assert.equal(exitCode,0);
  await assert.rejects(access(join(data,'tud.pid')), {code:'ENOENT'});
  console.log('Bundled Node: IPC, 14 official-access cards, local API, session worker, preferences, owner and clean shutdown passed.');
} catch (error) {
  console.error(diagnostics);
  throw error;
} finally {
  clearTimeout(timeout);
  if(child.exitCode===null&&child.signalCode===null) {child.kill();await ended;}
  await rm(home,{recursive:true,force:true,maxRetries:4});
}
