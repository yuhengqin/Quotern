export interface SessionResumeCommand {
  executable: string;
  args: string[];
}

const commands = new Map<string, readonly string[]>([
  ['codex', ['codex', 'resume']],
  ['claude', ['claude', '--resume']],
  ['opencode', ['opencode', '--session']],
  ['grok', ['grok', '--resume']],
]);

export function validSessionActionTarget(source: unknown, sessionId: unknown): source is string {
  return typeof source === 'string' && (commands.has(source) || source === 'dsh')
    && typeof sessionId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$/.test(sessionId);
}

/** Fixed executable/argv only; never interpret a displayed command as shell text. */
export function sessionResumeCommand(source: string, sessionId: string): SessionResumeCommand | null {
  const command = commands.get(source);
  return command && validSessionActionTarget(source, sessionId)
    ? { executable: command[0]!, args: [...command.slice(1), sessionId] }
    : null;
}
