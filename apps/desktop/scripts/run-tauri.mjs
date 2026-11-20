import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getNodeTarget, hostNodeTriple, prepareTauriNode } from './prepare-tauri-node.mjs';

const desktop = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);
const pkgBin = (name, bin) => join(dirname(require.resolve(name+'/package.json')), require(name+'/package.json').bin[bin]);
let child;
const stop = () => child?.kill('SIGTERM');
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
async function run(exe, args, env = process.env) {
  child = spawn(exe, args, {cwd:desktop, env, stdio:'inherit', windowsHide:true});
  const [code, signal] = await once(child,'exit');
  child = undefined;
  if (code !== 0) throw Error(`${exe} exited with ${signal ?? code}`);
}
const [mode = 'dev', ...options] = process.argv.slice(2);
const targetIndex = options.indexOf('--target');
const target = getNodeTarget(targetIndex < 0 ? hostNodeTriple() : options[targetIndex+1]);
const env = { ...process.env, TAURI_ENV_PLATFORM: target.os === 'win' ? 'windows' : target.os === 'darwin' ? 'macos' : target.os, QUOTERN_TARGET_ARCH: target.arch };

try {
  if (!['build','bundle','dev','start'].includes(mode)) throw Error('Unknown Tauri command: '+mode);
  if (mode === 'start') {
    const dir = resolve(desktop, process.env.CARGO_TARGET_DIR || 'src-tauri/target');
    const executable = join(dir, 'release', process.platform === 'win32' ? 'Quotern.exe' : 'Quotern');
    if (!existsSync(executable)) await run(process.execPath, [fileURLToPath(import.meta.url), 'build'], env);
    await run(executable, []);
  } else {
    await prepareTauriNode(target.triple);
    await run(process.execPath,['scripts/prepare-tauri-pet.mjs'],env);
    await run(process.execPath, ['scripts/build-sidecar.mjs'], env);
    const cli = pkgBin('@tauri-apps/cli','tauri');
    if (mode === 'dev') {
      if (env.QUOTERN_DEV_QUOTA_PREVIEW === '1') {
        const {resolveQuotaPreviewConfig} = await import('../src/shared/quota-preview.ts');
        const preview = resolveQuotaPreviewConfig(env, false);
        const health = await fetch(new URL('/__quota_mock_health__', preview.url), {signal:AbortSignal.timeout(5000),redirect:'error'});
        const identity = health.ok && await health.json();
        if (identity?.kind !== 'quota-mock' || typeof identity.checkout !== 'string' || resolve(identity.checkout) !== resolve(desktop,'../..')) {
          throw Error('请先启动当前工作区的额度 mock 服务');
        }
        env.QUOTERN_DESKTOP_USER_DATA = preview.userData;
        const config = {build:{devUrl:preview.url}};
        await run(process.execPath,[cli,'dev','--config',JSON.stringify(config),...options],env);
        process.exit(0);
      }
      const port = Number(env.QUOTERN_DEV_DESKTOP_PORT || 5195);
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid desktop development port');
      const config = { build:{devUrl:'http://127.0.0.1:'+port, beforeDevCommand:'corepack pnpm exec vite --config vite.config.ts'} };
      await run(process.execPath,[cli,'dev','--config',JSON.stringify(config),...options],env);
    } else {
      await run(process.execPath,[pkgBin('vite','vite'),'build','--config','vite.config.ts'],env);
      await run(process.execPath,[cli,'build',...(mode==='build'?['--no-bundle']:[]),...options],env);
    }
  }
} catch (error) { console.error(error.message); process.exitCode=1; }
