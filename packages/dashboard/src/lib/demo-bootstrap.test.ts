import assert from 'node:assert/strict';
import { test } from 'node:test';
import { request } from './api.ts';
test('demo GET bootstrap is snapshot bound and never substitutes full sessions, other filters or mutations', async () => {
  const mod = await import('./demo-' + 'bootstrap.ts').catch(()=>({})) as Record<string,any>;
  assert.equal(typeof mod.readDemoBootstrap,'function');
  const previous = Object.getOwnPropertyDescriptor(globalThis,'document');
  const metadata = {schemaVersion:1,readOnly:true,exportedAt:'2026-10-22T00:00:00Z',referenceTime:'2020-01-05T12:00:00Z'};
  let bootstrap = {schemaVersion:1,exportedAt:metadata.exportedAt,referenceTime:metadata.referenceTime,responses:{'/functions/tud-config':{success:true,data:{deviceId:'demo'}},'/functions/tud-session-activity?days=7&preview=6':{success:true,data:{sessions:[]}}}};
  let marker = {textContent:JSON.stringify(bootstrap)};
  let demo = true;
  Object.defineProperty(globalThis,'document',{configurable:true,value:{getElementById:(id:string)=>id==='quotern-demo'?(demo?{textContent:JSON.stringify(metadata)}:null):id==='quotern-demo-bootstrap'?marker:null}});
  try {
    assert.deepEqual(mod.readDemoBootstrap('/functions/tud-config'),{deviceId:'demo'});
    const value = mod.readDemoBootstrap('/functions/tud-config'); value.deviceId='changed';
    assert.deepEqual(mod.readDemoBootstrap('/functions/tud-config'),{deviceId:'demo'});
    assert.equal(mod.readDemoBootstrap('/functions/tud-session-activity?days=7'),undefined);
    assert.equal(mod.readDemoBootstrap('/functions/tud-session-activity?days=30&preview=6'),undefined);
    assert.equal(mod.readDemoBootstrap('/functions/tud-session-activity?sessionSource=codex&sessionId=one'),undefined);
    bootstrap={...bootstrap,exportedAt:'1999-01-01T00:00:00Z'}; marker={textContent:JSON.stringify(bootstrap)};
    assert.equal(mod.readDemoBootstrap('/functions/tud-config'),undefined);
    marker={textContent:'invalid'}; assert.equal(mod.readDemoBootstrap('/functions/tud-config'),undefined);
    demo=false; assert.equal(mod.readDemoBootstrap('/functions/tud-config'),undefined);
  } finally {if(previous)Object.defineProperty(globalThis,'document',previous);else Reflect.deleteProperty(globalThis,'document');}
});

test('request consumes only demo GET matches and retains network fallback and mutation guard', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const metadata = { schemaVersion: 1, readOnly: true, exportedAt: '2026-10-22T00:00:00Z', referenceTime: '2020-01-05T12:00:00Z' };
  const responses = { '/functions/tud-config': { success: true, data: { deviceId: 'demo' } } };
  let demo = true;
  const marker = { textContent: JSON.stringify({ ...metadata, responses }) };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { getElementById: (id: string) => id === 'quotern-demo' ? demo ? { textContent: JSON.stringify(metadata) } : null : id === 'quotern-demo-bootstrap' ? marker : null } });
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ success: true, data: { network: true } })));
  try {
    assert.deepEqual(await request('/functions/tud-config'), { deviceId: 'demo' });
    assert.equal(fetchMock.mock.calls.length, 0);
    assert.deepEqual(await request('/functions/tud-session-activity?days=7'), { network: true });
    await assert.rejects(request('/functions/tud-config', { method: 'POST', body: '{}' }), /DEMO_READ_ONLY/);
    assert.equal(fetchMock.mock.calls.length, 1);
    demo = false;
    assert.deepEqual(await request('/functions/tud-config', { method: 'POST', body: '{}' }), { network: true });
    assert.deepEqual(await request('/functions/tud-config'), { network: true });
    assert.equal(fetchMock.mock.calls.length, 3);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else Reflect.deleteProperty(globalThis, 'document');
  }
});
