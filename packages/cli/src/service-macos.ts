import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

import { daemonLogPath, ensureDaemonLogDir, resolveServiceCommand } from './daemon.js';

export const MACOS_LABEL = 'dev.quotern.cli';

function macosPlistPathFor(label: string): string {
  return join(homedir(), 'Library', 'LaunchAgents', `${label}.plist`);
}

export function macosPlistPath(): string {
  return macosPlistPathFor(MACOS_LABEL);
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function defaultPath(nodePath: string): string {
  const parts = [
    dirname(nodePath),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ];
  return [...new Set(parts)].join(':');
}

export function buildMacosPlist(cliBinPath: string, dataDir: string): string {
  const { nodePath, args } = resolveServiceCommand(cliBinPath);
  const logPath = daemonLogPath(dataDir);
  const home = homedir();
  const programArgs = [nodePath, ...args]
    .map((a) => `    <string>${escapeXml(a)}</string>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${MACOS_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${programArgs}
  </array>
  <key>WorkingDirectory</key>
  <string>${escapeXml(home)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key>
    <string>${escapeXml(home)}</string>
    <key>PATH</key>
    <string>${escapeXml(defaultPath(nodePath))}</string>
  </dict>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${escapeXml(logPath)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(logPath)}</string>
</dict>
</plist>
`;
}

function uid(): string {
  return String(process.getuid?.() ?? 501);
}

function runLaunchctl(args: string[]): { ok: boolean; stderr: string } {
  const result = spawnSync('launchctl', args, { encoding: 'utf8' });
  const stderr = `${result.stderr ?? ''}${result.stdout ?? ''}`.trim();
  return { ok: result.status === 0, stderr };
}

export async function isMacosAutostartRegistered(): Promise<boolean> {
  return existsSync(macosPlistPath());
}

export async function registerMacosAutostart(cliBinPath: string, dataDir: string): Promise<void> {
  await ensureDaemonLogDir(dataDir);
  const plistPath = macosPlistPath();
  await mkdir(join(homedir(), 'Library', 'LaunchAgents'), { recursive: true });

  // Unload existing before rewrite so KeepAlive does not fight us.
  await unregisterMacosAutostart();

  await writeFile(plistPath, buildMacosPlist(cliBinPath, dataDir), 'utf8');

  const domain = `gui/${uid()}`;
  const service = `${domain}/${MACOS_LABEL}`;
  let loaded = runLaunchctl(['bootstrap', domain, plistPath]);
  if (!loaded.ok) {
    loaded = runLaunchctl(['load', '-w', plistPath]);
  }
  if (!loaded.ok) {
    throw new Error(`注册 macOS 自启失败: ${loaded.stderr || 'launchctl 返回非零'}`);
  }

  // bootstrap does not re-enable a previously disabled job.
  runLaunchctl(['enable', service]);
  // RunAtLoad should start it; -k kills any stale instance then starts fresh.
  runLaunchctl(['kickstart', '-k', service]);
}

async function unloadLaunchAgent(label: string): Promise<void> {
  const plistPath = macosPlistPathFor(label);
  const domain = `gui/${uid()}`;

  runLaunchctl(['bootout', `${domain}/${label}`]);
  runLaunchctl(['unload', plistPath]);

  if (existsSync(plistPath)) {
    try {
      await unlink(plistPath);
    } catch {
      // ignore
    }
  }
}

export async function unregisterMacosAutostart(): Promise<void> {
  await unloadLaunchAgent(MACOS_LABEL);
}
