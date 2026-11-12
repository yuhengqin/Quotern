import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, delimiter, join, resolve, relative, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { agentDirectory, readAgentJson, writeAgentJson, agentTransaction } from './preferences.js';
import { agentHookScript } from './hook.js';

export type IntegratedAgent = 'claude' | 'codex';
interface Installed { target: string; handlers: Record<string, unknown>[] }
type Manifest = Partial<Record<IntegratedAgent, Installed>>;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function agentSettingsPath(agent: IntegratedAgent, directory?: string): string {
  const root = directory ?? (agent === 'claude' ? process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude') : process.env.CODEX_HOME || join(homedir(), '.codex'));
  return join(resolve(root), agent === 'claude' ? 'settings.json' : 'hooks.json');
}
function nodeExecutable(): string {
  if (/^node(?:\.exe)?$/i.test(basename(process.execPath))) return process.execPath;
  const name = process.platform === 'win32' ? 'node.exe' : 'node';
  const found = (process.env.PATH ?? '').split(delimiter).map(directory => join(directory, name)).find(file => existsSync(file));
  if (!found) throw new Error('AGENT_NODE_REQUIRED');
  return found;
}
const quote = (value: string) => `'${value.replace(/'/g, `'"'"'`)}'`;
export function integrationHandler(agent: IntegratedAgent, dataDir: string, node = nodeExecutable()): Record<string, unknown> {
  const args = [join(agentDirectory(dataDir), 'quotern-agent-hook.cjs'), resolve(dataDir), agent];
  if (agent === 'claude') return { type: 'command', command: node, args, timeout: 2 };
  const powershell = `& ${[node, ...args].map(value => "'" + value.replace(/'/g, "''") + "'").join(' ')}`;
  return { type: 'command', command: [node, ...args].map(quote).join(' '), commandWindows: `powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand ${Buffer.from(powershell, 'utf16le').toString('base64')}`, timeout: 2 };
}
export function transformIntegrationHooks(document: unknown, remove: Record<string, unknown>[], add?: Record<string, unknown>): Record<string, unknown> {
  if (!object(document) || document.hooks !== undefined && !object(document.hooks)) throw new Error('AGENT_INVALID_CONFIG');
  const hooks = { ...(document.hooks as Record<string, unknown> | undefined) };
  const matches = (handler: unknown) => object(handler) && remove.some(owned => handler.type === owned.type && handler.command === owned.command && JSON.stringify(handler.args) === JSON.stringify(owned.args) && handler.commandWindows === owned.commandWindows);
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups) || groups.some(group => !object(group) || !Array.isArray(group.hooks))) throw new Error('AGENT_INVALID_CONFIG');
    hooks[event] = groups.flatMap(group => {
      const kept = group.hooks.filter((handler: unknown) => !matches(handler));
      return kept.length ? [{ ...group, hooks: kept }] : [];
    });
  }
  if (add) for (const event of ['SessionStart', 'UserPromptSubmit', 'PermissionRequest', 'Stop', 'SessionEnd', ...(Array.isArray(add.args) && add.args.at(-1) === 'claude' ? ['PreToolUse', 'PostToolUse', 'PostToolUseFailure'] : [])]) {
    hooks[event] = [...(hooks[event] as unknown[] | undefined ?? []), { hooks: [add] }];
  }
  return { ...document, hooks };
}
export async function integrationStatus(dataDir: string) {
  const manifest = await readAgentJson<Manifest>(join(agentDirectory(dataDir), 'installed.json'), {});
  const result: Record<string, { installed: boolean; target: string; managed: boolean }> = {};
  for (const agent of ['claude', 'codex'] as const) {
    const entry = manifest[agent], target = entry?.target ?? agentSettingsPath(agent);
    let installed = false;
    if (entry) {
      try {
        const document = await readAgentJson<Record<string, unknown>>(target, {});
        const remaining = transformIntegrationHooks(document, entry.handlers);
        installed = JSON.stringify(document) !== JSON.stringify(remaining);
      } catch { /* Corrupt or changed config is not installed successfully. */ }
    }
    result[agent] = { installed, target, managed: !!entry };
  }
  return result;
}
export async function setIntegrationInstalled(dataDir: string, agent: IntegratedAgent, installed: boolean, options: { directory?: string; node?: string } = {}) {
  const ownDirectory = agentDirectory(dataDir), manifestPath = join(ownDirectory, 'installed.json');
  return agentTransaction(manifestPath, async () => {
    const manifest = await readAgentJson<Manifest>(manifestPath, {});
    const old = manifest[agent], target = old?.target ?? agentSettingsPath(agent, options.directory);
    if (old && options.directory && target !== agentSettingsPath(agent, options.directory)) throw new Error('AGENT_REMOVE_PREVIOUS_FIRST');
    const rel = relative(resolve(dataDir), target);
    if (process.env.QUOTERN_DEV_ISOLATED === '1' && (rel.startsWith('..') || isAbsolute(rel))) throw new Error('AGENT_ISOLATED_CONFIG_ONLY');
    if (!installed && !old) return integrationStatus(dataDir);
    return agentTransaction(target, async () => {
      const before = await readFile(target, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      let document: unknown;
      try { document = before === null ? {} : JSON.parse(before); } catch { throw new Error('AGENT_INVALID_CONFIG'); }
      const handler = installed ? integrationHandler(agent, dataDir, options.node) : undefined;
      const updated = transformIntegrationHooks(document, [...old?.handlers ?? [], ...(handler ? [handler] : [])], handler);
      if (installed) {
        await mkdir(ownDirectory, { recursive: true });
        await writeFile(join(ownDirectory, 'quotern-agent-hook.cjs'), agentHookScript(), { mode: 0o600 });
      }
      if (before !== await readFile(target, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; })) throw new Error('AGENT_CONFIG_CHANGED');
      if (before !== null) {
        const backups = join(ownDirectory, 'backups'); await mkdir(backups, { recursive: true });
        await writeFile(join(backups, `${agent}-${randomUUID()}.json`), before, { mode: 0o600, flag: 'wx' });
      }
      await writeAgentJson(target, updated);
      if (handler) manifest[agent] = { target, handlers: [handler] }; else delete manifest[agent];
      await writeAgentJson(manifestPath, manifest);
      return integrationStatus(dataDir);
    });
  });
}
