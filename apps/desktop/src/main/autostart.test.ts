import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { desktopPreferences } from '../sidecar/preferences.js';

test('login changes preserve existing preferences, publish the saved state and survive restart', async t => {
  const profile = await mkdtemp(join(tmpdir(),'quotern-login-'));
  t.after(()=>rm(profile,{recursive:true,force:true}));
  const file=join(profile,'desktop-prefs.json');
  await writeFile(file,JSON.stringify({openAtLogin:false,launchHidden:false,themeMode:'dark'}));
  const events: unknown[][]=[];
  const prefs=await desktopPreferences(profile,(...event)=>events.push(event));
  await prefs.channels.get('autostart:save')!(true);
  assert.deepEqual(JSON.parse(await readFile(file,'utf8')),{openAtLogin:true,launchHidden:false,themeMode:'dark'});
  assert.deepEqual(events,[['autostart:changed',true]]);
  const next=await desktopPreferences(profile,()=>{});
  assert.equal(next.channels.get('autostart:get')!(),true);
  assert.equal(next.channels.get('autostart:get-hidden')!(),false);
});

test('first launch defaults to silent login and failed saves emit no change', async t=>{
  const profile=await mkdtemp(join(tmpdir(),'quotern-login-'));
  t.after(()=>rm(profile,{recursive:true,force:true}));
  const events:unknown[][]=[];
  const prefs=await desktopPreferences(profile,(...args)=>events.push(args));
  assert.equal(prefs.channels.get('autostart:get-hidden')!(),true);
  await assert.rejects(async()=>prefs.channels.get('autostart:save')!('invalid'),/Invalid/);
  await rm(profile,{recursive:true});
  await assert.rejects(async()=>prefs.channels.get('autostart:save')!(false));
  assert.equal(prefs.channels.get('autostart:get')!(),true);
  assert.deepEqual(events,[]);
});
