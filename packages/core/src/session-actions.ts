import { spawn } from 'node:child_process';
import { access, realpath, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, isAbsolute, join, relative, sep, win32 } from 'node:path';
import type { SessionResumeCommand } from './session-resume.js';

export interface SessionActionRuntime {
  openDirectory(directory: string): Promise<void>;
  resume(directory: string, command: SessionResumeCommand): Promise<void>;
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
  const insideProject = (path: string) => {
    const child = relative(directory, path);
    return child === '' || child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
  };
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

export function windowsResumeScript(directory: string, executable: string, args: readonly string[]): string {
  return `$ErrorActionPreference = 'Stop'; Set-Location -LiteralPath ${psLiteral(directory)}; & ${[executable, ...args].map(psLiteral).join(' ')}`;
}

interface Launch {
  executable: string;
  args: string[];
  waitForExit?: boolean;
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

export function sessionTerminalLaunch(directory: string, executable: string, args: readonly string[], platform = process.platform, env = process.env): Launch {
  if (platform === 'win32') {
    const powershell = win32.join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    // Start-Process gives the visible terminal fresh console handles; inheriting the
    // daemon's ignored stdio would leave an apparently empty, noninteractive window.
    const script = `$ErrorActionPreference = 'Stop'; Start-Process -FilePath ${psLiteral(powershell)} -ArgumentList '-NoLogo','-NoExit','-EncodedCommand',${psLiteral(psEncoded(windowsResumeScript(directory, executable, args)))} -WorkingDirectory ${psLiteral(directory)} -WindowStyle Normal`;
    return { executable: powershell, args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', psEncoded(script)], waitForExit: true };
  }
  if (platform === 'darwin') return { executable: '/usr/bin/osascript', args: ['-e', terminalScript, '--', directory, executable, ...args], waitForExit: true };
  if (platform === 'linux') return { executable: 'x-terminal-emulator', args: ['-e', '/bin/sh', '-c', 'cd -- "$1" || exit; shift; "$@"; exec "${SHELL:-/bin/sh}"', 'quotern-session', directory, executable, ...args] };
  throw new Error('SESSION_ACTION_UNSUPPORTED');
}

async function launch(command: Launch, directory: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command.executable, command.args, {
      cwd: directory, shell: false, windowsHide: Boolean(command.waitForExit),
      detached: !command.waitForExit, stdio: 'ignore',
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

export const nativeSessionActions: SessionActionRuntime = {
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
