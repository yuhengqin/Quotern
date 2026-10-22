#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OMIT = new Set(['.git', 'node_modules', 'dist', 'out', 'dist-test', 'release', '.quotern-dev', 'reference']);

async function archiveHash(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function included(file) {
  const parts = file.replaceAll('\\', '/').split('/');
  return !isAbsolute(file) && !parts.includes('..') && !parts.some(part => OMIT.has(part))
    && !/\.tsbuildinfo$|\.log$|^\.env(?:\..+)?\.local$/.test(basename(file));
}

export async function makeSourceArchive({ root, archive, mode = 'ref', ref = 'HEAD' }) {
  root = await realpath(root);
  archive = resolve(archive);
  if (mode === 'ref') {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref)) throw new Error('Invalid archive ref');
    execFileSync('git', ['archive', '--format=tar', `--output=${archive}`, ref], { cwd: root, stdio: 'inherit' });
    return;
  }
  if (mode !== 'working-tree') throw new Error(`Unknown archive mode: ${mode}`);
  const staging = await mkdtemp(join(dirname(archive), 'working-tree-'));
  try {
    const files = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], { cwd: root, maxBuffer: 16 * 1024 * 1024 }).toString('utf8').split('\0').filter(Boolean);
    for (const file of new Set(files)) {
      if (!included(file)) continue;
      const source = join(root, file);
      const info = await lstat(source).catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (!info) continue; // Deleted tracked paths are absent from the current source snapshot.
      if (info.isSymbolicLink()) {
        const target = await realpath(source);
        const rel = relative(root, target);
        if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Source symlink escapes checkout: ${file}`);
      }
      const target = join(staging, file);
      await mkdir(dirname(target), { recursive: true });
      await cp(source, target, { dereference: false, verbatimSymlinks: true });
    }
    execFileSync('tar', ['-cf', archive, '-C', staging, '.'], { stdio: 'inherit' });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

export async function extractSourceArchive({ archive, source }) {
  await mkdir(source);
  execFileSync('tar', ['-xf', resolve(archive), '-C', resolve(source)], { stdio: 'inherit' });
}

export async function assertCleanSource(root) {
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      const rel = relative(root, file);
      if (!included(rel)) throw new Error(`Source archive contains Git metadata or an old build output: ${rel}`);
      if (entry.isDirectory()) await visit(file);
      if (entry.isSymbolicLink()) {
        const target = await realpath(file);
        const targetRel = relative(await realpath(root), target);
        if (targetRel.startsWith('..') || isAbsolute(targetRel)) throw new Error(`Archive symlink escapes source: ${rel}`);
      }
    }
  }
  await visit(root);
}

async function workspacePackages(root) {
  const packages = [{ root, manifest: JSON.parse(await readFile(join(root, 'package.json'), 'utf8')) }];
  for (const group of ['packages', 'apps']) {
    const entries = await readdir(join(root, group), { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
    for (const entry of entries.filter(entry => entry.isDirectory())) {
      const directory = join(root, group, entry.name);
      const manifest = await readFile(join(directory, 'package.json'), 'utf8').catch(error => { if (error.code !== 'ENOENT') throw error; });
      if (manifest) packages.push({ root: directory, manifest: JSON.parse(manifest) });
    }
  }
  return packages;
}

export async function verifyWorkspaceLinks(root) {
  root = await realpath(root);
  const packages = await workspacePackages(root);
  const names = new Map(packages.map(item => [item.manifest.name, item.root]));
  let checked = 0;
  for (const item of packages) {
    const dependencies = { ...item.manifest.dependencies, ...item.manifest.devDependencies, ...item.manifest.optionalDependencies, ...item.manifest.peerDependencies };
    for (const [name, specifier] of Object.entries(dependencies)) {
      if (!String(specifier).startsWith('workspace:')) continue;
      if (!names.has(name)) throw new Error(`Missing workspace package: ${name}`);
      const actual = await realpath(join(item.root, 'node_modules', name));
      const expected = await realpath(names.get(name));
      if (actual !== expected) throw new Error(`Workspace link points outside the archive package: ${name} -> ${actual}`);
      const rel = relative(root, actual);
      if (rel.startsWith('..') || isAbsolute(rel)) throw new Error(`Workspace link escapes archive: ${name}`);
      checked++;
    }
  }
  return checked;
}

export function sourceBuildEnvironment(original, checkout, separator = delimiter) {
  const env = { ...original };
  const normalize = value => value.replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
  const prefix = normalize(checkout);
  for (const key of Object.keys(env)) {
    if (/^(NODE_PATH|NODE_OPTIONS|PUBLIC_PATH|INIT_CWD|ELECTRON_SKIP_BINARY_DOWNLOAD|ELECTRON_RUN_AS_NODE|npm_package_json|npm_config_local_prefix|PNPM_SCRIPT_SRC_DIR|PNPM_PACKAGE_ROOT)$/i.test(key)
      || /^(VITE_|QUOTERN_DEV_)/.test(key)) delete env[key];
    if (key.toLowerCase() === 'path') env[key] = env[key].split(separator).filter(path => !normalize(path).startsWith(`${prefix}/`) && normalize(path) !== prefix).join(separator);
  }
  return env;
}

function pnpm(args, cwd, env) {
  if (!env.npm_execpath) throw new Error('Run the archive check through corepack pnpm check:source-archive');
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [env.npm_execpath, ...args], { cwd, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? accept() : reject(new Error(`Archive pnpm ${args.join(' ')} failed (${signal ?? code})`)));
  });
}

export async function checkSourceArchive({ root = ROOT, mode = 'ref', ref = 'HEAD', output, isolatedStore = false } = {}) {
  const temporary = await mkdtemp(join(tmpdir(), 'quotern-source-build-'));
  const archive = join(temporary, 'source.tar');
  const source = join(temporary, 'source');
  const commit = execFileSync('git', ['rev-parse', `${ref}^{commit}`], { cwd: root, encoding: 'utf8' }).trim();
  await makeSourceArchive({ root, archive, mode, ref: mode === 'ref' ? commit : ref });
  await extractSourceArchive({ archive, source });
  await assertCleanSource(source);
  const env = sourceBuildEnvironment(process.env, root);
  const sourceManifest = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  const version = JSON.parse(await readFile(join(source, 'apps/desktop/package.json'), 'utf8')).version;
  console.log(`Building ${mode} source archive without .git: ${source}`);
  console.log(`Node ${process.version}; package manager ${sourceManifest.packageManager}`);
  await pnpm(['install', '--frozen-lockfile', '--prefer-offline', ...(isolatedStore ? ['--store-dir', join(temporary, 'pnpm-store')] : [])], source, env);
  const workspaceLinks = await verifyWorkspaceLinks(source);
  await pnpm(['build'], source, env);
  await pnpm(['--filter', 'quotern-desktop', 'typecheck'], source, env);
  const outputs = ['packages/core/dist/index.js', 'packages/i18n/dist/index.js', 'packages/dashboard/dist/index.html', 'packages/cli/dist/dashboard/index.html', 'apps/desktop/out/main/bootstrap.js', 'apps/desktop/out/renderer/index.html', 'apps/desktop/out/dsh-pet/runtime/main.js', 'apps/desktop/out/native-runtime/sharp/package.json'];
  for (const file of outputs) if (!(await stat(join(source, file))).isFile()) throw new Error(`Missing archive build output: ${file}`);
  // Dependencies may use the global store; local workspace packages must remain inside source.
  await verifyWorkspaceLinks(source);
  const result = { status: 'passed', mode, version, commit, archiveSha256: await archiveHash(archive), node: process.version, packageManager: sourceManifest.packageManager, workspaceLinks, outputs, source };
  const report = resolve(output ?? join(temporary, 'source-archive.json'));
  await mkdir(dirname(report), { recursive: true });
  await writeFile(report, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`Source archive check passed: ${report}`);
  return result;
}

async function main() {
  const { values } = parseArgs({ options: { help: { type: 'boolean' }, 'working-tree': { type: 'boolean', default: false }, 'isolated-store': { type: 'boolean', default: false }, ref: { type: 'string', default: 'HEAD' }, output: { type: 'string' } } });
  if (values.help) {
    console.log('Check a fresh source archive without .git: corepack pnpm check:source-archive [--ref HEAD | --working-tree] [--isolated-store] [--output report.json]');
    return;
  }
  await checkSourceArchive({ mode: values['working-tree'] ? 'working-tree' : 'ref', ref: values.ref, output: values.output, isolatedStore: values['isolated-store'] });
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
