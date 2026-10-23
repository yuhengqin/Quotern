import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:http';
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
  assert.deepEqual(workflow.on.release, { types: ['published'] });
  assert.equal(workflow.on.workflow_dispatch.inputs.tag.required, true);
  assert.equal(workflow.on.workflow_dispatch.inputs.tag.type, 'string');
  assert.deepEqual(workflow.permissions, { contents: 'read' });
  assert.equal(workflow.concurrency['cancel-in-progress'], false);
  const steps = workflow.jobs.publish.steps;
  const checkout = steps.find(step => step.uses?.startsWith('actions/checkout@'));
  assert.equal(checkout.with.ref, '${{ steps.manual.outputs.commit || github.sha }}');
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

test('registry verification uses fixed workflow tooling and versions from the tagged package report', async () => {
  const workflow = yaml.load(await readFile(new URL('../.github/workflows/release-npm.yml', import.meta.url), 'utf8'));
  const step = workflow.jobs.publish.steps.find(step => step.name === 'Verify exact published versions from the public registry');
  assert.deepEqual(step.env, { RELEASE_VERIFIER_COMMIT: '${{ github.workflow_sha }}' });
  assert.match(step.run, /git show "\$\{RELEASE_VERIFIER_COMMIT\}:scripts\/npm-release\.mjs"/);
  assert.match(step.run, /git show "\$\{RELEASE_VERIFIER_COMMIT\}:scripts\/check-source-archive\.mjs"/);
  assert.match(step.run, /npm-packages\/npm-release\.json/);
  assert.match(step.run, /await smokeInstall\(process\.env\.GITHUB_WORKSPACE, report\.packages, true\)/);
  assert.match(step.run, /corepack pnpm --dir "\$tools" run verify/);
  assert.doesNotMatch(step.run, /publish --|--promote-latest|secrets\.|refs\/heads\/main/);
});

async function resolveManualRelease(t, { tag = 'v0.3.0', release = { ...request().release, published_at: '2026-10-23T00:00:00Z' }, ref = { object: { type: 'tag', sha: 'b'.repeat(40) } }, status = 200 } = {}) {
  const workflow = yaml.load(await readFile(new URL('../.github/workflows/release-npm.yml', import.meta.url), 'utf8'));
  const step = workflow.jobs.publish.steps.find(step => step.id === 'manual');
  assert(step, 'manual publication must resolve an existing published Release');
  assert.equal(step.if, "github.event_name == 'workflow_dispatch'");
  assert.equal(step.shell, 'node {0}');
  assert.equal(step.env.GH_TOKEN, '${{ github.token }}');
  const directory = await mkdtemp(join(tmpdir(), 'quotern-manual-npm-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const calls = [];
  const server = createServer((req, res) => {
    calls.push({ path: req.url, authorization: req.headers.authorization });
    const routes = {
      '/repos/owner/repo/releases/tags/v0.3.0': release,
      '/repos/owner/repo/git/ref/tags/v0.3.0': ref,
      ['/repos/owner/repo/git/tags/' + 'b'.repeat(40)]: { object: { type: 'commit', sha: 'a'.repeat(40) } },
    };
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(routes[req.url] ?? {}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const script = join(directory, 'resolve.cjs');
  const output = join(directory, 'output.txt');
  await writeFile(script, step.run);
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script], {
      env: { ...process.env, GITHUB_REPOSITORY: 'owner/repo', GITHUB_API_URL: 'http://127.0.0.1:' + server.address().port, GH_TOKEN: 'fixture-read-token', REQUESTED_TAG: tag, RUNNER_TEMP: directory, GITHUB_OUTPUT: output },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let text = '';
    child.stdout.on('data', chunk => { text += chunk; });
    child.stderr.on('data', chunk => { text += chunk; });
    child.once('error', reject);
    child.once('exit', code => resolve({ code, text }));
  });
  return {
    ...result, calls,
    output: await readFile(output, 'utf8').catch(() => ''),
    event: await readFile(join(directory, 'npm-release-event.json'), 'utf8').then(JSON.parse).catch(() => null),
  };
}

test('manual publication authenticates an existing Release and pins its peeled tag commit', async t => {
  const result = await resolveManualRelease(t);
  assert.equal(result.code, 0, result.text);
  assert.equal(result.output, 'tag=v0.3.0\ncommit=' + 'a'.repeat(40) + '\n');
  assert.deepEqual(result.event, { action: 'published', release: { ...request().release, published_at: '2026-10-23T00:00:00Z' } });
  assert.equal(result.calls.length, 3);
  assert(result.calls.every(call => call.authorization === 'Bearer fixture-read-token'));
  const workflow = yaml.load(await readFile(new URL('../.github/workflows/release-npm.yml', import.meta.url), 'utf8'));
  const preflight = workflow.jobs.publish.steps.find(step => step.id === 'source');
  assert.equal(preflight.env.MANUAL_RELEASE_TAG, '${{ steps.manual.outputs.tag }}');
  assert.equal(preflight.env.MANUAL_RELEASE_COMMIT, '${{ steps.manual.outputs.commit }}');
  for (const binding of ['GITHUB_EVENT_NAME=release', 'GITHUB_EVENT_PATH=', 'GITHUB_REF=', 'GITHUB_SHA=']) assert(preflight.run.includes(binding));
  assert(preflight.run.includes('node scripts/npm-release.mjs --preflight'));
});

test('manual publication rejects invalid tags, unpublished Releases, API failures and invalid commit references', async t => {
  for (const fixture of [
    { tag: '../main' },
    { release: { ...request().release, published_at: '2026-10-23T00:00:00Z', draft: true } },
    { release: { ...request().release, published_at: null } },
    { release: { ...request().release, published_at: '2026-10-23T00:00:00Z', tag_name: 'v9.9.9' } },
    { status: 403 },
    { ref: { object: { type: 'tree', sha: 'a'.repeat(40) } } },
    { ref: { object: { type: 'commit', sha: 'not-a-commit' } } },
  ]) {
    const result = await resolveManualRelease(t, fixture);
    assert.notEqual(result.code, 0, JSON.stringify(fixture));
    assert.equal(result.output, '');
    assert.equal(result.event, null);
    if (fixture.tag) assert.equal(result.calls.length, 0);
  }
});
