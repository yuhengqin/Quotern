import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import yaml from 'js-yaml';
import { inspectNpmTarball, planStableNpmTags, selectNpmReleaseTag, smokeInstall } from './npm-release.mjs';

const versions = { quotern: '0.2.0', 'quotern-core': '0.1.9', 'quotern-i18n': '0.1.2' };
const request = () => ({
  eventName: 'release', action: 'published',
  release: { draft: false, prerelease: false, tag_name: 'v0.3.0' },
  ref: 'refs/tags/v0.3.0', desktopVersion: '0.3.0',
  commit: 'a'.repeat(40), tagCommit: 'a'.repeat(40), versions,
});

test('only a published Release of the checked-out tag can publish independent npm versions', () => {
  assert.equal(selectNpmReleaseTag(request()), 'latest');
  for (const change of [
    { eventName: 'push' }, { action: 'created' },
    { release: { ...request().release, draft: true } },
    { ref: 'refs/heads/main' }, { desktopVersion: '0.2.0' },
    { tagCommit: 'b'.repeat(40) }, { commit: '' },
  ]) assert.throws(() => selectNpmReleaseTag({ ...request(), ...change }));
});

test('prereleases use next and cannot put prerelease npm versions on latest', () => {
  const beta = { ...request(), release: { draft: false, prerelease: true, tag_name: 'v0.3.0-beta.1' }, ref: 'refs/tags/v0.3.0-beta.1', desktopVersion: '0.3.0-beta.1' };
  assert.equal(selectNpmReleaseTag(beta), 'next');
  assert.throws(() => selectNpmReleaseTag({ ...beta, release: { ...beta.release, prerelease: false } }));
  assert.throws(() => selectNpmReleaseTag({ ...request(), versions: { ...versions, quotern: '0.2.0-beta.1' } }));
});

test('stable releases promote existing versions while refusing to roll latest backward', () => {
  const registry = {
    quotern: { 'dist-tags': { latest: '0.1.9' } },
    'quotern-core': { 'dist-tags': { latest: '0.1.9' } },
    'quotern-i18n': { 'dist-tags': { next: '0.1.2' } },
  };
  assert.deepEqual(planStableNpmTags(versions, registry), [
    { name: 'quotern-i18n', version: '0.1.2' },
    { name: 'quotern', version: '0.2.0' },
  ]);
  assert.throws(() => planStableNpmTags(versions, { ...registry, quotern: { 'dist-tags': { latest: '0.10.0' } } }));
  assert.throws(() => planStableNpmTags({ ...versions, quotern: '0.2.0-beta.1' }, registry));
});

