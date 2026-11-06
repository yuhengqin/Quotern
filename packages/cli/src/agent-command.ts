import { resolve } from 'node:path';
import { resolveDataDir } from 'quotern-core/paths';
import { readAgentPreferences, patchAgentPreferences, integrationStatus, setIntegrationInstalled, prepareClaudePlugin } from 'quotern-core';

export async function runAgentCommand(args: string[]) {
  const usage = 'quotern agent status | set <feature> on|off | install|uninstall claude|codex | plugin [--data-dir DIR] [--config-dir DIR]';
  let dataDir = resolveDataDir(), directory: string | undefined;
  const words: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--data-dir' || args[i] === '--config-dir') { const flag = args[i]; if (!args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error(usage); const path = resolve(args[++i]!); if (flag === '--data-dir') dataDir = path; else directory = path; }
    else words.push(args[i]!);
  }
  if (!words.length || words.includes('--help') || words.includes('-h')) { console.log(usage); return; }
  if (words[0] === 'set' && words.length === 3 && ['on', 'off'].includes(words[2]!)) await patchAgentPreferences(dataDir, { [words[1]!]: words[2] === 'on' });
  else if (['install', 'uninstall'].includes(words[0]!) && words.length === 2 && ['claude', 'codex'].includes(words[1]!)) await setIntegrationInstalled(dataDir, words[1] as 'claude' | 'codex', words[0] === 'install', { directory });
  else if (words[0] === 'plugin' && words.length === 1) { console.log(JSON.stringify(await prepareClaudePlugin(dataDir), null, 2)); return; }
  else if (words[0] !== 'status' || words.length !== 1) throw new Error(usage);
  console.log(JSON.stringify({ preferences: await readAgentPreferences(dataDir), agents: await integrationStatus(dataDir) }, null, 2));
}
