import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { setTimeout as wait } from 'node:timers/promises';
import { mkdtemp, mkdir, readFile, access, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { hostNodeTriple } from './prepare-tauri-node.mjs';
import { prepareQuotaCliFixture } from './tauri-quota-fixture.mjs';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const home = await mkdtemp(join(tmpdir(),'quotern-tauri-test-'));
const data = join(home,'data');
const profile = join(home,'profile');
const config = join(home,'config');
await Promise.all([data,profile,config].map(dir=>mkdir(dir,{recursive:true})));
const since = new Date(Date.now() - 86_400_000).toISOString();
await writeFile(join(data, 'config.json'), JSON.stringify({
  deviceId: '54327e68-27f5-4c0d-acda-8678c47f564a', hostname: 'Isolated test',
  dataDir: data, statsSince: since, localCollectSince: since, serverPort: 8252, lastSyncAt: null,
}));
const cursorDb = join(home, 'synthetic-cursor.vscdb');
const db = new DatabaseSync(cursorDb);
db.exec('CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value TEXT)');
const fixtureToken = 'e30.' + Buffer.from('{"sub":"auth0|user_synthetic"}').toString('base64url') + '.fixture';
db.prepare('INSERT INTO ItemTable VALUES (?, ?)').run('cursorAuth/accessToken', fixtureToken);
db.close();
const cursorRow = [new Date().toISOString(), 'claude-4-sonnet', 1200, 1000, 500, 800, 2500, 0.05].join(',');
const cursorEndpoint = createServer((request, response) => {
  if (request.url !== '/api/dashboard/export-usage-events-csv?strategy=tokens') {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, { 'Content-Type': 'text/csv' }).end(
    'Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Total Tokens,Cost\n' + cursorRow + '\n',
  );
});
cursorEndpoint.listen(0, '127.0.0.1');
await once(cursorEndpoint, 'listening');
const env = {SystemRoot:process.env.SystemRoot,TEMP:home,TMP:home,TMPDIR:home,
  HOME:home,USERPROFILE:home,APPDATA:home,LOCALAPPDATA:home,XDG_CONFIG_HOME:config,XDG_DATA_HOME:data,
  CURSOR_STATE_DB_PATH:cursorDb,CURSOR_WEB_BASE_URL:'http://127.0.0.1:'+cursorEndpoint.address().port,
  QUOTERN_CONFIG_HOME:config,QUOTERN_DATA_DIR:data,QUOTERN_DESKTOP_USER_DATA:profile,QUOTERN_DEV_ISOLATED:'1'};
await prepareQuotaCliFixture(home, env);
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
  let quota=await send('quota:get');
  assert.equal(quota.providers.length,14);
  assert.ok(quota.providers.every(p=>p.access?.url.startsWith('https://')));
  assert.ok(quota.providers.filter(p=>p.access.method!=='official-cli').every(p=>!p.access.connected&&p.fetchedAt===null));
  const quotaDeadline = Date.now() + 20_000;
  while (quota.providers.some(p => p.access.method === 'official-cli' && p.queriedAt === null) && Date.now() < quotaDeadline) {
    await wait(100);
    quota = await send('quota:get');
  }
  const claude = quota.providers.find(p => p.id === 'claude');
  assert.equal(claude?.status, 'ready', 'startup must read the signed-in CLI without a connection request');
  assert.equal(claude.windows[0]?.usedPercent, 37);
  if (process.platform === 'win32') {
    for (const id of ['codex', 'copilot', 'minimax', 'muse']) {
      assert.equal(quota.providers.find(p => p.id === id)?.status, 'not-installed', `${id} is absent from the fixture`);
    }
  }
  await assert.rejects(send('quota:authorize','deepseek',''));
  await assert.rejects(send('quota:authorize','claude'));
  await assert.rejects(send('quota:authorize','cursor','test'));
  await assert.rejects(send('cursor-subscription:get'));
  await assert.rejects(send('tud:api-request','https://example.org/'));
  const [health, summary]=await Promise.all(['/health','/functions/tud-usage-summary'].map(path=>send('tud:api-request',path)));
  assert.deepEqual(health,{status:200,body:{ok:true}});
  assert.equal(summary.status,200);
  assert.equal(summary.body.success,true);
  const cursorSync = await send('tud:api-request', '/functions/tud-trigger-sync', {
    method: 'POST', body: JSON.stringify({ source: 'cursor' }),
  });
  assert.equal(cursorSync.status, 200);
  const cursorUsage = await send('tud:api-request', '/functions/tud-usage-summary?source=cursor');
  assert.equal(cursorUsage.body.data.totalTokens, 2500, 'bundled Desktop must collect Cursor usage');
  assert.equal(quota.providers.find(provider => provider.id === 'cursor')?.access?.method, 'official-page');
  assert.equal(JSON.parse(await readFile(join(data,'tud.pid'),'utf8')).pid,child.pid);
  const heartbeat = async () => JSON.parse(await readFile(join(data, 'tud.heartbeat'), 'utf8'));
  const initialHeartbeat = await heartbeat();
  assert.equal(initialHeartbeat.pid, child.pid);
  assert.equal((await send('locale:set','en')).resolved,'en');
  assert.equal((await send('locale:get')).resolved,'en');
  const result=await send('tud:api-request','/functions/tud-session-list?limit=5');
  assert.equal(result.status,200);
  assert.ok(events>0);
  const deadline = Date.now() + 40_000;
  let latestHeartbeat = initialHeartbeat;
  while (latestHeartbeat.at <= initialHeartbeat.at && Date.now() < deadline) {
    await wait(250);
    latestHeartbeat = await heartbeat();
  }
  assert.equal(latestHeartbeat.pid, child.pid);
  assert.ok(latestHeartbeat.at > initialHeartbeat.at, 'the background watchdog must renew the heartbeat');
  child.stdin.end();
  const [exitCode]=await ended;
  assert.equal(exitCode,0);
  await assert.rejects(access(join(data,'tud.pid')), {code:'ENOENT'});
  await assert.rejects(access(join(data, 'tud.heartbeat')), {code:'ENOENT'});
  console.log('Bundled Node: IPC, 14 official-access cards, local API, session worker, preferences, heartbeat and clean shutdown passed.');
} catch (error) {
  console.error(diagnostics);
  throw error;
} finally {
  clearTimeout(timeout);
  if(child.exitCode===null&&child.signalCode===null) {child.kill();await ended;}
  cursorEndpoint.closeAllConnections();
  await new Promise(resolve => cursorEndpoint.close(resolve));
  await rm(home,{recursive:true,force:true,maxRetries:4});
}
