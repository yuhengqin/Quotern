import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createDevSession } from './dev-instance.mjs';
import { once } from 'node:events';

const source = join(dirname(fileURLToPath(import.meta.url)), '..');
const lanHost = Object.values(networkInterfaces()).flat().find(address => address.family === 'IPv4' && !address.internal)?.address;
function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}
async function guardianExited(root, mode) {
  if (process.platform !== 'win32') return;
  let record;
  try { record = JSON.parse(await readFile(join(root, `.quotern-dev/${mode}.json`), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  if (record.processTracker?.guardianPid) await until(() => !alive(record.processTracker.guardianPid), 'Job observer exited', 10000);
}
async function until(check, description, timeout = 25000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${description}`);
}
async function start(t, host) {
  const root = await mkdtemp(join(tmpdir(), 'quotern-live-dev-'));
  let child;
  const stop = async () => {
    if (!child || child.exitCode != null || child.signalCode != null) return;
    child.send({ type: 'quotern-dev-stop' });
    await until(() => child.exitCode != null || child.signalCode != null, 'supervisor cleanup', 10000);
    assert.equal(child.exitCode, 0);
  };
  t.after(async () => { await stop(); await guardianExited(root, 'cli'); await rm(root, { recursive: true, force: true }); });
  await mkdir(join(root, 'scripts'));
  await cp(join(source, 'scripts/dev.mjs'), join(root, 'scripts/dev.mjs'));
  await cp(join(source, 'scripts/dev-instance.mjs'), join(root, 'scripts/dev-instance.mjs'));
  await cp(join(source, 'scripts/dev-processes.mjs'), join(root, 'scripts/dev-processes.mjs'));
  await cp(join(source, 'scripts/vite-core-source.mjs'), join(root, 'scripts/vite-core-source.mjs'));
  for (const file of ['dev-windows-job.mjs', 'dev-windows-job.ps1', 'dev-windows-job-host.mjs']) await cp(join(source, 'scripts', file), join(root, 'scripts', file));
  await writeFile(join(root, 'package.json'), '{"name":"quotern-dev-fixture","type":"module","private":true}');
  await mkdir(join(root, 'packages/cli'), { recursive: true });
  await cp(join(source, 'packages/cli/bin'), join(root, 'packages/cli/bin'), { recursive: true });
  await cp(join(source, 'packages/cli/dist'), join(root, 'packages/cli/dist'), { recursive: true });
  await symlink(join(source, 'packages/cli/node_modules'), join(root, 'packages/cli/node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const ui = join(root, 'packages/dashboard');
  await mkdir(join(ui, 'src/routes'), { recursive: true });
  await cp(join(source, 'packages/dashboard/vite.config.ts'), join(ui, 'vite.config.ts'));
  await writeFile(join(ui, 'package.json'), '{"name":"fixture-ui","version":"0.0.0","type":"module"}');
  await writeFile(join(ui, 'index.html'), '<!doctype html><html><body>isolated fixture UI</body></html>');
  await symlink(join(source, 'packages/dashboard/node_modules'), join(ui, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  // Builds are already verified by the root suite; fixtures reuse its compiled CLI.
  const builder = join(root, 'built-fixture.cjs');
  await writeFile(builder, 'process.exit(0);');
  const home = join(root, 'fixture-home');
  await mkdir(home);
  let output = '';
  child = spawn(process.execPath, [join(root, 'scripts/dev.mjs'), 'cli'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: {
      ...process.env, npm_execpath: builder, HOME: home, USERPROFILE: home,
      APPDATA: join(home, 'AppData/Roaming'), CODEX_HOME: join(home, '.codex'),
      AI_USAGE_CODEX_HOME: join(home, '.codex'), CLAUDE_CONFIG_DIR: join(home, '.claude'),
      CURSOR_STATE_DB_PATH: join(home, 'no-cursor.sqlite'),
      VITE_CLI_API_ORIGIN: '', QUOTERN_DEV_API_PORT: undefined,
      QUOTERN_DEV_UI_PORT: undefined, QUOTERN_DEV_DESKTOP_PORT: undefined,
      QUOTERN_DEV_HOST: host,
    },
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => { output += data; });
  const config = await until(async () => {
    if (child.exitCode != null) throw new Error(`launcher exited ${child.exitCode}: ${output}`);
    let record;
    try { record = JSON.parse(await readFile(join(root, '.quotern-dev/instance.json'), 'utf8')); }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    try {
      const response = await fetch(`http://127.0.0.1:${record.uiPort}/health`, { signal: AbortSignal.timeout(500) });
      return response.ok ? record : false;
    } catch { return false; }
  }, 'CLI and Vite ready');
  return { root, config, stop, child };
}
async function configAt(port, host = '127.0.0.1') {
  const response = await fetch(`http://${host}:${port}/functions/tud-config`, { signal: AbortSignal.timeout(2000) });
  assert.equal(response.status, 200);
  return (await response.json()).data;
}

