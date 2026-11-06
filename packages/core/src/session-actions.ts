import { spawn } from 'node:child_process';
import { access, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, isAbsolute, join, relative, sep, win32 } from 'node:path';
import type { SessionResumeCommand } from './session-resume.js';

export interface SessionActionRuntime {
  openDirectory(directory: string): Promise<void>;
  resume(directory: string, command: SessionResumeCommand): Promise<void>;
  resumeAvailability?(directory: string, command: SessionResumeCommand): Promise<'available' | 'SESSION_CLI_UNAVAILABLE' | 'SESSION_ACTION_UNSUPPORTED'>;
}

export async function existingSessionDirectory(directory: string | null): Promise<string | null> {
  if (!directory || !isAbsolute(directory) || /[\u0000-\u001f\u007f]/.test(directory)) return null;
  try {
    const resolved = await realpath(directory);
    return (await stat(resolved)).isDirectory() ? resolved : null;
  } catch { return null; }
}

/** Deliberately omit implicit cwd lookup, relative PATH entries and project-local shims. */
export async function findSessionExecutable(name: string, directory: string, env = process.env): Promise<string | null> {
  const resolvedDirectory = await existingSessionDirectory(directory);
  if (!resolvedDirectory) return null;
  const insideProject = (path: string) => [directory, resolvedDirectory].some(root => {
    const child = relative(root, path);
    return child === '' || child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
  });
  const entries = (env.PATH ?? env.Path ?? '').split(delimiter);
  for (const entry of entries) {
    const path = entry.replace(/^"(.*)"$/, '$1');
    if (!isAbsolute(path) || insideProject(path)) continue;
    let resolved: string;
    try { resolved = await realpath(path); } catch { continue; }
    if (insideProject(resolved)) continue;
    for (const suffix of process.platform === 'win32' ? ['.exe', '.cmd', '.bat'] : ['']) {
      const executable = join(resolved, name + suffix);
      try {
        if (!(await stat(executable)).isFile()) continue;
        if (insideProject(await realpath(executable))) continue;
        await access(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
        return executable;
      } catch { /* Try the next PATH installation. */ }
    }
  }
  return null;
}

const psLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;
const psEncoded = (script: string) => Buffer.from(script, 'utf16le').toString('base64');

export type TerminalBindings = Record<string, string | null>;
function checkedBindings(bindings: TerminalBindings): [string, string | null][] {
  const entries = Object.entries(bindings);
  if (entries.some(([key, value]) => !/^[A-Z_][A-Z0-9_]*$/.test(key) || value !== null && (typeof value !== 'string' || /[\u0000\r\n]/.test(value)))) throw new Error('SESSION_ACTION_LAUNCH_FAILED');
  return entries;
}
export function windowsResumeScript(directory: string, executable: string, args: readonly string[], bindings: TerminalBindings = {}): string {
  const environment = checkedBindings(bindings).map(([key, value]) => `$env:${key} = ${value === null ? '$null' : psLiteral(value)}; `).join('');
  const setup = `$ErrorActionPreference = 'Stop'; Set-Location -LiteralPath ${psLiteral(directory)}; ${environment}`;
  const values = [executable, ...args];
  if (values.some(value => /[\u0000\r\n]/.test(value))) throw new Error('SESSION_ACTION_LAUNCH_FAILED');
  // Build the exact native command line; Windows PowerShell's legacy argument
  // binder otherwise drops empty arguments and embedded double quotes.
  const nativeArgument = (value: string) => '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
  const processScript = (file: string, argumentLine: string) => `$launchInfo = [System.Diagnostics.ProcessStartInfo]::new(); $launchInfo.FileName = ${psLiteral(file)}; $launchInfo.Arguments = ${psLiteral(argumentLine)}; $launchInfo.UseShellExecute = $false; $launchInfo.WorkingDirectory = ${psLiteral(directory)}; $launchProcess = [System.Diagnostics.Process]::Start($launchInfo); $launchProcess.WaitForExit(); $global:LASTEXITCODE = $launchProcess.ExitCode; $launchProcess.Dispose()`;
  if (!/\.(cmd|bat)$/i.test(executable)) return setup + processScript(executable, args.map(nativeArgument).join(' '));
  // A shim's %* is parsed by cmd a second time. Protect metacharacters for both
  // passes, and substitute slots once to keep literal %NAME% from expanding.
  const meta = /([()\][%!^"`<>&|;, *?])/g;
  const encoded = [executable, ...args.map(value => nativeArgument(value).replace(meta, '^$1').replace(meta, '^$1'))];
  const slots = encoded.map((_, index) => `QUOTERN_SESSION_LAUNCH_${index}`);
  const assignments = slots.map((slot, index) => `$env:${slot} = ${psLiteral(encoded[index]!)}`).join('; ');
  const command = `""%${slots[0]}%" ${slots.slice(1).map(slot => `%${slot}%`).join(' ')}"`;
  const cmd = win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe');
  const cleanup = slots.map(slot => `$env:${slot} = $null`).join('; ');
  return setup + `${assignments}; try { ${processScript(cmd, '/d /v:off /s /c ' + command)} } finally { ${cleanup} }`;
}

interface Launch {
  executable: string;
  args: string[];
  waitForExit?: boolean;
  env?: NodeJS.ProcessEnv;
}

function terminalEnvironment(inherited: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...inherited };
  const value = (name: string) => Object.entries(inherited).find(([key]) => key.toUpperCase() === name)?.[1];
  // These are hints for the noninteractive service, not the newly created TTY.
  // Keep credentials, Agent configuration and the parent environment unchanged.
  for (const key of Object.keys(env)) if (['TERM', 'COLORTERM', 'NO_COLOR', 'FORCE_COLOR', 'CLICOLOR', 'CLICOLOR_FORCE', 'CI'].includes(key.toUpperCase())) delete env[key];
  const term = value('TERM')?.trim();
  env.TERM = !term || /^(dumb|unknown)$/i.test(term) ? 'xterm-256color' : term;
  env.COLORTERM = value('COLORTERM')?.trim() || 'truecolor';
  return env;
}

const terminalScript = `on run argv
  set commandText to "cd " & quoted form of (item 1 of argv) & " && "
  repeat with i from 2 to count of argv
    set commandText to commandText & quoted form of (item i of argv) & " "
  end repeat
  tell application "Terminal"
    activate
    do script commandText
  end tell
end run`;

export function sessionTerminalLaunch(directory: string, executable: string, args: readonly string[], platform = process.platform, env = process.env, bindings: TerminalBindings = {}): Launch {
  const interactiveEnv = terminalEnvironment(env);
  const entries = checkedBindings(bindings);
  for (const [key, value] of entries) { if (value === null) delete interactiveEnv[key]; else interactiveEnv[key] = value; }
  if (platform === 'win32') {
    const powershell = win32.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    // Start-Process gives the visible terminal fresh console handles; inheriting the
    // daemon's ignored stdio would leave an apparently empty, noninteractive window.
    const script = `$ErrorActionPreference = 'Stop'; Start-Process -FilePath ${psLiteral(powershell)} -ArgumentList '-NoLogo','-NoExit','-EncodedCommand',${psLiteral(psEncoded(windowsResumeScript(directory, executable, args, bindings)))} -WorkingDirectory ${psLiteral(directory)} -WindowStyle Normal`;
    return { executable: powershell, args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', psEncoded(script)], waitForExit: true, env: interactiveEnv };
  }
  // Terminal.app runs a login shell, whose startup files may override the spawn
  // environment. Bind the selected account immediately before the CLI itself.
  const invocation = entries.length ? ['/usr/bin/env', ...entries.filter(([, value]) => value === null).flatMap(([key]) => ['-u', key]), ...entries.filter(([, value]) => value !== null).map(([key, value]) => `${key}=${value}`), executable, ...args] : [executable, ...args];
  if (platform === 'darwin') return { executable: '/usr/bin/osascript', args: ['-e', terminalScript, '--', directory, ...invocation], waitForExit: true, env: interactiveEnv };
  if (platform === 'linux') return { executable: 'x-terminal-emulator', args: ['-e', '/bin/sh', '-c', 'cd -- "$1" || exit; shift; "$@"; exec "${SHELL:-/bin/sh}"', 'quotern-session', directory, ...invocation], env: interactiveEnv };
  throw new Error('SESSION_ACTION_UNSUPPORTED');
}

async function launch(command: Launch, directory: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd: directory, shell: false, windowsHide: Boolean(command.waitForExit),
      detached: !command.waitForExit, stdio: 'ignore',
      env: command.env,
    });
    const timer = command.waitForExit ? setTimeout(() => { child.kill(); reject(new Error('SESSION_ACTION_LAUNCH_FAILED')); }, 15_000) : undefined;
    child.once('error', () => { clearTimeout(timer); reject(new Error('SESSION_ACTION_LAUNCH_FAILED')); });
    if (command.waitForExit) child.once('close', code => {
      clearTimeout(timer);
      if (code === 0) resolve(); else reject(new Error('SESSION_ACTION_LAUNCH_FAILED'));
    });
    else child.once('spawn', () => { child.unref(); resolve(); });
  });
}

