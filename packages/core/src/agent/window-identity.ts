import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { accountReference } from '../account-reference.js';
import { parseCodexCredentials } from '../quota/readers/codex-subscription.js';
import { classifyClaudeAuthStatus, hasCustomClaudeConfiguration } from '../quota/readers/claude-subscription.js';
import { windowsResumeScript } from '../session-actions.js';

const record = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const CODEX_WINDOW_CONFIG = ['-c', 'features.hooks=false', '-c', 'cli_auth_credentials_store="file"', '-c', 'forced_login_method="chatgpt"'];

/** Native executables must bypass Windows PowerShell's legacy empty-argument conversion. */
export function windowCommand(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, platform = process.platform) {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(executable)) return { executable, args };
  const script = windowsResumeScript(cwd, executable, args) + '; exit $LASTEXITCODE';
  return { executable: join(env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')] };
}

export async function stopWindowProcess(child: ReturnType<typeof spawn>): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null || !child.pid) return;
  await new Promise<void>(resolveStop => {
    child.once('close', () => resolveStop());
    if (process.platform === 'win32') execFile('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true }, () => resolveStop());
    else { child.kill(); }
  });
}

/** Bounded read-only probes. Never start a thread, refresh credentials or send a model request. */
async function probe(executable: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, rpc = false): Promise<unknown> {
  const launch = windowCommand(executable, args, cwd, env);
  return new Promise((resolveProbe, reject) => {
    const child = spawn(launch.executable, launch.args, { cwd, env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', bytes = 0, settled = false;
    const finish = (value?: unknown) => {
      if (settled) return; settled = true; clearTimeout(timer);
      void stopWindowProcess(child).then(() => { value === undefined ? reject(new Error('AGENT_IDENTITY_UNAVAILABLE')) : resolveProbe(value); });
    };
    const timer = setTimeout(() => finish(), 8000);
    const send = (message: object) => child.stdin.write(JSON.stringify(message) + '\n');
    child.once('error', () => finish()); child.stdin.on('error', () => finish());
    child.stderr.on('data', (chunk: Buffer) => { bytes += chunk.length; if (bytes > 256 * 1024) finish(); });
    child.stdout.on('data', (chunk: Buffer) => {
      bytes += chunk.length; if (bytes > 256 * 1024) return finish();
      output += chunk.toString('utf8');
      if (!rpc) return;
      for (let index = output.indexOf('\n'); index >= 0; index = output.indexOf('\n')) {
        const line = output.slice(0, index); output = output.slice(index + 1);
        try {
          const message = JSON.parse(line);
          if (message.error) { finish(); return; }
          if (message.id === 1) {
            send({ method: 'initialized', params: {} });
            send({ id: 2, method: 'config/read', params: { includeLayers: false, cwd } });
          } else if (message.id === 2) finish(message.result);
        } catch { finish(); return; }
      }
    });
    child.once('close', code => {
      if (rpc || code !== 0) return finish();
      try { finish(JSON.parse(output)); } catch { finish(); }
    });
    if (rpc) send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'quotern', version: '1.0.0' } } });
    else child.stdin.end();
  });
}

export function codexWindowIdentityMatches(configValue: unknown, authValue: unknown, expected: string, env: NodeJS.ProcessEnv): boolean {
  const config = record(configValue), auth = record(authValue), credentials = parseCodexCredentials(auth);
  const provider = config.model_provider ?? 'openai';
  if (provider !== 'openai' || config.profile || Object.keys(record(record(config.model_providers).openai)).length) return false;
  if (config.chatgpt_base_url || config.openai_base_url || config.forced_login_method !== 'chatgpt' || config.cli_auth_credentials_store !== 'file') return false;
  if (Object.entries(env).some(([key, value]) => /^(OPENAI_API_KEY|OPENAI_BASE_URL|CODEX_API_KEY|CODEX_AUTH_TOKEN|CODEX_CHATGPT_BASE_URL)$/i.test(key) && value?.trim())) return false;
  return auth.auth_mode === 'chatgpt' && !credentials.unsupported && Boolean(credentials.accessToken && credentials.accountId)
    && (credentials.expiresAt === null || credentials.expiresAt > Date.now()) && accountReference('openai', credentials.accountId) === expected;
}

export async function verifyWindowIdentity(provider: 'claude' | 'codex', expected: string, executable: string, cwd: string, env: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    if (provider === 'claude') {
      if (hasCustomClaudeConfiguration(env)) return false;
      const auth = record(await probe(executable, ['auth', 'status', '--json'], cwd, env));
      const org = auth.orgId ?? auth.organizationId;
      return classifyClaudeAuthStatus(auth) === 'official' && typeof auth.email === 'string' && typeof org === 'string'
        && accountReference('anthropic', [auth.email.toLowerCase(), org]) === expected;
    }
    const raw = env.CODEX_HOME?.trim();
    const directory = !raw ? join(homedir(), '.codex') : raw === '~' ? homedir() : raw.startsWith('~/') ? join(homedir(), raw.slice(2)) : resolve(raw);
    const auth = JSON.parse(await readFile(join(directory, 'auth.json'), 'utf8'));
    const result = record(await probe(executable, ['app-server', ...CODEX_WINDOW_CONFIG], cwd, env, true));
    return codexWindowIdentityMatches(result.config, auth, expected, env);
  } catch { return false; }
}
