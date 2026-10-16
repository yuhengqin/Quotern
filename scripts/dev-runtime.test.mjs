import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createDevSession } from './dev-instance.mjs';
import { once } from 'node:events';

const source = join(dirname(fileURLToPath(import.meta.url)), '..');
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
async function start(t) {
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
async function configAt(port) {
  const response = await fetch(`http://127.0.0.1:${port}/functions/tud-config`, { signal: AbortSignal.timeout(2000) });
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
  }
  await a.stop();
  assert.equal((await configAt(b.config.uiPort)).deviceId, apiB.deviceId);
  assert.equal((await configAt(b.config.apiPort)).deviceId, apiB.deviceId);
  const stopped = JSON.parse(await readFile(join(a.root, '.quotern-dev/cli.json'), 'utf8'));
  assert.equal(stopped.status, 'stopped');
  assert.equal(stopped.exitCode, 0);
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
