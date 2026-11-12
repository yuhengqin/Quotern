import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer as createPortProbe } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, parse } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';

const source = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(join(source, 'packages/dashboard/package.json'));
const { build, createServer, loadConfigFromFile } = await import(pathToFileURL(require.resolve('vite')).href);
const imports = [
  'achievements', 'daily-model-key', 'timezone', 'project-label', 'dashboard-trend', 'session-csv',
  'leaderboard', 'pricing-matcher', 'local-metrics', 'quota/shared/quota-presentation',
  'quota/shared/subscription-channels', 'quota/shared/quota-shortcut',
];
const entry = imports.map(name => `export * from 'quotern-core/${name}';`).join('\n')
  + "\nexport { default as pricing } from 'quotern-core/pricing-data';\n";

async function fixture(t, desktop) {
  // Keep fixtures private to this checkout and expand any path symlinks.
  const temporary = join(source, '.quotern-dev');
  await mkdir(temporary, { recursive: true });
  const root = await realpath(await mkdtemp(join(temporary, 'vite-core-')));
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
  // Include a root-relative module URL as well as Vite's /@fs/ Core URLs.
  await writeFile(join(page, 'entry.ts'), "export * from './core-entries.ts';\n");
  await writeFile(join(page, 'core-entries.ts'), entry);
  await cp(join(source, relative, 'package.json'), join(frontend, 'package.json'));
  const configName = desktop ? 'electron.vite.config.ts' : 'vite.config.ts';
  await cp(join(source, relative, configName), join(frontend, configName));
  for (const dependency of ['vite', '@vitejs/plugin-react', '@tanstack/router-plugin', '@tailwindcss/vite', '@fontsource-variable/jetbrains-mono', ...(desktop ? ['electron-vite'] : [])]) {
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
      const frontendConfig = await config('serve');
      server = await createServer({
        ...frontendConfig,
        optimizeDeps: { noDiscovery: true, include: [] },
        server: { ...frontendConfig.server, host: '127.0.0.1', port, strictPort: true, headers: { 'X-Quotern-Font-Test': 'enabled' } },
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
      const specifier = match[1];
      if (specifier.startsWith('/') || specifier.startsWith('./') || specifier.startsWith('../')) {
        pending.push(new URL(specifier, url).href);
      }
    }
  }
  assert.ok(seen.size >= imports.length + 3, `loads all public Core entries, pricing JSON and transitive imports: ${JSON.stringify([...seen])}`);
  return seen;
}

for (const [name, desktop] of [['Dashboard', false], ['Desktop renderer', true]]) {
  test(`${name} serves external font assets without exposing their package or env files`, { timeout: 30000 }, async t => {
    const app = await fixture(t, desktop);
    await writeFile(join(app.page, 'font.css'), '@import "@fontsource-variable/jetbrains-mono";\n');
    await writeFile(join(app.root, '.env.font-access-check'), 'PRIVATE_FONT_TEST_VALUE=do-not-serve\n');
    const server = await app.serve();
    const origin = server.resolvedUrls.local[0];
    const response = await fetch(new URL('/font.css?direct', origin));
    assert.equal(response.status, 200);
    const css = await response.text();
    const fonts = [...css.matchAll(/url\(["']?([^\s)"']+\.woff2)["']?\)/g)].map(match => match[1]);
    assert.ok(fonts.length > 0, 'the package CSS references real font files');
    const relative = desktop ? 'apps/desktop' : 'packages/dashboard';
    const fontPackage = await realpath(join(source, relative, 'node_modules/@fontsource-variable/jetbrains-mono'));
    for (const url of new Set(fonts)) {
      const font = await fetch(new URL(url, origin));
      assert.equal(font.status, 200, `font request must succeed: ${url}`);
      assert.match(font.headers.get('content-type') ?? '', /font\/woff2/);
      assert.equal(font.headers.get('x-quotern-font-test'), 'enabled');
      const expected = await readFile(join(fontPackage, 'files', basename(decodeURI(new URL(url, origin).pathname))));
      assert.deepEqual(Buffer.from(await font.arrayBuffer()), expected, 'the URL resolves to the intended drive and file');
    }
    const fontUrl = new URL(fonts[0], origin);
    fontUrl.search = '?font-check=1';
    const head = await fetch(fontUrl, { method: 'HEAD' });
    assert.equal(head.status, 200);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    const range = await fetch(fontUrl, { headers: { Range: 'bytes=0-3' } });
    assert.equal(range.status, 206);
    assert.equal(await range.text(), 'wOF2');
    const cached = await fetch(fontUrl, { headers: { 'If-None-Match': head.headers.get('etag') } });
    assert.equal(cached.status, 304);
    if (process.platform === 'win32') {
      const lowercase = new URL(fontUrl);
      lowercase.pathname = lowercase.pathname.replace(/^\/@fs\/([A-Z]):/, (_, drive) => `/@fs/${drive.toLowerCase()}:`);
      const font = await fetch(lowercase);
      assert.equal(font.status, 200);
      await font.body.cancel();
    }
    const missing = await fetch(new URL(`${fonts[0]}.missing`, origin));
    assert.equal(missing.status, 404);
    const textAsset = join(app.root, '跨盘 资源.txt');
    await writeFile(textAsset, 'cross-drive asset contents\n');
    const textUrl = new URL(`/@fs/${textAsset.replaceAll('\\', '/')}`, origin);
    textUrl.search = '?asset-check=1';
    const text = await fetch(textUrl);
    assert.equal(text.status, 200);
    assert.equal(await text.text(), 'cross-drive asset contents\n');
    const traversalUrl = new URL(fonts[0], origin);
    traversalUrl.pathname = traversalUrl.pathname.slice(0, traversalUrl.pathname.lastIndexOf('/') + 1) + '%2e%2e%2fpackage.json';
    const traversal = await fetch(traversalUrl);
    assert.ok([400, 403, 404].includes(traversal.status), 'encoded traversal cannot expose package metadata');
    const metadata = join(fontPackage, 'package.json');
    for (const file of [metadata, join(app.root, '.env.font-access-check')]) {
      const denied = await fetch(new URL(`/@fs/${file.replaceAll('\\', '/')}`, origin));
      assert.equal(denied.status, 403, `unrelated files remain blocked: ${file}`);
    }
  });

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

test('Windows preserves file access rules when the font store is on another drive', { skip: process.platform !== 'win32', timeout: 30000 }, async t => {
  const fontDrive = parse(await realpath(require.resolve('@fontsource-variable/jetbrains-mono/index.css'))).root.toLowerCase();
  const candidates = [tmpdir(), ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, 'Temp')] : [])];
  let workingDirectory;
  for (const candidate of new Set(candidates)) {
    try {
      const temporary = await realpath(candidate);
      if (parse(temporary).root.toLowerCase() === fontDrive) continue;
      workingDirectory = await realpath(await mkdtemp(join(temporary, 'quotern-vite-cross-drive-')));
      break;
    } catch (error) {
      if (!['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(error.code)) throw error;
    }
  }
  if (!workingDirectory) return t.skip('a writable temporary directory on a second drive is required');
  let child;
  let closed;
  t.after(async () => {
    if (child && child.exitCode == null && child.signalCode == null) child.kill();
    await closed?.catch(() => {});
    await rm(workingDirectory, { recursive: true, force: true });
  });
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  child = spawn(process.execPath, ['--test', '--test-name-pattern', 'serves external font assets', fileURLToPath(import.meta.url)], {
    cwd: workingDirectory, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  closed = once(child, 'close');
  const [code] = await closed;
  assert.match(output, /Dashboard serves external font assets/);
  assert.match(output, /Desktop renderer serves external font assets/);
  assert.equal(code, 0, `cross-drive font requests and access checks must pass\n${output}`);
});
