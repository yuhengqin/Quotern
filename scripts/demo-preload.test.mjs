import assert from 'node:assert/strict';
import { test } from 'node:test';
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
