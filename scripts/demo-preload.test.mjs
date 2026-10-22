import assert from 'node:assert/strict';
import { test } from 'node:test';

test('demo initial chunk groups only the entry/dashboard static closure and leaves optional features lazy', async () => {
  const { createDemoInitialChunk } = await import('./demo-preload.mjs');
  assert.equal(typeof createDemoInitialChunk, 'function');
  const graph = {
    '/index.html': { isEntry: true, importedIds: ['/src/main.tsx'] },
    '/src/main.tsx': { importedIds: ['/react', '/shell'], dynamicallyImportedIds: ['/share'] },
    '/src/pages/DashboardPage.tsx': { importedIds: ['/react', '/charts'] },
    '/react': { importedIds: [] }, '/shell': { importedIds: ['/react'] },
    '/charts': { importedIds: [] }, '/share': { importedIds: [] }, '/pricing': { importedIds: [] },
  };
  const api = { getModuleIds: () => Object.keys(graph), getModuleInfo: id => graph[id] };
  const choose = createDemoInitialChunk();
  assert.equal(choose('/charts', api), 'demo-initial');
  assert.equal(choose('/shell', api), 'demo-initial');
  assert.equal(choose('/share', api), undefined);
  assert.equal(choose('/pricing', api), undefined);
});
test('demo preload closure includes only entry/dashboard imports, with cycle deduplication', async () => {
  const mod = await import('./demo-preload.mjs').catch(() => ({}));
  assert.equal(typeof mod.demoPreloadManifest, 'function');
  const manifest = mod.demoPreloadManifest({
    main: { type:'chunk', fileName:'assets/index-123.js', isEntry:true, name:'index', imports:[], viteMetadata:{importedCss:new Set(['assets/index-123.css'])} },
    dash: { type:'chunk', fileName:'assets/dashboard-456.js', name:'dashboard', imports:['assets/index-123.js','assets/shared-789.js'] },
    shared: { type:'chunk', fileName:'assets/shared-789.js', name:'shared', imports:['assets/index-123.js'] },
    pricing: { type:'chunk', fileName:'assets/pricing-999.js', name:'pricing', imports:[] },
  });
  assert.deepEqual(manifest, { schemaVersion:1, modules:['assets/index-123.js','assets/dashboard-456.js','assets/shared-789.js'], styles:['assets/index-123.css'] });
});
