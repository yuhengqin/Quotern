// Opt-in Windows acceptance: real helper, videos, pipe and pointer input; fresh private data, no collector/model.
// Bundle with esbuild (external:electron), run electron <bundle> <out/dsh-pet> <new-output-dir> <apps/desktop>.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import { DshPetController } from '../src/main/dsh-pet/controller';
// @ts-ignore opt-in JS acceptance driver
import { connectPage, unusedPort, wait } from './desktop-cdp.mjs';

const [runtime, output, desktop] = process.argv.slice(2);
assert.ok(runtime && output && desktop);
const directory = path.resolve(output!);
assert.equal(existsSync(directory), false, 'acceptance output must be fresh');
app.setPath('userData', path.join(directory, 'profile'));

async function main() {
  await mkdir(directory, { recursive: true });
  const port = await unusedPort(), checks: string[] = [];
  let stderr = '', page: Awaited<ReturnType<typeof connectPage>> | undefined;
  const controller = new DshPetController({
    root: path.join(directory, 'host'), runtimeRoot: path.resolve(runtime!), executable: process.execPath,
    appPath: path.resolve(desktop!), packaged: false, roots: [],
    getQuota: () => null, showMainWindow() {}, openDirectory: async () => {},
    spawn: (exe, args, options) => { const child = spawn(exe, [...args, `--remote-debugging-port=${port}`], options); child.stderr?.on('data', chunk => { stderr += chunk; }); return child; },
  });
  const call = async (method: 'GET' | 'POST', route: string, body?: unknown) => {
    const result = await controller.dispatch({ type: 'request', method, path: route, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }) as { status: number; body: string };
    return JSON.parse(result.body);
  };
  const until = async (predicate: () => boolean | Promise<boolean>, label: string) => {
    for (let i = 0; i < 180; i++) { if (await predicate()) return; await wait(100); }
    throw Error('Timed out: ' + label + '; ' + stderr);
  };
  try {
    const pet = (controller.getState().config.main!.pets as object[])[0]!;
    await controller.dispatch({ type: 'patch-config', patch: { notificationsEnabled: false, pets: [{ ...pet, size: 180, display: 'desktop', balanceEnabled: false, fixedEnabled: true }] } });
    await controller.dispatch({ type: 'set-enabled', enabled: true });
    await until(async () => {
      try { const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const target = targets.find((value: { type: string }) => value.type === 'page'); if (!target) return false; page = await connectPage(target); return true; } catch { return false; }
    }, 'helper renderer');
    const client = page!;
    await until(() => client.evaluate('Boolean(window.__dshPetDebug?.configOk && sprites[0])'), 'pet ready');
    await client.evaluate("window.probeReports=[]; const probeFetch=window.fetch; window.fetch=(url,options)=>{if(String(url).includes('/report')) window.probeReports.push({url:String(url),body:options?.body}); return probeFetch(url,options);}; true");
    await client.evaluate('for (const video of [sprites[0].videoA,sprites[0].videoB]) {video.defaultPlaybackRate=8;video.playbackRate=8;} true');
    const name = await client.evaluate('sprites[0].animations.clicks[0] || sprites[0].animations.idle[0]');
    const lock = await call('POST', '/lock?pet=main', { ttl: 30_000 }); assert.equal(lock.ok, true);
    await until(() => client.evaluate('sprites[0].frozen === true && sprites[0].videoA.paused && sprites[0].videoB.paused'), 'freeze video');
    checks.push('lock-freezes-real-videos');
    assert.equal((await call('POST', '/position?pet=main', { x: .5, y: .5, mode: 'instant' })).reason, 'lock-required');
    const query = `pet=main&lock=${lock.lockId}`;
    const accepted = await call('POST', '/anim?' + query, { name, facing: 'right' });
    assert.equal(typeof accepted.playbackId, 'string');
    const finished = await call('GET', `/playback/${accepted.playbackId}?wait=ended,failed,cancelled&timeout=10000`);
    if (finished.status !== 'ended') console.error('Video diagnostic', await client.evaluate('JSON.stringify({frozen:sprites[0].frozen,gen:sprites[0].gen,receipt:sprites[0].controlPlayback,videos:[sprites[0].videoA,sprites[0].videoB].map(v=>({duration:v.duration,time:v.currentTime,paused:v.paused,loop:v.loop,rate:v.playbackRate,ready:v.readyState,error:v.error?.message}))})'));
    assert.equal(finished.status, 'ended', JSON.stringify(finished)); checks.push('real-video-ended-receipt-over-pipe');
    const before = await call('POST', '/anim?' + query, { name });
    const after = await call('POST', '/anim?' + query, { name });
    assert.equal((await call('GET', '/playback/' + before.playbackId)).status, 'cancelled');
    const afterResult = await call('GET', `/playback/${after.playbackId}?wait=ended,failed,cancelled&timeout=10000`);
    assert.equal(afterResult.status, 'ended', JSON.stringify(afterResult) + await client.evaluate('JSON.stringify(window.probeReports)'));
    checks.push('replacement-cancels-old-receipt');
    await client.evaluate("sprites[0].savedAssetBase= sprites[0].assetBase; sprites[0].assetBase += 'missing-'; true");
    const broken = await call('POST', '/anim?' + query, { name });
    const failed = await call('GET', `/playback/${broken.playbackId}?wait=ended,failed,cancelled&timeout=10000`);
    assert.equal(failed.status, 'failed', JSON.stringify(failed) + await client.evaluate('JSON.stringify(window.probeReports)'));
    await client.evaluate('sprites[0].assetBase=sprites[0].savedAssetBase; true'); checks.push('real-missing-video-failed-receipt');
    for (const mode of ['instant', 'line', 'spring']) {
      const x = mode === 'line' ? .7 : .3;
      assert.equal((await call('POST', '/position?' + query, { x, y: .45, mode, duration: 200 })).ok, true);
      await until(() => client.evaluate(`Math.abs((sprites[0].pos.x+sprites[0].halfW)/VIEW.w-${x}) < .01 && Math.abs((sprites[0].pos.y+sprites[0].halfH)/VIEW.h-.45)<.01`), 'position ' + mode);
      checks.push('real-position:' + mode);
    }
    await call('POST', '/throw?' + query, { angle: 90, power: 1 });
    await until(() => client.evaluate('sprites[0].throwRef !== null && sprites[0].throwState.vy < 0'), 'native upward throw');
    await client.evaluate('sprites[0].stopThrow(); true'); checks.push('native-throw-physics');
    await client.click('document.querySelector(".pet-hit")');
    await until(async () => (await call('POST', '/lock?pet=main', { lockId: lock.lockId })).cause === 'preempted', 'pointer takes lock');
    checks.push('real-pointer-input-preempts-lock');
    const expiring = await call('POST', '/lock?pet=main', { ttl: 2500 });
    await until(() => client.evaluate('sprites[0].frozen === true'), 'short lock active');
    await until(() => client.evaluate('sprites[0].frozen === false'), 'automatic lock expiration');
    assert.equal((await call('POST', '/throw?pet=main&lock=' + expiring.lockId, { angle: 0, power: 1 })).cause, 'expired');
    checks.push('renderer-unfreezes-on-expiration');
    await client.screenshot(path.join(directory, 'helper.png'));
    assert.equal(client.errors.length, 0, JSON.stringify(client.errors));
    await writeFile(path.join(directory, 'result.json'), JSON.stringify({ ok: true, checks }, null, 2));
    console.log(JSON.stringify({ ok: true, checks }));
  } finally { page?.close(); await controller.dispose(); await writeFile(path.join(directory, 'stderr.log'), stderr); }
}
const deadline = setTimeout(() => app.exit(2), 100_000);
void app.whenReady().then(main).then(() => { clearTimeout(deadline); app.exit(0); }, error => { clearTimeout(deadline); console.error(error); app.exit(1); });
