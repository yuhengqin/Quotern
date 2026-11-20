import assert from 'node:assert/strict';
import { mkdir, readFile, rename, rmdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { wait } from './desktop-cdp.mjs';

export async function checkAppearanceMotion({ web, peer, native, popup, mainWindow, panel, settings, select, closeSettings, until, shot, output, openHidden }) {
  const { DECORATED_APPEARANCE_STYLES } = await import('../out/main/appearance-shared-test.mjs');
  const count = client => client.evaluate('document.querySelectorAll("[data-appearance-decoration]").length');
  const artStyle = client => client.evaluate('document.querySelector("[data-appearance-decoration]")?.dataset.appearanceDecoration');
  const systemMotion = await native.evaluate('({hidden:document.hidden,reduced:matchMedia("(prefers-reduced-motion: reduce)").matches})');
  const allowMotion = client => client.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  for (const client of [native, popup, web, peer]) await allowMotion(client);
  mainWindow.window.show();
  await native.call('Emulation.setDeviceMetricsOverride', { width: 320, height: 780, deviceScaleFactor: 1, mobile: false });
  const defaultScrollWidth = await native.evaluate('document.documentElement.scrollWidth');
  await native.call('Emulation.clearDeviceMetricsOverride');
  const toggle = async (client, on) => {
    if (await client.evaluate('document.querySelector("input[name=appearance-decorations]").checked') !== on) await client.click('document.querySelector(".appearance-motion-control .switch__control")');
    await until(() => client.evaluate(`document.querySelector('input[name=appearance-decorations]').checked === ${on}`), 'decoration switch');
  };
  const states = [];
  const baseline = mainWindow.window.listenerCount('hide');
  assert.equal(await count(native), 0, 'legacy preferences are static');
  await settings(native, true); await select(native, 'theme-preference', 'dark'); await select(native, 'appearance-style', 'matrix');
  assert.equal(await native.evaluate('document.querySelector("input[name=appearance-decorations]").checked'), false);
  await native.evaluate('document.querySelector("input[name=appearance-decorations]").focus(); true'); await native.key(' ');
  await until(() => native.evaluate('document.querySelector("input[name=appearance-decorations]").checked'), 'keyboard enables decoration switch');
  await native.click('document.querySelector(".appearance-motion-control .switch__control")'); await wait(150);
  if (await native.evaluate('document.querySelector("[data-appearance-more]").getAttribute("aria-expanded") === "true"')) {
    await native.click('document.querySelector("[data-appearance-more]")');
    await until(() => native.evaluate('document.querySelector("[data-appearance-more]").getAttribute("aria-expanded") === "false"'), 'gallery collapse for translated count');
  }
  const controls = await native.evaluate('({trackTogglesOff:!document.querySelector("input[name=appearance-decorations]").checked,translatedCount:document.querySelector("[data-appearance-more]").textContent.includes("17")})');
  assert.deepEqual(controls, { trackTogglesOff: true, translatedCount: true }, 'actual switch track click and translated catalogue count');
  await native.evaluate('document.querySelector("input[name=appearance-decorations]").focus(); true');
  await native.key(' '); await until(() => native.evaluate('document.querySelector("input[name=appearance-decorations]").checked'), 'keyboard restores opt-in');
  await closeSettings(native);
  await settings(native, true);
  await native.call('Emulation.setDeviceMetricsOverride', { width: 320, height: 780, deviceScaleFactor: 1, mobile: false });
  await native.click('document.querySelector("[data-appearance-more]")');
  assert.equal(await native.evaluate('document.querySelectorAll("input[name=appearance-style]").length'), 17);
  const narrow = await native.evaluate(`(() => { const dialog=document.querySelector('[role=dialog]').getBoundingClientRect(); return {viewport:innerWidth,scroll:document.documentElement.scrollWidth,dialog:{left:dialog.left,right:dialog.right},outside:[...document.querySelectorAll('.appearance-option--style, [data-appearance-more], .appearance-motion-control')].map(el=>({text:el.innerText,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,width:el.getBoundingClientRect().width})).filter(r=>r.left<dialog.left || r.right>dialog.right+1)}; })()`);
  assert.equal(narrow.outside.length, 0, 'gallery and motion controls stay inside the 320px settings dialog: ' + JSON.stringify(narrow));
  assert.ok(narrow.scroll <= Math.max(narrow.viewport, defaultScrollWidth) + 1, 'appearance controls do not add to existing 320px dashboard overflow: ' + JSON.stringify({ defaultScrollWidth, ...narrow }));
  await shot(native, 'motion-gallery-320');
  await native.call('Emulation.clearDeviceMetricsOverride'); await closeSettings(native);
  for (const mode of ['light', 'dark']) {
    await settings(native, true); await select(native, 'theme-preference', mode); await closeSettings(native);
    for (const style of DECORATED_APPEARANCE_STYLES) {
    await settings(native, true); await select(native, 'appearance-style', style); await closeSettings(native);
    panel.showInactive();
    await until(async () => await artStyle(native) === style && await artStyle(popup) === style, 'main and tray decoration ' + style);
    await until(() => native.evaluate('document.querySelector("[data-appearance-decoration]").childElementCount > 0'), 'lazy artwork');
    await until(() => popup.evaluate('document.querySelector("[data-appearance-decoration]").getAnimations({subtree:true}).length > 0'), 'tray animation starts');
    const animation = client => client.evaluate('document.querySelector("[data-appearance-decoration]").getAnimations({subtree:true}).map(a=>({name:a.animationName,time:a.currentTime,state:a.playState}))');
    const before = await animation(native); await wait(120); const after = await animation(native);
    assert.ok(before.length > 0, style + ' has a real animation');
    assert.ok(after.some((a, i) => a.time > before[i]?.time || style === 'origami' && a.state === 'finished'), style + ' animation clock advances or the single fold completes');
    const geometry = await popup.evaluate(`(() => { const el=document.querySelector('[data-appearance-decoration]'), shell=document.querySelector('.tray-popover'), a=el.getBoundingClientRect(), b=shell.getBoundingClientRect(), s=getComputedStyle(el); return {left:a.left>=b.left,right:a.right<=b.right+1,top:a.top>=b.top,bottom:a.bottom<=b.bottom+1,pointer:s.pointerEvents,hidden:el.getAttribute('aria-hidden'),inert:el.inert,overflow:document.documentElement.scrollWidth<=innerWidth+1}; })()`);
    assert.deepEqual(geometry, { left: true, right: true, top: true, bottom: true, pointer: 'none', hidden: 'true', inert: true, overflow: true });
    assert.equal(mainWindow.window.listenerCount('hide'), baseline + 1, 'one native visibility subscription after repeated switches');
    states.push({ style, mode, before, after, geometry });
    await shot(native, `motion-desktop-${style}-${mode}`); await shot(popup, `motion-tray-${style}-${mode}`);
    }
  }
  await settings(native, true); await select(native, 'appearance-style', 'catppuccin'); await closeSettings(native);
  await until(async () => await count(native) === 0 && await count(popup) === 0, 'static style unmounts effects');
  assert.equal((await native.evaluate('window.tud.getAppearance()')).decorations, true, 'static styles retain the opt-in');
  await settings(native, true); await select(native, 'appearance-style', 'matrix'); await closeSettings(native); panel.showInactive();
  await until(async () => await count(native) === 1 && await count(popup) === 1, 'animated style resumes');
  await native.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await until(async () => await count(native) === 0, 'live reduced motion unmounts artwork');
  await settings(native, true);
  await native.evaluate('document.querySelector("input[name=appearance-decorations]").closest("label").scrollIntoView({block:"center"}); true');
  assert.equal(await native.evaluate('getComputedStyle(document.querySelector(".appearance-motion-reduced")).display !== "none" && document.querySelector("input[name=appearance-decorations]").checked'), true, 'reduced-motion reason is visible while the saved opt-in remains on');
  await shot(native, 'motion-reduced-preference'); await closeSettings(native);
  await popup.call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  await until(async () => await count(popup) === 0, 'tray reduced motion');
  for (const client of [native, popup]) await allowMotion(client);
  panel.showInactive(); await until(async () => await count(native) === 1 && await count(popup) === 1, 'clearing reduced motion resumes');
  mainWindow.window.webContents.setBackgroundThrottling(false);
  mainWindow.window.hide(); await until(async () => await count(native) === 0, 'hidden native window stops with throttling disabled');
  mainWindow.window.showInactive(); await until(async () => await count(native) === 1, 'native show resumes');
  mainWindow.window.minimize(); await until(async () => await count(native) === 0, 'minimized native window stops');
  mainWindow.window.restore(); mainWindow.window.showInactive(); await until(async () => await count(native) === 1, 'restore resumes');
  panel.hide(); await until(async () => await count(popup) === 0, 'hidden tray stops');
  panel.showInactive(); await until(async () => await count(popup) === 1, 'tray show resumes');
  const hidden = await openHidden();
  await allowMotion(hidden);
  await until(() => hidden.evaluate('document.documentElement.dataset.appearance === "matrix"'), 'initial hidden renderer reads opted-in style');
  await wait(150); assert.equal(await count(hidden), 0, 'initial show:false never mounts decorative graphics');
  assert.equal(await hidden.evaluate('document.visibilityState'), 'visible', 'native visibility takes precedence over the document state');
  hidden.window.showInactive(); await until(async () => await count(hidden) === 1, 'new window show starts graphics'); hidden.window.destroy();
  // Exercise browser storage, the Page Visibility event, cross-tab changes and reload.
  await web.call('Network.enable'); await web.call('Network.setBlockedURLs', { urls: ['*AppearanceArtwork*'] });
  web.window.showInactive(); await settings(web, false); await select(web, 'appearance-style', 'matrix'); await toggle(web, true); await closeSettings(web);
  await until(() => web.evaluate('Boolean(document.querySelector("[data-appearance-artwork-error]"))'), 'optional chunk failure stays within decoration boundary');
  assert.equal(await web.evaluate('Boolean(document.querySelector("[data-quota-card]"))'), true, 'core UI survives unavailable artwork');
  await web.click('document.querySelector("[data-quota-card]")');
  await until(() => web.evaluate('Boolean(document.querySelector("[role=dialog]"))'), 'quota interaction survives unavailable artwork'); await web.key('Escape');
  await web.call('Network.setBlockedURLs', { urls: [] }); await web.window.reload();
  peer.window.showInactive();
  await until(async () => await count(web) === 1 && await count(peer) === 1, 'browser preference reaches a second tab');
  web.window.webContents.setBackgroundThrottling(true);
  await web.window.hide(); await until(async () => await count(web) === 0, 'browser page hidden stops effects');
  await web.window.showInactive(); await until(async () => await count(web) === 1, 'browser page show resumes');
  await web.window.reload(); await until(async () => await count(web) === 1, 'browser reload restores opt-in');
  await web.click('document.querySelector("[data-appearance-pause]")');
  await until(async () => await count(web) === 0 && await count(peer) === 0, 'visible pause action saves and reaches peer');
  // Preserve the existing quota click/keyboard path through the decorative layer.
  mainWindow.window.show(); await native.click('document.querySelector("[data-quota-card]")');
  await until(() => native.evaluate('Boolean(document.querySelector("[role=dialog]"))'), 'animated quota card remains clickable'); await native.key('Escape');
  await mainWindow.window.reload(); panel.showInactive(); await until(async () => await count(native) === 1, 'native reload restores opt-in');
  const file = path.join(output, 'profile/appearance.json');
  assert.equal(JSON.parse(await readFile(file, 'utf8')).decorations, true);
  // A failed pause still stops this window and exposes an adjacent retry action.
  await rename(file, file + '.pause-saved'); await mkdir(file);
  panel.showInactive(); await popup.click('document.querySelector("[data-appearance-pause]")');
  await until(() => popup.evaluate('Boolean(document.querySelector(".appearance-motion-notice"))'), 'pause failure feedback');
  assert.equal(await count(popup), 0);
  await rmdir(file); await rename(file + '.pause-saved', file);
  await popup.click('document.querySelector(".appearance-motion-notice button")');
  await until(async () => await count(native) === 0 && !await popup.evaluate('Boolean(document.querySelector(".appearance-motion-notice"))'), 'pause retry reaches all windows');
  await until(() => mainWindow.window.listenerCount('hide') === baseline, 'motion off cleans native subscriptions');
  await settings(native, true); await select(native, 'theme-preference', 'light'); await select(native, 'appearance-style', 'default'); await closeSettings(native);
  assert.equal(await count(native), 0);
  assert.equal(await native.evaluate('document.querySelectorAll("[data-appearance-pause]").length'), 0);
  await writeFile(path.join(output, 'motion-results.json'), JSON.stringify({ ok: true, systemMotion, narrow: { defaultScrollWidth, ...narrow }, states, checks: ['all-eleven-effects-main-and-tray-light-dark', 'keyboard-switch-and-320px-gallery', 'real-animation-clocks', 'bounded-inert-layers', 'static-switch-cleanup', 'reduced-motion', 'initial-hidden-hide-minimize-restore', 'optional-chunk-failure-keeps-quota-interactions', 'browser-tabs-and-reload', 'native-reload', 'quota-click', 'pause-save-failure-retry', 'visibility-subscription-cleanup'] }, null, 2));
}
