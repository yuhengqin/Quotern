import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {desktopPreferences} from '../sidecar/preferences.js';

test('locale defaults to system; changing it broadcasts the saved choice and preserves older preferences',async t=>{
 const profile=await mkdtemp(join(tmpdir(),'quotern-locale-'));
 t.after(()=>rm(profile,{recursive:true,force:true}));
 const file=join(profile,'desktop-prefs.json');
 await writeFile(file,JSON.stringify({openAtLogin:false,launchHidden:false,themeMode:'dark',localePreference:'fr'}));
 const events:unknown[][]=[];
 const prefs=await desktopPreferences(profile,(...args)=>events.push(args));
 assert.equal((await prefs.channels.get('locale:get')!() as {preference:string}).preference,'system');
 await prefs.channels.get('locale:set')!('ja');
 assert.deepEqual(JSON.parse(await readFile(file,'utf8')),{openAtLogin:false,launchHidden:false,themeMode:'dark',localePreference:'ja'});
 assert.equal(events[0]?.[0],'locale:changed');
 assert.equal((await desktopPreferences(profile,()=>{})).locale(),'ja');
});