test('real CLI/Vite instances proxy private identities and stopping one leaves the other serving', { timeout: 60000 }, async (t) => {
  const a = await start(t);
  if (process.platform === 'win32') {
    const record = JSON.parse(await readFile(join(a.root, '.quotern-dev/cli.json'), 'utf8'));
    assert.equal(record.processTracker?.kind, 'windows-job-v1');
  }
  const b = await start(t);
  assert.notEqual(a.config.apiPort, b.config.apiPort);
  assert.notEqual(a.config.uiPort, b.config.uiPort);
  const apiA = await configAt(a.config.apiPort);
  const apiB = await configAt(b.config.apiPort);
  assert.notEqual(apiA.deviceId, apiB.deviceId);
  // Startup sync may update lastSyncAt between requests; identity pins routing.
  assert.equal((await configAt(a.config.uiPort)).deviceId, apiA.deviceId);
  assert.equal((await configAt(b.config.uiPort)).deviceId, apiB.deviceId);
  for (const instance of [a, b]) {
    const health = await fetch(`http://127.0.0.1:${instance.config.apiPort}/health`);
    assert.equal(health.headers.get('X-Quotern-Dev-Instance'), instance.config.apiSessionId);
    await health.body.cancel();
    if (lanHost) {
      for (const port of [instance.config.apiPort, instance.config.uiPort]) {
        await assert.rejects(fetch(`http://${lanHost}:${port}/health`, { signal: AbortSignal.timeout(1000) }));
      }
    }
  }
  await a.stop();
  assert.equal((await configAt(b.config.uiPort)).deviceId, apiB.deviceId);
  assert.equal((await configAt(b.config.apiPort)).deviceId, apiB.deviceId);
  const stopped = JSON.parse(await readFile(join(a.root, '.quotern-dev/cli.json'), 'utf8'));
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.exitCode, 0);
});

test('wildcard CLI and Vite serve the LAN interface and accept same-host achievement mutations', {
  skip: !lanHost && 'no non-loopback IPv4 interface', timeout: 60000,
}, async (t) => {
  const instance = await start(t, '0.0.0.0');
  const localConfig = await configAt(instance.config.apiPort);
  for (const port of [instance.config.apiPort, instance.config.uiPort]) {
    assert.equal((await configAt(port, lanHost)).deviceId, localConfig.deviceId);
    const response = await fetch(`http://${lanHost}:${port}/health`, { signal: AbortSignal.timeout(2000) });
    assert.equal(response.headers.get('X-Quotern-Dev-Instance'), instance.config.apiSessionId);
    await response.body.cancel();
    const post = origin => fetch(`http://${lanHost}:${port}/functions/tud-achievements`, {
      method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' },
      body: JSON.stringify({ operation: 'preferences', celebrationsEnabled: false }),
      signal: AbortSignal.timeout(3000),
    });
    const updated = await post(`http://${lanHost}:${instance.config.uiPort}`);
    const result = await updated.json();
    assert.equal(updated.status, 200, `port ${port}: ${JSON.stringify(result)}`);
    assert.equal(result.data.snapshot.preferences.celebrationsEnabled, false);
    const rejected = await post('https://evil.example');
    assert.equal(rejected.status, 403);
    await rejected.body.cancel();
  }
});

