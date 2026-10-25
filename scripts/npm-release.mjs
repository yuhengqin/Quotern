#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { appendFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { sourceBuildEnvironment } from './check-source-archive.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = 'https://registry.npmjs.org/';
const PACKAGES = [
  { name: 'quotern-core', directory: 'packages/core', files: ['dist/index.js', 'dist/pricing/pricing.json'] },
  { name: 'quotern-i18n', directory: 'packages/i18n', files: ['dist/index.js', 'dist/quota.js'] },
  { name: 'quotern', directory: 'packages/cli', files: ['bin/quotern.js', 'dist/index.js', 'dist/dashboard/index.html', 'skills/quotern-usage/SKILL.md'] },
];
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

export function selectNpmReleaseTag({ eventName, action, release, ref, commit, tagCommit, desktopVersion, versions }) {
  if (eventName !== 'release' || action !== 'published' || release?.draft !== false) throw new Error('npm publication requires a published GitHub Release');
  if (!VERSION.test(desktopVersion) || release.tag_name !== `v${desktopVersion}` || ref !== `refs/tags/v${desktopVersion}`) throw new Error('Release tag must match the Desktop source version');
  if (!/^[a-f0-9]{40}$/i.test(commit ?? '') || commit !== tagCommit) throw new Error('Release checkout must match the tagged commit');
  if (release.prerelease !== desktopVersion.includes('-')) throw new Error('GitHub prerelease status must match the version tag');
  const tag = release.prerelease ? 'next' : 'latest';
  for (const { name } of PACKAGES) {
    if (!VERSION.test(versions[name] ?? '') || (tag === 'latest' && versions[name].includes('-'))) throw new Error(`Invalid ${tag} version for ${name}`);
  }
  return tag;
}

export function planStableNpmTags(versions, registryPackages) {
  const updates = [];
  for (const { name } of PACKAGES) {
    const version = versions[name];
    const latest = registryPackages[name]?.['dist-tags']?.latest;
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`Cannot promote prerelease ${name} to latest`);
    if (latest === version) continue;
    if (latest) {
      if (!/^\d+\.\d+\.\d+$/.test(latest)) throw new Error(`Unexpected latest version for ${name}: ${latest}`);
      const current = latest.split('.').map(Number);
      const target = version.split('.').map(Number);
      const difference = target.map((part, index) => part - current[index]).find(part => part !== 0) ?? 0;
      if (difference < 0) throw new Error(`Refusing to roll ${name} latest backward from ${latest} to ${version}`);
    }
    updates.push({ name, version });
  }
  return updates;
}

async function checkStableTags(versions, promote) {
  if (process.env.NPM_DIST_TAG === 'next') return;
  if (process.env.NPM_DIST_TAG !== 'latest') throw new Error('NPM_DIST_TAG must be selected by Release preflight');
  const registryPackages = {};
  for (const { name } of PACKAGES) {
    const response = await fetch(`${REGISTRY}${name}`, { signal: AbortSignal.timeout(30_000), cache: 'no-store' });
    if (!response.ok && response.status !== 404) throw new Error(`Cannot inspect ${name}: registry HTTP ${response.status}`);
    registryPackages[name] = response.status === 404 ? {} : await response.json();
  }
  const updates = planStableNpmTags(versions, registryPackages);
  if (promote) for (const { name, version } of updates) await pnpm(['dist-tag', 'add', `${name}@${version}`, 'latest', '--registry', REGISTRY], ROOT);
}