/** The executable has already been resolved outside the untrusted project. */
export async function launchResolvedTerminal(directory: string, executable: string, args: readonly string[], env: NodeJS.ProcessEnv, bindings: TerminalBindings = {}): Promise<void> {
  const terminal = sessionTerminalLaunch(directory, executable, args, process.platform, env, bindings);
  if (process.platform === 'linux') {
    const installed = await findSessionExecutable(terminal.executable, directory, env);
    if (!installed) throw new Error('SESSION_ACTION_UNSUPPORTED');
    terminal.executable = installed;
  }
  await launch(terminal, directory);
}

export const nativeSessionActions: SessionActionRuntime = {
  async resumeAvailability(directory, command) {
    if (!['win32', 'darwin', 'linux'].includes(process.platform)) return 'SESSION_ACTION_UNSUPPORTED';
    if (!await findSessionExecutable(command.executable, directory)) return 'SESSION_CLI_UNAVAILABLE';
    if (process.platform === 'linux' && !await findSessionExecutable('x-terminal-emulator', directory)) return 'SESSION_ACTION_UNSUPPORTED';
    return 'available';
  },
  async openDirectory(directory) {
    if (process.platform === 'win32') return launch({ executable: win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe'), args: [directory] }, directory);
    if (process.platform === 'darwin') return launch({ executable: '/usr/bin/open', args: ['--', directory], waitForExit: true }, directory);
    if (process.platform === 'linux') {
      const executable = await findSessionExecutable('xdg-open', directory);
      if (!executable) throw new Error('SESSION_ACTION_UNSUPPORTED');
      return launch({ executable, args: [directory], waitForExit: true }, directory);
    }
    throw new Error('SESSION_ACTION_UNSUPPORTED');
  },
  async resume(directory, command) {
    const executable = await findSessionExecutable(command.executable, directory);
    if (!executable) throw new Error('SESSION_CLI_UNAVAILABLE');
    const terminal = sessionTerminalLaunch(directory, executable, command.args);
    if (process.platform === 'linux') {
      const installed = await findSessionExecutable(terminal.executable, directory);
      if (!installed) throw new Error('SESSION_ACTION_UNSUPPORTED');
      terminal.executable = installed;
    }
    return launch(terminal, directory);
  },
};