async function startRenderer(t, host) {
  const root = await mkdtemp(join(tmpdir(), 'quotern-renderer-host-'));
  const desktop = join(root, 'apps/desktop');
  let child;
  t.after(async () => {
    if (child && child.exitCode == null && child.signalCode == null) {
      child.kill('SIGTERM');
      await until(() => child.exitCode != null || child.signalCode != null, 'renderer cleanup', 10000);
    }
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'scripts'));
  await cp(join(source, 'scripts/vite-core-source.mjs'), join(root, 'scripts/vite-core-source.mjs'));
  await mkdir(join(desktop, 'src/renderer/routes'), { recursive: true });
  await cp(join(source, 'apps/desktop/electron.vite.config.ts'), join(desktop, 'electron.vite.config.ts'));
  await writeFile(join(desktop, 'package.json'), '{"name":"fixture-renderer","version":"0.0.0","type":"module"}');
  await writeFile(join(desktop, 'src/renderer/index.html'), '<!doctype html><html><body>isolated renderer fixture</body></html>');
  await writeFile(join(desktop, 'src/renderer/routes/__root.tsx'), 'import { createRootRoute } from "@tanstack/react-router"; export const Route = createRootRoute();');
  await symlink(join(source, 'apps/desktop/node_modules'), join(desktop, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(join(desktop, 'serve.mjs'), `
    import { loadConfigFromFile } from 'electron-vite';
    import { createServer } from 'vite';
    const { config } = await loadConfigFromFile({ command: 'serve', mode: 'development' });
    const server = await createServer({ ...config.renderer, configFile: false, cacheDir: '.vite-test', logLevel: 'error' });
    process.once('SIGTERM', () => { void server.close().then(() => process.exit(0)); });
    await server.listen();
    console.log('renderer-ready:' + JSON.stringify(server.httpServer.address()));
  `);
  const reservation = net.createServer();
  await new Promise((resolve, reject) => { reservation.once('error', reject); reservation.listen(0, '0.0.0.0', resolve); });
  const port = reservation.address().port;
  await new Promise(resolve => reservation.close(resolve));
  let output = '';
  child = spawn(process.execPath, [join(desktop, 'serve.mjs')], {
    cwd: desktop, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, QUOTERN_DEV_HOST: host, QUOTERN_DEV_DESKTOP_PORT: String(port) },
  });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', data => { output += data; });
  return until(() => {
    if (child.exitCode != null) throw new Error(`renderer exited ${child.exitCode}: ${output}`);
    const match = output.match(/renderer-ready:(\{[^\n]+\})/);
    return match ? JSON.parse(match[1]) : false;
  }, 'renderer listening');
}

test('desktop renderer keeps loopback by default and listens on the LAN when requested', { timeout: 60000 }, async (t) => {
  const local = await startRenderer(t);
  assert.equal(local.address, '127.0.0.1');
  const response = await fetch(`http://127.0.0.1:${local.port}/`, { signal: AbortSignal.timeout(2000) });
  assert.equal(response.status, 200);
  await response.body.cancel();
  const external = await startRenderer(t, '0.0.0.0');
  assert.equal(external.address, '0.0.0.0');
  if (lanHost) {
    const remote = await fetch(`http://${lanHost}:${external.port}/`, { signal: AbortSignal.timeout(2000) });
    assert.equal(remote.status, 200);
    assert.match(await remote.text(), /isolated renderer fixture/);
  } else t.diagnostic('no non-loopback IPv4 interface; only renderer binding was verified');
});

for (const ending of ['completed build', 'signalled build', 'completed service', 'service exits during shutdown']) {
test(`POSIX only probes ${ending} groups and recovers after their last descendant exits`, {
  skip: process.platform === 'win32', timeout: 20000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-posix-build-group-'));
  const duringShutdown = ending === 'service exits during shutdown';
  const serviceDescendant = ending.includes('service');
  let supervisor;
  let grandchildPid;
  t.after(async () => {
    if (supervisor && supervisor.exitCode == null && supervisor.signalCode == null) {
      supervisor.kill('SIGTERM');
      await until(() => supervisor.exitCode != null || supervisor.signalCode != null, 'fixture supervisor stopped');
    }
    if (grandchildPid && alive(grandchildPid)) process.kill(grandchildPid, 'SIGKILL');
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'scripts'));
  for (const file of ['dev.mjs', 'dev-instance.mjs', 'dev-processes.mjs', 'dev-windows-job.mjs', 'dev-windows-job.ps1', 'dev-windows-job-host.mjs']) {
    await cp(join(source, 'scripts', file), join(root, 'scripts', file));
  }
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  await mkdir(join(root, 'packages/cli/bin'), { recursive: true });
  const builder = join(root, 'builder.cjs');
  const orphan = duringShutdown ? `const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"],
      {stdio:['ignore','ignore','ignore','ipc']});
    child.on('message',()=>console.log(JSON.stringify({remainingDescendant:child.pid})));
    process.on('SIGTERM',()=>process.exit(0));` : `const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
    console.log(JSON.stringify({remainingDescendant:child.pid}));child.unref();`;
  await writeFile(join(root, 'packages/cli/bin/quotern.js'), serviceDescendant
    ? `import {createRequire} from 'node:module';const require=createRequire(import.meta.url);${orphan}`
    : 'setTimeout(() => process.exit(0), 200);');
  await writeFile(builder, serviceDescendant ? 'process.exit(0);'
    : orphan + (ending === 'signalled build' ? "setTimeout(()=>process.kill(process.pid,'SIGTERM'),50);" : ''));
  supervisor = spawn(process.execPath, [join(root, 'scripts/dev.mjs'), 'api'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, npm_execpath: builder, VITE_CLI_API_ORIGIN: '',
      QUOTERN_DEV_API_PORT: undefined, QUOTERN_DEV_UI_PORT: undefined, QUOTERN_DEV_DESKTOP_PORT: undefined },
  });
  let output = '';
  for (const stream of [supervisor.stdout, supervisor.stderr]) stream.on('data', data => {
    output += data;
    const match = output.match(/"remainingDescendant":(\d+)/);
    if (match) grandchildPid = Number(match[1]);
  });
  if (duringShutdown) {
    await until(() => grandchildPid, 'fixture descendant ready');
    supervisor.send({ type: 'quotern-dev-stop' });
  }
  await once(supervisor, 'exit');
  assert.equal(supervisor.exitCode, 1, output);
  assert.ok(grandchildPid && alive(grandchildPid));
  const record = JSON.parse(await readFile(join(root, '.quotern-dev/api.json'), 'utf8'));
  assert.equal(record.status, 'cleanup-required');
  assert.equal(record.processTracker.kind, 'posix-pgroups-v1');
  if (ending !== 'signalled build') assert.ok(record.children.every(child => child.name !== 'build'));
  await assert.rejects(createDevSession(root, 'api', {}), /进程组/);
  assert.ok(alive(grandchildPid), 'recovery never signals the remaining descendant');
  process.kill(grandchildPid, 'SIGKILL');
  grandchildPid = undefined;
  const journal = JSON.parse(await readFile(join(root, `.quotern-dev/process-groups/${record.sessionId}.json`), 'utf8'));
  await until(() => journal.pgids.every(pgid => !alive(-pgid)), 'all recorded groups exited');
  const recovered = await createDevSession(root, 'api', {});
  assert.notEqual(recovered.record.sessionId, record.sessionId);
  await recovered.close();
});
}

