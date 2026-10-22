import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { withoutPetChat } from './patch-dsh-pet-features.mjs';
import { patchDshPetPointer } from './patch-dsh-pet-pointer.mjs';
import { patchDshPetMotion } from './patch-dsh-pet-motion.mjs';

const desktopRoot = fileURLToPath(new URL('../', import.meta.url));
const hostModules = ['config', 'state', 'work-status', 'notify-events', 'anim', 'broadcast'];

/** Build only the checked-in snapshot. No reference checkout, network or user data. */
export async function prepareDshPet({ vendorRoot = path.join(desktopRoot, 'vendor/dsh-pet'), outputRoot = path.join(desktopRoot, 'out/dsh-pet') } = {}) {
  const vendor = vendorRoot instanceof URL ? fileURLToPath(vendorRoot) : path.resolve(vendorRoot);
  const output = path.resolve(outputRoot);
  if (output === vendor || output.startsWith(`${vendor}${path.sep}`)) throw new Error('output must be outside vendor snapshot');
  const manifest = JSON.parse(await readFile(path.join(vendor, 'UPSTREAM.json'), 'utf8'));
  if (manifest.commit !== '6c5f04321be050525b5cbb7bb8ee5f53e89deb6f') throw new Error('unsupported upstream snapshot');
  for (const entry of manifest.files) {
    if (typeof entry.path !== 'string' || entry.path.includes('..') || path.isAbsolute(entry.path)) throw new Error('invalid integrity path');
    const data = await readFile(path.join(vendor, entry.path));
    if (data.byteLength !== entry.bytes || createHash('sha256').update(data).digest('hex') !== entry.sha256) {
      throw new Error(`dsh-pet integrity hash mismatch: ${entry.path}`);
    }
  }
  await mkdir(path.join(output, 'runtime'), { recursive: true });
  for (const entry of manifest.files) {
    const relative = entry.path.startsWith('runtime/electron-helper/')
      ? entry.path.replace('runtime/electron-helper/', 'runtime/')
      : entry.path.startsWith('assets/') ? entry.path : null;
    if (!relative) continue;
    await mkdir(path.dirname(path.join(output, relative)), { recursive: true });
    await cp(path.join(vendor, entry.path), path.join(output, relative));
  }
  await cp(path.join(vendor, 'LICENSE'), path.join(output, 'LICENSE'));
  await cp(path.join(vendor, 'PATCHES.md'), path.join(output, 'PATCHES.md'));
  await writeFile(path.join(output, 'MEDIA-LICENSE.md'), '# dsh-pet media\n\nSource: https://github.com/PC2005-cloud/dsh-pet\n\nCopyright (c) 2026 PC2005-cloud. Code is MIT (see LICENSE). Upstream animations, prompts and source videos allow open-source use and prohibit commercial use. Derived introductions, displays and distribution must credit and link to the upstream project. The unverified 上首软糖体 font is not included.\n');
  await cp(path.join(vendor, 'UPSTREAM.json'), path.join(output, 'UPSTREAM.json'));
  const config = (await readFile(path.join(vendor, 'assets/config.jsonc'), 'utf8'))
    .replace(/("family"\s*:\s*)"candy"/, '$1"system"')
    .replace(/("display"\s*:\s*)"both"/g, '$1"desktop"');
  await writeFile(path.join(output, 'assets/config.jsonc'), config);
  const runtimeFile = path.join(output, 'runtime/main.js');
  let helper = await readFile(runtimeFile, 'utf8');
  const replaceRequired = (source, from, to) => { if (!source.includes(from)) throw new Error('unsupported upstream helper patch'); return source.replace(from, to); };
  helper = replaceRequired(helper, "[__filename, '--dsh-pet-dpi-probe']", "[...(app.isPackaged ? [] : [process.env.QUOTERN_DSH_APP_PATH]), '--quotern-dsh-pet-helper', '--dsh-pet-dpi-probe']");
  helper = replaceRequired(helper, ".loadFile('index.html',", ".loadFile(path.join(__dirname, 'index.html'),");
  const bridgeStart = helper.indexOf('let bridgeSeq = 0;'), bridgeEnd = helper.indexOf('app.whenReady().then(() => {', bridgeStart);
  if (bridgeStart < 0 || bridgeEnd < bridgeStart) throw new Error('unsupported upstream bridge');
  helper = helper.slice(0, bridgeStart) + `const { connectHost, fileResponse } = require('./quotern-adapter.cjs');
let hostBridge;
async function startBridgeCallback() {
  hostBridge = connectHost(process.env.DSH_PET_PIPE, process.env.DSH_PET_TOKEN, exitForDeadHost);
  await hostBridge.ready;
  app.once('will-quit', () => hostBridge.close());
}
async function handleBridgeRequest(request) {
  const url = new URL(request.url);
  const resp = await hostBridge.request(request.method || 'GET', url.pathname + url.search, request.method === 'POST' ? await request.text() : undefined);
  if (resp.file) return fileResponse(resp.file, request.headers.get('range'), resp.contentType);
  return new Response(resp.body ?? '', {status: resp.status || 200, headers: {'access-control-allow-origin': '*', 'content-type': resp.contentType || 'application/json'}});
}

` + helper.slice(bridgeEnd);
  helper = replaceRequired(helper, 'app.whenReady().then(() => {', 'app.whenReady().then(async () => {');
  helper = replaceRequired(helper, '    startBridgeCallback();', "    try { await startBridgeCallback(); } catch { app.exit(2); return; }");
  // Only the upstream opt-in smoke path: establish clean input state and use a held button.
  helper = replaceRequired(helper, '              var r = d.hitRect;\n              var m = d.winMargin;', `              var before = {menuOpen: d.menuOpen, chatOpen: d.chatOpen, inputBusy: d.inputBusy};
              document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
              window.dispatchEvent(new PointerEvent('pointerup', {bubbles:true, pointerId:93}));
              var clean = {menuOpen: d.menuOpen, chatOpen: d.chatOpen, inputBusy: d.inputBusy};
              var r = d.hitRect;
              var m = d.winMargin;`);
  helper = replaceRequired(helper, '              var out = {};\n              window.dispatchEvent(new MouseEvent', '              var out = {before, clean};\n              window.dispatchEvent(new MouseEvent');
  helper = replaceRequired(helper, "new MouseEvent('mousemove', { clientX: xOut, clientY: yOut, screenX: xOut, screenY: yOut }));\n              out.duringDragForced", "new MouseEvent('mousemove', { buttons: 1, clientX: xOut, clientY: yOut, screenX: xOut, screenY: yOut }));\n              out.duringDragForced");
  helper = replaceRequired(helper, '              var during = { x: d.dragPos.x, y: d.dragPos.y };\n              await sleep(200);', '              await sleep(200);\n              var during = { x: d.dragPos.x, y: d.dragPos.y };');
  helper = replaceRequired(helper, '          pointerFallbackPaused = true;\n          await first.webContents.executeJavaScript', "          pointerFallbackPaused = true;\n          await first.webContents.executeJavaScript(\"document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape',bubbles:true})); window.dispatchEvent(new PointerEvent('pointerup',{bubbles:true})); true;\");\n          await new Promise(r => setTimeout(r, 80));\n          await first.webContents.executeJavaScript");
  const openStart = helper.indexOf('  const openSite = (url) => {'), openEnd = helper.indexOf('  // 显示器热更新', openStart);
  if (openStart < 0 || openEnd < openStart) throw new Error('unsupported upstream open-host');
  helper = helper.slice(0, openStart) + "  ipcMain.on('pet:open-host', () => { void hostBridge.request('POST', '/dsh-pet-7340/open-host').catch(() => {}); });\n\n" + helper.slice(openEnd);
  const preloadFile = path.join(output, 'runtime/preload.js');
  let preload = await readFile(preloadFile, 'utf8');
  preload = replaceRequired(preload, 'openDshSite(url)', 'openHost()');
  preload = replaceRequired(preload, "ipcRenderer.send('pet:open-site', { url });", "ipcRenderer.send('pet:open-host');");
  const spriteFile = path.join(output, 'runtime/sprite.js');
  let sprite = await readFile(spriteFile, 'utf8');
  sprite = replaceRequired(sprite, "OPEN_TARGET === 'desktop' ? '打开 DeepSeek Harness' : '打开网站'", "'打开 Quotern'");
  sprite = replaceRequired(sprite, 'window.petBridge.openDshSite(ORIGIN)', 'window.petBridge.openHost()');
  sprite = patchDshPetMotion(sprite);
  sprite = withoutPetChat(sprite);
  sprite = replaceRequired(sprite, "    tools.push({ label: '查看余额', action: 'show-balance' });", `    tools.push({ label: this.companionData?.labels?.sync || '立即同步', action: 'quotern-sync' });
    tools.push({ label: this.companionData?.labels?.settings || '宠物设置', action: 'quotern-settings' });
    tools.push({ label: '查看余额', action: 'show-balance' });`);
  ({ helper, preload, sprite } = patchDshPetPointer({ helper, preload, sprite }));
  helper = replaceRequired(helper, 'let hostBridge;', `let hostBridge;
require('./position-store.cjs').installPositionStore({ app, ipcMain, getWindow: id => windows.get(id) });`);
  preload = replaceRequired(preload, '  setInteractive(interactive) {', `  readCompanionPosition(id) { return ipcRenderer.sendSync('pet:read-companion-position', id); },
  saveCompanionPosition(id, state) { return ipcRenderer.sendSync('pet:save-companion-position', id, state); },
  setInteractive(interactive) {`);
  await writeFile(runtimeFile, helper);
  await writeFile(preloadFile, preload);
  await writeFile(spriteFile, sprite);
  await cp(path.join(desktopRoot, 'scripts/dsh-pet-controls-runtime.js'), path.join(output, 'runtime/controls.js'));
  await cp(path.join(desktopRoot, 'scripts/dsh-pet-interactions-runtime.js'), path.join(output, 'runtime/interactions.js'));
  await cp(path.join(desktopRoot, 'scripts/dsh-pet-position-store.cjs'), path.join(output, 'runtime/position-store.cjs'));
  const htmlFile = path.join(output, 'runtime/index.html');
  const html = await readFile(htmlFile, 'utf8');
  const interactionHtml = replaceRequired(html, '</style>', `.pet-bubble.is-companion-below::after { top: -5px; bottom: auto; border: 5px solid transparent; border-top: none; border-bottom-color: rgba(255,255,255,.92); }\n    </style>`);
  await writeFile(htmlFile, replaceRequired(interactionHtml, '<script src="./renderer.js"></script>', '<script src="./controls.js"></script>\n    <script src="./interactions.js"></script>\n    <script src="./renderer.js"></script>'));
  await build({ entryPoints: [path.join(desktopRoot, 'src/main/dsh-pet/helper-adapter.ts')], outfile: path.join(output, 'runtime/quotern-adapter.cjs'), bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'warning' });
  await build({ entryPoints: [path.join(vendor, 'src/shared/index.ts')], outfile: path.join(output, 'runtime/shared-core.js'), bundle: true, format: 'iife', globalName: 'PetShared', platform: 'browser', target: 'chrome134', logLevel: 'warning',
    plugins: [{ name: 'quotern-window-label', setup(bundle) {
      bundle.onLoad({ filter: /[/\\]src[/\\]shared[/\\]index\.ts$/ }, async args => ({ loader: 'ts', contents: (await readFile(args.path, 'utf8')).replace(/^export \* from '\.\/chat';.*$/m, '') }));
      bundle.onLoad({ filter: /[/\\]src[/\\]shared[/\\]balance\.ts$/ }, async args => {
        let contents = await readFile(args.path, 'utf8');
        for (const [from, to] of [
          ['monthly?: unknown;', 'monthly?: unknown; monthlyLabel?: unknown;'],
          ['monthly?: number;', 'monthly?: number; monthlyLabel?: string;'],
          ['      monthly,', '      monthly,\n      monthlyLabel: typeof d.monthlyLabel === "string" ? d.monthlyLabel : undefined,'],
          ['  return WINDOW_LABELS[w];', '  if (w === "monthly" && v.monthlyLabel) return v.monthlyLabel;\n  return WINDOW_LABELS[w];'],
        ]) { if (!contents.includes(from)) throw new Error('unsupported upstream balance renderer'); contents = contents.replace(from, to); }
        return { loader: 'ts', contents };
      });
    } }],
  });
  await build({
    stdin: { contents: hostModules.map(name => `export * from './${name}.ts';`).join('\n'), resolveDir: path.join(vendor, 'src/host'), loader: 'ts' },
    outfile: path.join(output, 'host.cjs'), bundle: true, format: 'cjs', platform: 'node', target: 'node22', logLevel: 'warning',
    plugins: [{ name: 'quotern-jsonc', setup(bundle) {
      bundle.onLoad({ filter: /[/\\]src[/\\]host[/\\]config\.ts$/ }, async args => {
        const original = await readFile(args.path, 'utf8');
        const patched = original.replace(/function stripJsonc\(src: string\): string \{[\s\S]*?\n\}/, 'function stripJsonc(src: string): string { return quoternStripJsonComments(src).trim(); }');
        if (original === patched) throw new Error('unsupported upstream JSONC parser');
        return { loader: 'ts', contents: `import { stripJsonComments as quoternStripJsonComments } from ${JSON.stringify(path.join(desktopRoot, 'src/main/dsh-pet/jsonc.ts'))};\n${patched}` };
      });
    } }],
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await prepareDshPet();
}