export async function inspectNpmTarball(archive, expected, versions) {
  const manifest = JSON.parse(execFileSync('tar', ['-xOf', archive, 'package/package.json'], { encoding: 'utf8' }));
  const files = new Set(execFileSync('tar', ['-tf', archive], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim().split(/\r?\n/).map(file => file.replace(/^package\//, '')));
  const definition = PACKAGES.find(item => item.name === expected.name);
  if (!definition || manifest.private || manifest.name !== expected.name || manifest.version !== expected.version) throw new Error(`Invalid packed identity: ${expected.name}`);
  for (const file of definition.files) if (!files.has(file)) throw new Error(`Missing ${expected.name} package file: ${file}`);
  for (const section of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(manifest[section] ?? {})) {
      if (/^(workspace|file|link|portal):/.test(version)) throw new Error(`Non-registry dependency: ${name}@${version}`);
      if (name in versions && version !== versions[name]) throw new Error(`Stale internal dependency: ${name}@${version}`);
    }
  }
  if (expected.name === 'quotern') {
    if (manifest.bin?.quotern?.replace(/^\.\//, '') !== 'bin/quotern.js') throw new Error('Missing quotern executable mapping');
    if (![...files].some(file => /^dist\/dashboard\/assets\/.+\.js$/.test(file))) throw new Error('Missing Dashboard JavaScript assets');
    for (const name of ['quotern-core', 'quotern-i18n']) if (manifest.dependencies?.[name] !== versions[name]) throw new Error(`Missing CLI dependency: ${name}`);
  }
  return { name: manifest.name, version: manifest.version, archive };
}

async function packageVersions(root) {
  return Object.fromEntries(await Promise.all(PACKAGES.map(async item => [item.name, JSON.parse(await readFile(join(root, item.directory, 'package.json'), 'utf8')).version])));
}

function pnpm(args, cwd, env = process.env) {
  if (!env.npm_execpath) throw new Error('Run through corepack pnpm');
  return new Promise((accept, reject) => {
    const child = spawn(process.execPath, [env.npm_execpath, ...args], { cwd, env, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', (code, signal) => code === 0 ? accept() : reject(new Error(`pnpm ${args.join(' ')} failed (${signal ?? code})`)));
  });
}

export async function smokeInstall(root, packages, fromRegistry) {
  const consumer = await mkdtemp(join(tmpdir(), 'quotern-npm-consumer-'));
  try {
    const dependencies = Object.fromEntries(packages.map(item => [item.name, fromRegistry ? item.version : `file:${item.archive.replaceAll('\\', '/')}`]));
    await writeFile(join(consumer, 'package.json'), JSON.stringify({ name: 'quotern-package-smoke', private: true, dependencies }));
    // Before the first publication the CLI's exact core/i18n versions do not exist
    // in the registry yet. Resolve those transitive edges to this batch's tarballs.
    if (!fromRegistry) await writeFile(join(consumer, 'pnpm-workspace.yaml'), JSON.stringify({ packages: ['.'], overrides: dependencies }));
    const env = sourceBuildEnvironment(process.env, root);
    await pnpm(['install', '--ignore-scripts', fromRegistry ? '--prefer-offline=false' : '--prefer-offline', '--registry', REGISTRY], consumer, env);
    for (const item of PACKAGES) {
      const installed = join(consumer, 'node_modules', item.name);
      const manifest = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
      if (manifest.version !== packages.find(pkg => pkg.name === item.name).version) throw new Error(`Installed wrong ${item.name} version`);
      for (const file of item.files) if (!(await stat(join(installed, file))).isFile()) throw new Error(`Installed package is missing ${file}`);
      console.log(`Verified installed ${item.name}@${manifest.version}`);
    }
    // Exercise the installed bin without starting collection, registering hooks or touching user data.
    await pnpm(['exec', 'quotern', 'help', '--lang', 'en'], consumer, env);
  } finally {
    await rm(consumer, { recursive: true, force: true });
  }
}

async function main() {
  const { values } = parseArgs({ options: { preflight: { type: 'boolean' }, 'registry-smoke': { type: 'boolean' }, 'check-latest': { type: 'boolean' }, 'promote-latest': { type: 'boolean' }, output: { type: 'string' } } });
  const versions = await packageVersions(ROOT);
  if (values['check-latest'] || values['promote-latest']) {
    await checkStableTags(versions, Boolean(values['promote-latest']));
    return;
  }
  if (values.preflight) {
    const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).trim();
    if (commit !== process.env.GITHUB_SHA) throw new Error('Checkout differs from the Release event commit');
    const desktopVersion = JSON.parse(await readFile(join(ROOT, 'apps/desktop/package.json'), 'utf8')).version;
    // Validate the tag syntax before passing it to Git.
    if (!VERSION.test(desktopVersion) || event.release?.tag_name !== `v${desktopVersion}`) throw new Error('Release tag must match the Desktop source version');
    const tagCommit = execFileSync('git', ['rev-parse', '--verify', `refs/tags/v${desktopVersion}^{commit}`], { cwd: ROOT, encoding: 'utf8' }).trim();
    const tag = selectNpmReleaseTag({ eventName: process.env.GITHUB_EVENT_NAME, action: event.action, release: event.release, ref: process.env.GITHUB_REF, commit, tagCommit, desktopVersion, versions });
    await appendFile(process.env.GITHUB_OUTPUT, `npm-tag=${tag}\n`);
    console.log(`Verified ${event.release.tag_name} at ${commit}; npm channel: ${tag}`);
    return;
  }
  if (values['registry-smoke']) {
    await smokeInstall(ROOT, PACKAGES.map(item => ({ name: item.name, version: versions[item.name] })), true);
    return;
  }
  const output = values.output ? resolve(values.output) : await mkdtemp(join(tmpdir(), 'quotern-npm-packages-'));
  await mkdir(output, { recursive: true });
  await pnpm([...PACKAGES.flatMap(item => ['--filter', item.name]), '-r', 'pack', '--pack-destination', output], ROOT);
  const packages = [];
  for (const item of PACKAGES) {
    const version = versions[item.name];
    packages.push(await inspectNpmTarball(join(output, `${item.name}-${version}.tgz`), { name: item.name, version }, versions));
  }
  await smokeInstall(ROOT, packages, false);
  await writeFile(join(output, 'npm-release.json'), `${JSON.stringify({ status: 'passed', packages, checks: ['tarball-contents', 'internal-dependencies', 'fresh-install', 'cli-help'] }, null, 2)}\n`);
  console.log(`npm packages verified without publishing: ${output}`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => { console.error(error.stack); process.exitCode = 1; });
