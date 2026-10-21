// Windows helper renderer smoke test. Does not start the normal Quotern collector.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DshPetRpcServer } from '../src/main/dsh-pet/rpc';
import { DshPetConfigStore } from '../src/main/dsh-pet/config-store';
import { DshPetAssetStore } from '../src/main/dsh-pet/asset-store';
import { DshPetService } from '../src/main/dsh-pet/service';

async function main() {
  const [executable, runtimeRoot, output, appPath] = process.argv.slice(2);
  assert.ok(executable && runtimeRoot && output, 'exe runtimeRoot output [developmentAppPath]');
  const directory = path.resolve(output!); await mkdir(directory, { recursive: true });
  const root = path.join(directory, 'host');
  const config = new DshPetConfigStore(root, path.resolve(runtimeRoot!));
  const original = config.read().main!;
  await config.patchMain({ notificationsEnabled: false, pets: [
    { ...(original.pets as object[])[0], size: 280 },
  ] });
  const assets = new DshPetAssetStore(root, path.resolve(runtimeRoot!));
  const service = new DshPetService({ config, assets, getQuota: () => null, quotaSource: () => null, reload: async () => {}, showMainWindow: () => {} });
  const pipe = new DshPetRpcServer(); const routes = new Set<string>(); let polls = 0;
  const address = await pipe.start(async (request, signal) => { routes.add(request.url); if (request.url.endsWith('/state') && ++polls === 2) setTimeout(() => { void service.handle({ id: 100, method: 'POST', url: '/dsh-pet-7340/broadcast?pet=main', body: '{"text":"Smoke bubble"}' }); }, 100); return service.handle(request, signal); });
  const env = { ...process.env, DSH_PET_BRIDGE: '1', DSH_PET_CONFIG_URL: 'http://quotern.invalid/dsh-pet-7340/config', DSH_PET_HOST_PID: String(process.pid), DSH_PET_PIPE: address.endpoint, DSH_PET_TOKEN: address.token, DSH_PET_PETS: JSON.stringify(config.vendor.flattenPetList(config.read())), DSH_PET_SMOKE: '1', DSH_PET_SMOKE_OUT: path.join(directory, 'helper.png'), DSH_PET_SMOKE_AFTER_MS: '9000', QUOTERN_DSH_USER_DATA: path.join(directory, 'helper-profile'), QUOTERN_DSH_APP_PATH: appPath ? path.resolve(appPath) : '' };
  delete (env as NodeJS.ProcessEnv).ELECTRON_RUN_AS_NODE;
  const child = spawn(path.resolve(executable!), [...(appPath ? [path.resolve(appPath)] : []), '--quotern-dsh-pet-helper'], { env, windowsHide: true, cwd: path.join(path.resolve(runtimeRoot!), 'runtime'), stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = ''; child.stdout.on('data', chunk => { stdout += String(chunk); }); child.stderr.on('data', chunk => { stderr += String(chunk); });
  const timeout = setTimeout(() => child.kill(), 45_000);
  let code: number | null = null;
  try {
    code = await new Promise<number | null>((resolve, reject) => { child.once('exit', resolve); child.once('error', reject); });
    await writeFile(path.join(directory, 'stdout.log'), stdout); await writeFile(path.join(directory, 'stderr.log'), stderr);
    assert.equal(code, 0, stderr);
    const line = stdout.split('\n').find(line => line.includes('smoke dump:'));
    assert.ok(line, `No renderer dump: ${stderr}`); const dump = JSON.parse(line.split(' => ')[1]!) as Record<string, any>;
    assert.equal(dump.hasBridge, true); assert.equal(dump.errorVisible, false); assert.equal(dump.sprites, 1); assert.equal(dump.menuSmoke.menuMounted, true); assert.equal(dump.menuSmoke.errsNew, 0); assert.equal(dump.releaseKeptPosition.kept, true); assert.equal(dump.interactiveFlip.inside, true); assert.equal(dump.interactiveFlip.outside, true); assert.equal(dump.interactiveFlip.duringDragForced, true);
    assert.match(stdout, /interactiveIgnoring":false,"passthroughIgnoring":true/);
    assert.match(stdout, /windows=1/); assert.ok(dump.videoSrcA.startsWith('dsh-pet-bridge:'));
    const names = config.vendor.animationNames(original.animations); for (const name of names) assert.ok(await assets.resolve(`/thumb/main/${encodeURIComponent(name)}.webm`));
    await writeFile(path.join(directory, 'result.json'), JSON.stringify({ code, animationsResolved: names.length, routes: [...routes], dump }, null, 2));
    console.log(JSON.stringify({ ok: true, windows: 1, animationsResolved: names.length, directory }));
  } finally { clearTimeout(timeout); service.dispose(); await pipe.close(); if (child.exitCode === null) child.kill(); }
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
