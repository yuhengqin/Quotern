import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { networkInterfaces, tmpdir } from 'node:os';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const source = join(dirname(fileURLToPath(import.meta.url)), '..');
const lanHost = Object.values(networkInterfaces()).flat().find(address => address.family === 'IPv4' && !address.internal)?.address;
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
  t.after(async () => { await stop(); await rm(root, { recursive: true, force: true }); });
  await mkdir(join(root, 'scripts'));
  await cp(join(source, 'scripts/dev.mjs'), join(root, 'scripts/dev.mjs'));
  await cp(join(source, 'scripts/dev-instance.mjs'), join(root, 'scripts/dev-instance.mjs'));
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
  let child;
  t.after(async () => {
    if (child && child.exitCode == null && child.signalCode == null) {
      child.kill('SIGTERM');
      await until(() => child.exitCode != null || child.signalCode != null, 'renderer cleanup', 10000);
    }
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'src/renderer/routes'), { recursive: true });
  await cp(join(source, 'apps/desktop/electron.vite.config.ts'), join(root, 'electron.vite.config.ts'));
  await writeFile(join(root, 'package.json'), '{"name":"fixture-renderer","version":"0.0.0","type":"module"}');
  await writeFile(join(root, 'src/renderer/index.html'), '<!doctype html><html><body>isolated renderer fixture</body></html>');
  await writeFile(join(root, 'src/renderer/routes/__root.tsx'), 'import { createRootRoute } from "@tanstack/react-router"; export const Route = createRootRoute();');
  await symlink(join(source, 'apps/desktop/node_modules'), join(root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(join(root, 'serve.mjs'), `
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
  child = spawn(process.execPath, [join(root, 'serve.mjs')], {
    cwd: root, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
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

test('a Windows service parent that exits early cannot release ownership of possibly live descendants', {
  skip: process.platform !== 'win32', timeout: 20000,
}, async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-dev-orphan-'));
  let grandchildPid;
  let supervisor;
  t.after(async () => {
    if (supervisor?.connected) supervisor.send({ type: 'quotern-dev-stop' });
    if (grandchildPid) {
      const killer = spawn('taskkill.exe', ['/PID', String(grandchildPid), '/F'], { windowsHide: true, stdio: 'ignore' });
      await new Promise((resolve) => killer.once('exit', resolve));
    }
    await rm(root, { recursive: true, force: true });
  });
  await mkdir(join(root, 'scripts'));
  await mkdir(join(root, 'packages/cli/bin'), { recursive: true });
  for (const file of ['dev.mjs', 'dev-instance.mjs']) await cp(join(source, 'scripts', file), join(root, 'scripts', file));
  await writeFile(join(root, 'package.json'), '{"type":"module"}');
  const builder = join(root, 'builder.cjs');
  await writeFile(builder, 'process.exit(0)');
  await writeFile(join(root, 'packages/cli/bin/quotern.js'), `
    import { spawn } from 'node:child_process';
    const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', windowsHide: true });
    console.log(JSON.stringify({ fixtureGrandchild: child.pid }));
    setTimeout(() => process.exit(0), 100);
  `);
  supervisor = spawn(process.execPath, [join(root, 'scripts/dev.mjs'), 'api'], {
    windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'], env: { ...process.env, npm_execpath: builder },
  });
  let output = '';
  supervisor.stdout.on('data', (data) => {
    output += data;
    const match = output.match(/"fixtureGrandchild":(\d+)/);
    if (match) grandchildPid = Number(match[1]);
  });
  supervisor.stderr.resume();
  await until(() => supervisor.exitCode != null, 'early service exit', 10000);
  assert.ok(grandchildPid);
  const record = JSON.parse(await readFile(join(root, '.quotern-dev/api.json'), 'utf8'));
  assert.equal(record.status, 'cleanup-required');
  const lease = JSON.parse(await readFile(join(root, '.quotern-dev/runtime.lock/owner.json'), 'utf8'));
  assert.equal(lease.sessionId, record.sessionId);
});