test('Release preflight runs without installed dependencies and binds its output to the real Git tag', async t => {
  const root = await mkdtemp(join(tmpdir(), 'quotern-npm-source-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  for (const [directory, manifest] of [
    ['apps/desktop', { version: '0.3.0' }],
    ['packages/cli', { name: 'quotern', version: '0.2.0' }],
    ['packages/core', { name: 'quotern-core', version: '0.1.9' }],
    ['packages/i18n', { name: 'quotern-i18n', version: '0.1.2' }],
  ]) {
    await mkdir(join(root, directory), { recursive: true });
    await writeFile(join(root, directory, 'package.json'), JSON.stringify(manifest));
  }
  await mkdir(join(root, 'scripts'));
  for (const file of ['npm-release.mjs', 'check-source-archive.mjs']) await writeFile(join(root, 'scripts', file), await readFile(new URL(file, import.meta.url)));
  git(['init', '--quiet']);
  git(['add', '.']);
  git(['-c', 'user.name=Release test', '-c', 'user.email=release-test@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'fixture']);
  git(['tag', 'v0.3.0']);
  const event = join(root, 'event.json');
  const output = join(root, 'output.txt');
  await writeFile(event, JSON.stringify({ action: 'published', release: request().release }));
  const env = { ...process.env, GITHUB_EVENT_PATH: event, GITHUB_OUTPUT: output, GITHUB_EVENT_NAME: 'release', GITHUB_REF: 'refs/tags/v0.3.0', GITHUB_SHA: git(['rev-parse', 'HEAD']) };
  execFileSync(process.execPath, [join(root, 'scripts/npm-release.mjs'), '--preflight'], { cwd: root, env });
  assert.equal(await readFile(output, 'utf8'), 'npm-tag=latest\n');
});

async function tarball(t, { manifest, files, contents = {} }) {
  const directory = await mkdtemp(join(tmpdir(), 'quotern-npm-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const source = join(directory, 'package');
  await mkdir(source);
  await writeFile(join(source, 'package.json'), JSON.stringify(manifest));
  for (const file of files) {
    await mkdir(join(source, file, '..'), { recursive: true });
    await writeFile(join(source, file), contents[file] ?? '// fixture', { mode: file.startsWith('bin/') ? 0o755 : 0o644 });
  }
  const archive = join(directory, 'package.tgz');
  execFileSync('tar', ['-czf', archive, '-C', directory, 'package']);
  return archive;
}

const cliPackage = () => ({
  manifest: { name: 'quotern', version: '0.2.0', bin: { quotern: './bin/quotern.js' }, dependencies: { 'quotern-core': '0.1.9', 'quotern-i18n': '0.1.2' } },
  files: ['bin/quotern.js', 'dist/index.js', 'dist/dashboard/index.html', 'dist/dashboard/assets/app.js', 'skills/quotern-usage/SKILL.md'],
});

test('packed CLI includes its executable, dashboard, skill and installable internal dependencies', async t => {
  const archive = await tarball(t, cliPackage());
  assert.deepEqual(await inspectNpmTarball(archive, { name: 'quotern', version: '0.2.0' }, versions), { name: 'quotern', version: '0.2.0', archive });
});

test('package verification rejects missing runtime files and workspace-only dependencies', async t => {
  for (const absent of ['bin/quotern.js', 'dist/index.js', 'dist/dashboard/index.html', 'dist/dashboard/assets/app.js', 'skills/quotern-usage/SKILL.md']) {
    const fixture = cliPackage();
    fixture.files = fixture.files.filter(file => file !== absent);
    await assert.rejects(inspectNpmTarball(await tarball(t, fixture), { name: 'quotern', version: '0.2.0' }, versions));
  }
  for (const dependency of ['workspace:*', 'file:../core', '0.1.8']) {
    const fixture = cliPackage();
    fixture.manifest.dependencies['quotern-core'] = dependency;
    await assert.rejects(inspectNpmTarball(await tarball(t, fixture), { name: 'quotern', version: '0.2.0' }, versions));
  }
});

test('package verification rejects stale identities, private packages and a broken bin mapping', async t => {
  for (const change of [{ name: 'quotern-dashboard' }, { version: '0.1.0' }, { private: true }, { bin: { quotern: './missing.js' } }]) {
    const fixture = cliPackage();
    Object.assign(fixture.manifest, change);
    await assert.rejects(inspectNpmTarball(await tarball(t, fixture), { name: 'quotern', version: '0.2.0' }, versions));
  }
});

test('first-publication smoke installs internal dependencies from tarballs without registry metadata', async t => {
  const cli = cliPackage();
  cli.manifest.type = 'module';
  cli.contents = { 'bin/quotern.js': "#!/usr/bin/env node\nimport 'quotern-core'; import 'quotern-i18n'; console.log('Quotern help');\n" };
  const fixtures = [
    { manifest: { name: 'quotern-core', version: '0.1.9', main: './dist/index.js' }, files: ['dist/index.js', 'dist/pricing/pricing.json'] },
    { manifest: { name: 'quotern-i18n', version: '0.1.2', main: './dist/index.js' }, files: ['dist/index.js', 'dist/quota.js'] },
    cli,
  ];
  const packages = [];
  for (const fixture of fixtures) packages.push({ name: fixture.manifest.name, version: fixture.manifest.version, archive: await tarball(t, fixture) });
  const previous = process.env.PNPM_CONFIG_OFFLINE;
  process.env.PNPM_CONFIG_OFFLINE = 'true';
  try {
    await smokeInstall(fileURLToPath(new URL('..', import.meta.url)), packages, false);
  } finally {
    if (previous === undefined) delete process.env.PNPM_CONFIG_OFFLINE;
    else process.env.PNPM_CONFIG_OFFLINE = previous;
  }
});

test('npm workflow publishes only after package checks and scopes credentials to publication', async () => {
  const workflow = yaml.load(await readFile(new URL('../.github/workflows/release-npm.yml', import.meta.url), 'utf8'));
  assert.deepEqual(workflow.on, { release: { types: ['published'] } });
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  const steps = workflow.jobs.publish.steps;
  const checkout = steps.find(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, '${{ github.sha }}');
  assert.equal(checkout.with['persist-credentials'], false);
  const check = steps.findIndex(step => step.run?.includes('check:npm-release'));
  const publish = steps.findIndex(step => step.name === 'Publish new npm package versions');
  assert(check >= 0 && publish > check);
  assert.equal(steps[publish].env.NODE_AUTH_TOKEN, '${{ secrets.NPM_TOKEN }}');
  assert.equal(steps.filter(step => JSON.stringify(step.env ?? {}).includes('secrets.NPM_TOKEN')).length, 1);
  for (const name of ['quotern', 'quotern-core', 'quotern-i18n']) assert(steps[publish].run.includes(`--filter ${name}`));
  assert.match(steps[publish].run, /--tag "\$NPM_DIST_TAG"/);
  const guard = steps[publish].run.indexOf('--check-latest');
  const upload = steps[publish].run.indexOf('-r publish');
  const promotion = steps[publish].run.indexOf('--promote-latest');
  assert(guard >= 0 && upload > guard && promotion > upload);
  assert.doesNotMatch(steps[publish].run, /--force|changeset publish/);
});
