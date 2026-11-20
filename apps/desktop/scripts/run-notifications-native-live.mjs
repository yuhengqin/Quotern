// Opt-in Windows acceptance. This sends and removes a real toast using a private profile/AUMID.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { launchProbe } from './desktop-cdp.mjs';
import { defaultHost, eventually } from './native-pet-probe.mjs';

assert.equal(process.platform,'win32','Windows notifications require Windows');
const directory=path.resolve(process.argv[2] || fileURLToPath(new URL('../../../.quotern-dev/notification-live-'+Date.now(),import.meta.url)));
const probe=await launchProbe(process.argv[3] || defaultHost,directory,{webview2:true});
const run=promisify(execFile);
const appId='dev.quotern.desktop.dev.'+createHash('sha256').update(path.join(directory,'profile').toLowerCase()).digest('hex').slice(0,16);
async function history(){
  const command="[void][Windows.UI.Notifications.ToastNotificationManager,Windows.UI.Notifications,ContentType=WindowsRuntime]; $items=[Windows.UI.Notifications.ToastNotificationManager]::History.GetHistory('"+appId+"'); @($items | Where-Object { $_.Group -eq 'Quotern' }).Count";
  const {stdout}=await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',command],{windowsHide:true,timeout:10000});
  return Number(stdout.trim());
}
try{
  const main=await probe.connect(p=>p.url.includes('tauri.localhost'));
  await eventually(()=>main.evaluate('Boolean(window.tud?.notifications)'),'notification bridge');
  await main.evaluate("window.tud.notifications.setPreferences({sound:'none'})");
  assert.equal(await history(),0);
  const delivery=await main.evaluate('window.tud.notifications.test()');
  assert.equal(delivery,'shown');
  await eventually(async()=>await history()>0,'the test toast in Windows notification history');
  await main.evaluate('window.tud.notifications.clear()');
  await eventually(async()=>await history()===0,'withdrawn toast');
  await writeFile(path.join(directory,'result.json'),JSON.stringify({delivery,listed:true,removed:true}));
  console.log(JSON.stringify({directory,delivery,listed:true,removed:true}));
} finally {await probe.close();}
await assert.rejects(access(path.join(directory,'data','tud.pid')),{code:'ENOENT'});