test('POSIX spawn journal commit failure keeps locks even after the spawned group is cleaned', {
  skip: process.platform === 'win32', timeout: 20000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-posix-journal-failure-'));
  let supervisor;
  let spawnedPid;
  t.after(async () => {
    if (supervisor && supervisor.exitCode == null && supervisor.signalCode == null) {
      supervisor.kill();
      await once(supervisor, 'exit');
    }
    if (spawnedPid && alive(-spawnedPid)) process.kill(-spawnedPid, 'SIGTERM');
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'scripts'));
  for (const file of ['dev.mjs', 'dev-instance.mjs', 'dev-processes.mjs', 'dev-windows-job.mjs', 'dev-windows-job.ps1', 'dev-windows-job-host.mjs']) {
    await cp(join(source, 'scripts', file), join(root, 'scripts', file));
  }
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  const builder = join(root, 'builder.cjs');
  await writeFile(builder, 'setTimeout(() => {}, 10000);');
  const fault = join(root, 'fault.cjs');
  await writeFile(fault, `const fs=require('node:fs');const rename=fs.renameSync;
    fs.renameSync=function(from,to){
      if(to.includes('/process-groups/')){
        const proof=JSON.parse(fs.readFileSync(from,'utf8'));
        if(!proof.pendingSpawn&&proof.pgids.length){
          console.error(JSON.stringify({spawnedPid:proof.pgids.at(-1)}));
          throw new Error('fixture journal commit failed');
        }
      }
      return rename.call(this,from,to);
    };require('node:module').syncBuiltinESMExports();`);
  supervisor = spawn(process.execPath, ['--require', fault, join(root, 'scripts/dev.mjs'), 'api'], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, npm_execpath: builder, VITE_CLI_API_ORIGIN: '',
      QUOTERN_DEV_API_PORT: undefined, QUOTERN_DEV_UI_PORT: undefined, QUOTERN_DEV_DESKTOP_PORT: undefined },
  });
  let output = '';
  for (const stream of [supervisor.stdout, supervisor.stderr]) stream.on('data', data => {
    output += data;
    const match = output.match(/"spawnedPid":(\d+)/);
    if (match) spawnedPid = Number(match[1]);
  });
  await once(supervisor, 'exit');
  assert.equal(supervisor.exitCode, 1, output);
  assert.ok(spawnedPid);
  assert.equal(alive(-spawnedPid), false);
  const record = JSON.parse(await readFile(join(root, '.quotern-dev/api.json'), 'utf8'));
  assert.equal(record.status, 'cleanup-required');
  const proof = JSON.parse(await readFile(join(root, `.quotern-dev/process-groups/${record.sessionId}.json`), 'utf8'));
  assert.equal(proof.pendingSpawn, true);
  await assert.rejects(createDevSession(root, 'api', {}), /进程组/);
  assert.equal(JSON.parse(await readFile(join(root, '.quotern-dev/runtime.lock/owner.json'), 'utf8')).sessionId, record.sessionId);
});

