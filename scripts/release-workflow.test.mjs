import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import yaml from 'js-yaml';
import { macosBuildEnvironment, macosTauriArgs } from './macos-release-policy.mjs';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
test('CI and release verification install fresh dependencies instead of restoring a global virtual store', async () => {
  for (const file of ['.github/workflows/ci.yml', '.github/workflows/release-desktop.yml']) {
    const workflow = yaml.load(await read(file));
    for (const [name, job] of Object.entries(workflow.jobs)) {
      for (const step of job.steps) {
        if (step.uses?.startsWith('actions/setup-node@')) assert.equal(step.with?.cache, undefined, `${file}: ${name} must not restore cached dependency graphs`);
        assert(!step.uses?.startsWith('actions/cache@'), `${file}: ${name} must install platform dependencies from a fresh store`);
      }
    }
  }
});

test('desktop releases default to verification and limit write access to explicit draft publication', async () => {
  const workflow = yaml.load(await read('.github/workflows/release-desktop.yml'));
  assert.equal(workflow.on.workflow_dispatch.inputs.publish.default, false);
  assert.equal(workflow.permissions.contents, 'read');
  const writes = Object.entries(workflow.jobs).filter(([, job]) => job.permissions?.contents === 'write');
  assert.equal(writes.length, 1);
  const [name, job] = writes[0];
  assert.equal(name, 'draft');
  for (const constraint of ['workflow_dispatch', 'inputs.publish', 'refs/tags/']) assert(job.if.includes(constraint));
  assert.deepEqual(job.needs, ['preflight', 'assemble']);
  const commands = job.steps.map(step => step.run ?? '').join('\n');
  assert.match(commands, /--draft/);
  assert.match(commands, /--notes-file "\$notes_file"/);
  assert.match(commands, /notes_file="\$GITHUB_WORKSPACE\/docs\/release-notes\/\$RELEASE_TAG\.md"/);
  assert.match(commands, /test -s "\$notes_file"/);
  assert.doesNotMatch(commands, /--generate-notes/);
  assert.doesNotMatch(commands, /--clobber|--draft=false|--draft false/);
  assert.deepEqual(workflow.jobs.assemble.needs, ['preflight', 'windows', 'macos', 'source']);
});

test('platform jobs verify before uploading and macOS always removes its temporary keychain', async () => {
  const workflow = yaml.load(await read('.github/workflows/release-desktop.yml'));
  for (const [name, command] of [['windows', 'release:desktop:win'], ['macos', 'release:desktop:mac']]) {
    const steps = workflow.jobs[name].steps;
    const verify = steps.findIndex(step => step.run?.includes(command));
    const upload = steps.findIndex(step => step.uses?.startsWith('actions/upload-artifact@'));
    assert(verify >= 0 && upload > verify, `${name} must verify before upload`);
    assert.equal(steps[upload].with['if-no-files-found'], 'error');
    assert(!steps[upload].with.path.trim().endsWith('/'), 'Upload explicit assets, not the entire unpacked directory');
  }
  const cleanup = workflow.jobs.macos.steps.find(step => step.name === 'Remove signing keychain');
  assert(cleanup.if.includes('always()'));
  assert.match(cleanup.run, /delete-keychain/);
  assert(workflow.jobs.source.steps.some(step => step.run?.includes('check:source-archive')));
});

test('ad-hoc workflow runs without Apple secrets and keeps signed selection explicit through assembly', async () => {
  const workflow = yaml.load(await read('.github/workflows/release-desktop.yml'));
  const selection = workflow.on.workflow_dispatch.inputs.macos_signing;
  assert.equal(selection.default, 'adhoc');
  assert.deepEqual(selection.options, ['adhoc', 'signed']);
  const signing = workflow.jobs.macos.steps.find(step => step.name === 'Import Developer ID certificate into a temporary keychain');
  assert(signing.if.includes("== 'signed'"));
  const cleanup = workflow.jobs.macos.steps.find(step => step.name === 'Remove signing keychain');
  assert(cleanup.if.includes("== 'signed'"));
  const preflight = workflow.jobs.preflight.steps.find(step => step.id === 'source');
  assert.equal(preflight.env.MACOS_MODE, "${{ inputs.macos_signing || 'adhoc' }}");
  assert.match(preflight.run, /--macos-mode/);
  const assemble = workflow.jobs.assemble.steps.find(step => step.name?.startsWith('Revalidate'));
  assert.match(assemble.run, /--macos-mode/);
  const mac = JSON.parse(await read('apps/desktop/package.json'));
  assert.match(mac.scripts['build:mac'], /--mode adhoc/);
  assert.match(mac.scripts['build:mac:signed'], /--mode signed/);
});

test('desktop packaging uses Tauri targets and does not directly publish', async () => {
  const desktop = JSON.parse(await read('apps/desktop/package.json'));
  for (const [name, command] of Object.entries(desktop.scripts)) {
    assert.doesNotMatch(command, /electron-builder|--publish\s+(?:always|onTag)/, name);
  }
  const config = JSON.parse(await read('apps/desktop/src-tauri/tauri.conf.json'));
  assert.deepEqual(config.bundle.targets, ['nsis', 'app', 'dmg']);
  assert.deepEqual(config.bundle.externalBin, ['binaries/quotern-node']);
  for (const [arch, target] of [['x64', 'x86_64-apple-darwin'], ['arm64', 'aarch64-apple-darwin']]) {
    for (const mode of ['adhoc', 'signed']) {
      const args = macosTauriArgs(mode, arch, 'Developer ID Application: Example');
      assert.deepEqual(args.slice(0, 5), ['bundle', '--target', target, '--bundles', 'app,dmg']);
      const bundle = JSON.parse(args[6]).bundle;
      assert.equal(bundle.macOS.signingIdentity, mode === 'adhoc' ? '-' : 'Developer ID Application: Example');
      assert.equal(bundle.createUpdaterArtifacts, mode === 'signed');
    }
  }
  assert.throws(() => macosTauriArgs('signed', 'x64', '-'));
  assert.throws(() => macosBuildEnvironment({}, 'signed'));
  const windows = await read('scripts/release-windows.mjs');
  assert.match(windows, /x86_64-pc-windows-msvc/);
  assert.match(windows, /aarch64-pc-windows-msvc/);
  assert.match(windows, /'--bundles','nsis'/);
  assert.match(windows, /Supply both updater signing keys/);
  for (const file of ['scripts/release-macos.mjs', 'scripts/release-windows.mjs', 'apps/desktop/scripts/run-tauri.mjs']) {
    assert.doesNotMatch(await read(file), /gh\s+release\s+(?:create|upload)|--publish\s+(?:always|onTag)/, file);
  }
});
