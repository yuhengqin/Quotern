import assert from 'node:assert/strict';
import test from 'node:test';

const outputDir = process.env.QUOTERN_CLI_TEST_DIST ?? '../dist';
const { buildMacosPlist } = await import(`${outputDir}/service-macos.js`);

test('LaunchAgent preserves the login language for system locale resolution', () => {
  assert.equal(typeof buildMacosPlist, 'function');
  const plist = buildMacosPlist('/opt/quotern/bin/quotern.js', '/tmp/quotern-test');
  assert.match(plist, /<key>EnvironmentVariables<\/key>/);
  assert.doesNotMatch(plist, /<key>(?:LANG|LC_ALL)<\/key>/);
});
