export interface SessionResumeCommand {
  executable: string;
  args: string[];
}

const commands = new Map<string, readonly string[]>([
  ['codex', ['codex', 'resume']],
  ['claude', ['claude', '--resume']],
  ['opencode', ['opencode', '--session']],
  ['grok', ['grok', '--resume']],
  ['pi', ['pi', '--session']],
  ['zcode', ['zcode', '--resume']],
  ['antigravity', ['agy', '--conversation']],
]);

export function validSessionActionTarget(source: unknown, sessionId: unknown): source is string {
  return typeof source === 'string' && (commands.has(source) || source === 'dsh')
    && typeof sessionId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(sessionId);
}

/** Fixed executable/argv only; never interpret a displayed command as shell text. */
export function sessionResumeCommand(source: string, sessionId: string, context?: { sessionFile?: string | null; directory?: string | null; antigravityCli?: boolean }): SessionResumeCommand | null {
  const command = commands.get(source);
  if (!command || !validSessionActionTarget(source, sessionId) || source === 'pi' && !context?.sessionFile
    || source === 'antigravity' && !context?.antigravityCli) return null;
  const args = [...command.slice(1), source === 'pi' ? context!.sessionFile! : sessionId];
  if (source === 'zcode' && context?.directory) args.push('--cwd', context.directory);
  return { executable: command[0]!, args };
}

/** Display/copy only. Execution always uses the structured argv above. */
export function formatSessionResumeCommand(command: SessionResumeCommand, platform = process.platform): string {
  const safe = platform === 'win32' ? /^[A-Za-z0-9_./:\\-]+$/ : /^[A-Za-z0-9_./:-]+$/;
  const quote = (value: string) => safe.test(value) ? value
    : platform === 'win32' ? `'${value.replace(/'/g, "''")}'` : `'${value.replace(/'/g, `'"'"'`)}'`;
  return [command.executable, ...command.args].map(quote).join(' ');
}
