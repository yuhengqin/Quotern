import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import yaml from 'js-yaml';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
test('release verification installs fresh dependencies instead of restoring a global virtual store', async () => {
  const workflow = yaml.load(await read('.github/workflows/release-desktop.yml'));
  for (const [name, job] of Object.entries(workflow.jobs)) {
    for (const step of job.steps) {
      if (step.uses?.startsWith('actions/setup-node@')) assert.equal(step.with?.cache, undefined, `${name} must not restore cached dependency graphs`);
      assert(!step.uses?.startsWith('actions/cache@'), `${name} must install platform dependencies from a fresh store`);
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

test('all desktop packaging entries disable direct electron-builder publication', async () => {
  const desktop = JSON.parse(await read('apps/desktop/package.json'));
  for (const [name, command] of Object.entries(desktop.scripts)) {
    if (command.includes('electron-builder')) assert.match(command, /--publish never/, name);
    assert.doesNotMatch(command, /--publish always|--publish onTag/);
  }
  const config = yaml.load(await read('apps/desktop/electron-builder.yml'));
  assert.equal(config.mac.artifactName, '${productName}-${version}-mac-${arch}.${ext}');
  assert.deepEqual(config.mac.target.map(target => target.arch), [['arm64', 'x64'], ['arm64', 'x64']]);
  assert.equal(config.mac.forceCodeSigning, true);
  assert.equal(config.mac.type, 'distribution');
  assert.equal(config.mac.notarize, true);
  assert.equal(config.dmg.sign, true);
});
