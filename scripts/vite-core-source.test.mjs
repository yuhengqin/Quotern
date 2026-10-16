import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer as createPortProbe } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const source = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(join(source, 'packages/dashboard/package.json'));
const { build, createServer, loadConfigFromFile } = await import(pathToFileURL(require.resolve('vite')).href);
const imports = [
  'achievements', 'daily-model-key', 'timezone', 'project-label', 'dashboard-trend',
  'leaderboard', 'pricing-matcher', 'local-metrics', 'quota/shared/quota-presentation',
];
const entry = imports.map(name => `export * from 'quotern-core/${name}';`).join('\n')
  + "\nexport { default as pricing } from 'quotern-core/pricing-data';\n";

async function fixture(t, desktop) {
  const root = await mkdtemp(join(tmpdir(), 'quotern-vite-core-'));
  let server;
  t.after(async () => {
    await server?.close();
    // This directory was created by this test; never remove the source checkout's dist.
    await rm(root, { recursive: true, force: true });
  });
  await cp(join(source, 'scripts'), join(root, 'scripts'), { recursive: true });
  await cp(join(source, 'package.json'), join(root, 'package.json'));
  await cp(join(source, 'pnpm-workspace.yaml'), join(root, 'pnpm-workspace.yaml'));
  const core = join(root, 'packages/core');
  await mkdir(core, { recursive: true });
  await cp(join(source, 'packages/core/package.json'), join(core, 'package.json'));
  await cp(join(source, 'packages/core/src'), join(core, 'src'), { recursive: true });
  await cp(join(source, 'packages/core/dist'), join(core, 'dist'), { recursive: true });
  const relative = desktop ? 'apps/desktop' : 'packages/dashboard';
  const frontend = join(root, relative);
  const page = desktop ? join(frontend, 'src/renderer') : frontend;
  await mkdir(page, { recursive: true });
  await writeFile(join(page, 'entry.ts'), entry);
  await cp(join(source, relative, 'package.json'), join(frontend, 'package.json'));
  const configName = desktop ? 'electron.vite.config.ts' : 'vite.config.ts';
  await cp(join(source, relative, configName), join(frontend, configName));
  for (const dependency of ['vite', '@vitejs/plugin-react', '@tanstack/router-plugin', '@tailwindcss/vite', ...(desktop ? ['electron-vite'] : [])]) {
    const target = join(frontend, 'node_modules', dependency);
    await mkdir(dirname(target), { recursive: true });
    await symlink(await realpath(join(source, relative, 'node_modules', dependency)), target, process.platform === 'win32' ? 'junction' : 'dir');
  }
  await symlink(core, join(frontend, 'node_modules/quotern-core'), process.platform === 'win32' ? 'junction' : 'dir');
  async function config(command) {
    const loaded = await loadConfigFromFile({ command, mode: command === 'serve' ? 'development' : 'production' }, join(frontend, configName));
    assert.ok(loaded);
    const frontendConfig = desktop ? loaded.config.renderer : loaded.config;
    return {
      ...frontendConfig,
      // These fixtures exercise module resolution and have no application routes.
      plugins: frontendConfig.plugins.flat(Infinity).filter(plugin => !plugin.name.startsWith('tanstack')),
      root: page,
      configFile: false,
      cacheDir: join(root, '.vite-cache'),
      logLevel: 'silent',
    };
  }
  return {
    root, core, page, config,
    async serve() {
      const probe = createPortProbe();
      await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
      const port = probe.address().port;
      await new Promise(resolve => probe.close(resolve));
      server = await createServer({
        ...await config('serve'),
        optimizeDeps: { noDiscovery: true, include: [] },
        server: { host: '127.0.0.1', port, strictPort: true, fs: { allow: [root] } },
      });
      await server.listen();
      return server;
    },
  };
}

async function loadGraph(server) {
  const origin = server.resolvedUrls.local[0];
  const pending = ['/entry.ts'];
  const seen = new Set();
  while (pending.length) {
    const url = new URL(pending.pop(), origin).href;
    if (seen.has(url)) continue;
    seen.add(url);
    const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
    const code = await response.text();
    assert.equal(response.status, 200, `${url}\n${code}`);
    assert.match(response.headers.get('content-type') ?? '', /javascript/, `${url}\n${code}`);
    for (const match of code.matchAll(/\b(?:from\s*|import\s*)["']([^"']+)["']/g)) {
      if (match[1].startsWith('/@fs/') || match[1].startsWith('/@id/')) pending.push(match[1]);
    }
  }
  assert.ok(seen.size >= imports.length + 2, `loads all public Core entries, pricing JSON and transitive imports: ${JSON.stringify([...seen])}`);
  return seen;
}

for (const [name, desktop] of [['Dashboard', false], ['Desktop renderer', true]]) {
  test(`${name} keeps serving Core modules while a clean build removes dist`, { timeout: 30000 }, async t => {
    const app = await fixture(t, desktop);
    const server = await app.serve();
    await loadGraph(server);
    await rm(join(app.core, 'dist'), { recursive: true, force: true });
    // Re-run transforms as a reload/HMR update would, without relying on watcher timing.
    server.moduleGraph.invalidateAll();
    const duringBuild = await loadGraph(server);
    assert.ok([...duringBuild].some(url => url.includes('/core/src/achievements/catalog.ts')), 'transitive imports also use source');
  });

  test(`${name} production build still consumes compiled Core exports`, { timeout: 30000 }, async t => {
    const app = await fixture(t, desktop);
    await writeFile(join(app.page, 'entry.ts'), "export { LEADERBOARD_DEFAULT_LIMIT } from 'quotern-core/leaderboard';\n");
    await writeFile(join(app.core, 'dist/leaderboard.js'), 'export const LEADERBOARD_DEFAULT_LIMIT = 123456;\n');
    const result = await build({
      ...await app.config('build'),
      build: { write: false, minify: false, rollupOptions: { input: join(app.page, 'entry.ts'), preserveEntrySignatures: 'strict', output: { format: 'es' } } },
    });
    const chunk = result.output.find(item => item.type === 'chunk' && item.isEntry);
    assert.ok(chunk);
    const compiled = await import(`data:text/javascript;base64,${Buffer.from(chunk.code).toString('base64')}`);
    assert.equal(compiled.LEADERBOARD_DEFAULT_LIMIT, 123456);
  });
}
