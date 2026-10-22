import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import yaml from 'js-yaml';

const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
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
  assert.equal(cleanup.if, 'always()');
  assert.match(cleanup.run, /delete-keychain/);
  assert(workflow.jobs.source.steps.some(step => step.run?.includes('check:source-archive')));
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
