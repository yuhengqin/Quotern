import { writeFile } from 'node:fs/promises';
import { delimiter, join } from 'node:path';

export async function prepareQuotaCliFixture(directory, env) {
  const windows = process.platform === 'win32';
  const signedOut = join(directory, 'claude-signed-out');
  const program = join(directory, 'claude-fixture.cjs');
  const command = join(directory, windows ? 'claude-fixture.cmd' : 'claude-fixture');
  await writeFile(program, `
    const { existsSync } = require('node:fs');
    if (process.argv[2] === 'auth') {
      console.log(JSON.stringify({ loggedIn: !existsSync(${JSON.stringify(signedOut)}),
        authMethod: 'oauth_token', apiProvider: 'firstParty', subscriptionType: 'pro' }));
    } else if (process.argv[3] === '/usage') {
      console.log(JSON.stringify({ result: 'Current session: 37% used' }));
    } else {
      process.exitCode = 1;
    }
  `);
  await writeFile(command, windows
    ? `@echo off\r\n"${process.execPath}" "%~dp0claude-fixture.cjs" %*\r\n`
    : `#!/bin/sh\nexec "${process.execPath}" "${program}" "$@"\n`, { mode: 0o755 });

  // Keep the quota probes on the fixture and system binaries.
  for (const key of Object.keys(env)) {
    if (/^(?:path$|pnpm_home$|claude_|anthropic_|muse_cli_path$|gh_token$|github_token$|copilot_github_token$)/i.test(key)) delete env[key];
  }
  env.PATH = windows
    ? [join(env.SystemRoot, 'System32'), join(env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0')].join(delimiter)
    : '/usr/bin:/bin';
  env.CLAUDE_CLI_PATH = command;
  return signedOut;
}