test('Windows Job refuses live detached descendants and permits recovery only after its process tree ends', {
  skip: process.platform !== 'win32', timeout: 20000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-dev-orphan-'));
  let grandchildPid;
  let unrelatedPid;
  let supervisor;
  t.after(async () => {
    if (supervisor?.connected) supervisor.send({ type: 'quotern-dev-stop' });
    if (grandchildPid) {
      const killer = spawn('taskkill.exe', ['/PID', String(grandchildPid), '/F'], { windowsHide: true, stdio: 'ignore' });
      await new Promise((resolve) => killer.once('exit', resolve));
    }
    if (unrelatedPid && alive(unrelatedPid)) process.kill(unrelatedPid);
    await guardianExited(root, 'api');
    await rm(root, { recursive: true, force: true });
  });
  const runner = `
    import { spawn } from 'node:child_process';
    import { once } from 'node:events';
    import { createDevSession } from ${JSON.stringify(new URL('./dev-instance.mjs', import.meta.url).href)};
    import { startWindowsJob } from ${JSON.stringify(new URL('./dev-windows-job.mjs', import.meta.url).href)};
    const session = await createDevSession(process.argv[1], 'api', {});
    const job = await startWindowsJob(session);
    const child = spawn(process.execPath, ['-e', \`const {spawn}=require('node:child_process');
      const orphan=spawn(process.execPath,['-e','setInterval(() => {},1000)'],{stdio:'ignore',detached:true,windowsHide:true});
      console.log(orphan.pid);orphan.unref();setTimeout(()=>process.exit(0),100);\`], {
      detached: true, windowsHide: true, stdio: ['ignore','pipe','pipe'],
    });
    let output=''; child.stdout.on('data',data=>output+=data);
    await once(child,'exit');
    await session.update({status:'cleanup-required',children:[{name:'fixture-parent',pid:child.pid}]});
    console.log(JSON.stringify({fixtureGrandchild:Number(output.trim()),childrenEnded:await job.childrenEnded(100)}));
    process.on('message',()=>process.exit(0));
  `;
  supervisor = spawn(process.execPath, ['--input-type=module', '-e', runner, root], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  let output = '';
  let childrenEnded;
  supervisor.stdout.on('data', (data) => {
    output += data;
    const match = output.match(/"fixtureGrandchild":(\d+)/);
    if (match) grandchildPid = Number(match[1]);
    if (match) childrenEnded = JSON.parse(output.trim()).childrenEnded;
  });
  supervisor.stderr.resume();
  await until(() => grandchildPid, 'tracked detached orphan ready', 10000);
  assert.equal(childrenEnded, false);
  assert.doesNotThrow(() => process.kill(grandchildPid, 0));
  const unrelatedParent = spawn(process.execPath, ['-e', `const {spawn}=require('node:child_process');
    const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore',windowsHide:true,detached:true});
    console.log(child.pid);child.unref();setTimeout(()=>process.exit(0),100);`], {
    detached: true, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let unrelatedOutput = '';
  unrelatedParent.stdout.on('data', (data) => { unrelatedOutput += data; });
  await once(unrelatedParent, 'exit');
  unrelatedPid = Number(unrelatedOutput.trim());
  assert.ok(unrelatedPid && alive(unrelatedPid));
  const record = JSON.parse(await readFile(join(root, '.quotern-dev/api.json'), 'utf8'));
  await assert.rejects(readFile(join(root, `.quotern-dev/jobs/${record.sessionId}.json`)), { code: 'ENOENT' });
  supervisor.kill('SIGKILL');
  await until(() => supervisor.exitCode != null || supervisor.signalCode != null, 'supervisor killed', 10000);
  assert.ok(grandchildPid);
  assert.equal(record.status, 'cleanup-required');
  const lease = JSON.parse(await readFile(join(root, '.quotern-dev/runtime.lock/owner.json'), 'utf8'));
  assert.equal(lease.sessionId, record.sessionId);
  // Some Node/libuv versions also kill descendants through an outer Job when
  // their supervisor exits. The observer must handle either OS outcome.
  if (alive(grandchildPid)) {
    await assert.rejects(createDevSession(root, 'api', {}), /后代|子进程|Job/);
    assert.equal(JSON.parse(await readFile(join(root, '.quotern-dev/runtime.lock/owner.json'), 'utf8')).sessionId, record.sessionId);
    process.kill(grandchildPid);
  }
  grandchildPid = undefined;
  await until(async () => {
    try { return JSON.parse(await readFile(join(root, `.quotern-dev/jobs/${record.sessionId}.json`), 'utf8')).status === 'ended'; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }, 'Job empty receipt');
  await guardianExited(root, 'api');
  const recovered = await createDevSession(root, 'api', {});
  assert.notEqual(recovered.record.sessionId, record.sessionId);
  assert.ok(alive(unrelatedPid), 'unrelated orphan was neither blocked on nor stopped');
  await recovered.close();
});

test('losing the Windows Job observer never authorizes stale lock recovery', {
  skip: process.platform !== 'win32', timeout: 20000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-job-observer-loss-'));
  const runner = `
    import { createDevSession } from ${JSON.stringify(new URL('./dev-instance.mjs', import.meta.url).href)};
    import { startWindowsJob } from ${JSON.stringify(new URL('./dev-windows-job.mjs', import.meta.url).href)};
    const session=await createDevSession(process.argv[1],'api',{});
    await startWindowsJob(session);
    process.on('message',()=>{});
    process.send(session.record);
  `;
  const supervisor = spawn(process.execPath, ['--input-type=module', '-e', runner, root], {
    windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  supervisor.stderr.resume();
  let guardianPid;
  t.after(async () => {
    if (supervisor.exitCode == null && supervisor.signalCode == null) { supervisor.kill('SIGKILL'); await once(supervisor, 'exit'); }
    if (guardianPid && alive(guardianPid)) process.kill(guardianPid);
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const [record] = await once(supervisor, 'message', { signal: AbortSignal.timeout(10000) });
  guardianPid = record.processTracker.guardianPid;
  process.kill(guardianPid);
  await until(() => !alive(guardianPid), 'observer terminated');
  supervisor.kill('SIGKILL');
  await once(supervisor, 'exit');
  await assert.rejects(readFile(join(root, `.quotern-dev/jobs/${record.sessionId}.json`)), { code: 'ENOENT' });
  await assert.rejects(createDevSession(root, 'api', {}), /监视进程异常|退出凭据/);
  assert.equal(JSON.parse(await readFile(join(root, '.quotern-dev/runtime.lock/owner.json'), 'utf8')).sessionId, record.sessionId);
});

test('stopping during Windows Job setup cannot start a build after releasing ownership', {
  skip: process.platform !== 'win32', timeout: 20000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-job-stop-setup-'));
  await mkdir(join(root, 'scripts'));
  for (const file of ['dev.mjs', 'dev-instance.mjs', 'dev-processes.mjs', 'dev-windows-job.mjs', 'dev-windows-job.ps1', 'dev-windows-job-host.mjs']) {
    await cp(join(source, 'scripts', file), join(root, 'scripts', file));
  }
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  const builder = join(root, 'builder.cjs');
  const marker = join(root, 'build-started');
  await writeFile(builder, `require('node:fs').writeFileSync(${JSON.stringify(marker)},'unexpected build')`);
  const supervisor = spawn(process.execPath, [join(root, 'scripts/dev.mjs'), 'api'], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, npm_execpath: builder },
  });
  let stderr = '';
  supervisor.stderr.on('data', (data) => { stderr += data; });
  t.after(async () => {
    if (supervisor.exitCode == null && supervisor.signalCode == null) { supervisor.kill('SIGKILL'); await once(supervisor, 'exit'); }
    await guardianExited(root, 'api');
    await rm(root, { recursive: true, force: true });
  });
  await until(async () => {
    try { return JSON.parse(await readFile(join(root, '.quotern-dev/api.json'), 'utf8')).processTracker; }
    catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }, 'Job setup persisted');
  supervisor.send({ type: 'quotern-dev-stop' });
  await once(supervisor, 'exit', { signal: AbortSignal.timeout(10000) });
  assert.equal(supervisor.exitCode, 0, stderr);
  await assert.rejects(readFile(marker), { code: 'ENOENT' });
  await assert.rejects(readFile(join(root, '.quotern-dev/runtime.lock/owner.json')), { code: 'ENOENT' });
});
