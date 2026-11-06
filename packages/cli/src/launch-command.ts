import { resolve } from 'node:path';
import { resolveDataDir } from 'quotern-core/paths';
import { launchAccountTerminal, resolveLaunchProfile, validLaunchProfileId, validLaunchProvider } from 'quotern-core/quota/account-launch';

export const LAUNCH_HELP = 'quotern launch claude|codex [--profile ID] [--runtime cli|desktop] [--cwd DIR] [--data-dir DIR] [-- CLI_ARGS...]';
export function parseLaunchArgs(args: string[]) {
  if (!args.length || args[0] === '--help' || args[0] === '-h') return null;
  const provider = args[0]; if (!validLaunchProvider(provider)) throw new Error(LAUNCH_HELP);
  let dataDir = resolveDataDir(), cwd = process.cwd(), profileId: string | undefined, runtime: 'cli' | 'desktop' | undefined;
  const cliArgs: string[] = [], seen = new Set<string>();
  for (let i = 1; i < args.length; i++) {
    const flag = args[i]!;
    if (flag === '--') { cliArgs.push(...args.slice(i + 1)); break; }
    if (!['--profile', '--runtime', '--cwd', '--data-dir'].includes(flag) || seen.has(flag) || !args[i + 1] || args[i + 1]!.startsWith('--')) throw new Error(LAUNCH_HELP);
    seen.add(flag); const value = args[++i]!;
    if (flag === '--profile') { if (!validLaunchProfileId(value)) throw new Error(LAUNCH_HELP); profileId = value; }
    if (flag === '--runtime') { if (value !== 'cli' && value !== 'desktop') throw new Error(LAUNCH_HELP); runtime = value; }
    if (flag === '--cwd') cwd = resolve(value);
    if (flag === '--data-dir') dataDir = resolve(value);
  }
  return { provider, dataDir, cwd, profileId, runtime, cliArgs };
}
export async function runLaunchCommand(args: string[]) {
  const parsed = parseLaunchArgs(args);
  if (!parsed) { console.log(LAUNCH_HELP); return; }
  const profile = await resolveLaunchProfile(parsed.dataDir, parsed.provider, parsed);
  await launchAccountTerminal(parsed.provider, profile, parsed.cwd, parsed.cliArgs);
}
