import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { makeSourceArchive, extractSourceArchive, assertCleanSource, verifyWorkspaceLinks, sourceBuildEnvironment } from './check-source-archive.mjs';

async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), 'quotern source repo '));
  t.after(() => rm(root, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', root]);
  execFileSync('git', ['-C', root, 'config', 'user.email', 'source-test@example.invalid']);
  execFileSync('git', ['-C', root, 'config', 'user.name', 'Source test']);
  await writeFile(join(root, 'package.json'), '{"name":"source-fixture","private":true}');
  await writeFile(join(root, '.gitattributes'), 'ignored.txt export-ignore\n');
  await writeFile(join(root, '.gitignore'), 'node_modules/\nout/\n.quotern-dev/\n');
  await writeFile(join(root, 'ignored.txt'), 'not exported');
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', ['-C', root, 'commit', '-qm', 'fixture']);
  const temporary = await mkdtemp(join(tmpdir(), 'quotern source archive '));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  return { root, temporary };
}

test('a committed archive honors export-ignore and extracts without Git metadata', async t => {
  const { root, temporary } = await repository(t);
  const archive = join(temporary, 'source.tar');
  await makeSourceArchive({ root, archive, mode: 'ref', ref: 'HEAD' });
  const source = join(temporary, 'source');
  await extractSourceArchive({ archive, source });
  assert.equal(JSON.parse(await readFile(join(source, 'package.json'), 'utf8')).name, 'source-fixture');
  await assert.rejects(access(join(source, '.git')));
  await assert.rejects(access(join(source, 'ignored.txt')));
  await assertCleanSource(source);
});

test('working-tree validation includes new and modified source while rejecting old outputs', async t => {
  const { root, temporary } = await repository(t);
  await writeFile(join(root, 'package.json'), '{"name":"modified","private":true}');
  await writeFile(join(root, 'new-script.mjs'), 'console.log("new");');
  for (const directory of ['node_modules', 'out', '.quotern-dev']) {
    await mkdir(join(root, directory));
    await writeFile(join(root, directory, 'stale.js'), 'stale');
  }
  const archive = join(temporary, 'source.tar');
  await makeSourceArchive({ root, archive, mode: 'working-tree' });
  const source = join(temporary, 'source');
  await extractSourceArchive({ archive, source });
  assert.equal(JSON.parse(await readFile(join(source, 'package.json'), 'utf8')).name, 'modified');
  assert.equal(await readFile(join(source, 'new-script.mjs'), 'utf8'), 'console.log("new");');
  await assertCleanSource(source);
  for (const directory of ['node_modules', 'out', '.quotern-dev']) await assert.rejects(access(join(source, directory)));
});

test('initial source checks reject tracked build output instead of treating it as a fresh build', async t => {
  const { root } = await repository(t);
  await mkdir(join(root, 'packages', 'core', 'dist'), { recursive: true });
  await writeFile(join(root, 'packages', 'core', 'dist', 'index.js'), 'cached');
  await assert.rejects(assertCleanSource(root), /\.git|dist|output/i);
});

test('workspace links must point to packages inside the extracted archive', async t => {
  const { root, temporary } = await repository(t);
  const source = join(temporary, 'source');
  const local = join(source, 'packages', 'core');
  const importer = join(source, 'apps', 'desktop');
  await mkdir(local, { recursive: true });
  await mkdir(join(importer, 'node_modules'), { recursive: true });
  await writeFile(join(source, 'package.json'), '{"name":"root"}');
  await writeFile(join(local, 'package.json'), '{"name":"quotern-core"}');
  await writeFile(join(importer, 'package.json'), '{"name":"desktop","dependencies":{"quotern-core":"workspace:*"}}');
  const link = join(importer, 'node_modules', 'quotern-core');
  await symlink(root, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(verifyWorkspaceLinks(source), /workspace|archive/i);
  await rm(link);
  await symlink(local, link, process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal(await verifyWorkspaceLinks(source), 1);
});

test('source builds remove checkout paths and build overrides while retaining network proxy settings', () => {
  const env = sourceBuildEnvironment({
    PATH: 'C:\\source checkout\\node_modules\\.bin;C:\\Windows', NODE_PATH: 'C:\\source checkout\\node_modules',
    NODE_OPTIONS: '--require injected.js', PUBLIC_PATH: '/old/', VITE_BASE: '/old/', QUOTERN_DEV_QUOTA_PREVIEW: '1',
    ELECTRON_SKIP_BINARY_DOWNLOAD: '1', HTTPS_PROXY: 'http://127.0.0.1:7890', npm_execpath: 'C:\\tools\\pnpm.cjs',
    INIT_CWD: 'C:\\source checkout',
  }, 'C:\\source checkout', ';');
  assert.equal(env.NODE_PATH, undefined);
  assert.equal(env.NODE_OPTIONS, undefined);
  assert.equal(env.PUBLIC_PATH, undefined);
  assert.equal(env.VITE_BASE, undefined);
  assert.equal(env.QUOTERN_DEV_QUOTA_PREVIEW, undefined);
  assert.equal(env.ELECTRON_SKIP_BINARY_DOWNLOAD, undefined);
  assert.equal(env.INIT_CWD, undefined);
  assert.equal(env.PATH, 'C:\\Windows');
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7890');
});

test('the archive checker can start before installing checkout dependencies', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'quotern standalone archive checker '));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const script = join(directory, 'check-source-archive.mjs');
  await copyFile(fileURLToPath(new URL('./check-source-archive.mjs', import.meta.url)), script);
  const result = execFileSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.match(result, /working-tree|archive/i);
});
