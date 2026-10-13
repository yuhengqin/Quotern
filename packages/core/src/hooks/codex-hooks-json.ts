import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

import { buildHookCommand } from './claude.js';
import { codexHooksJsonPath } from '../paths.js';

export const CODEX_HOOK_EVENTS = ['Stop'] as const;

interface HookEntry {
  hooks?: Array<{ type?: string; command?: string }>;
}

async function readJson(path: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, 'utf8')) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function isNotifyHookCommand(command: string | undefined, source = 'codex'): boolean {
  if (typeof command !== 'string') return false;
  if (!command.includes(`--source=${source}`)) return false;
  return /notify\.(mjs|sh|cmd|ps1)/.test(command);
}

function hasHook(entries: HookEntry[], command: string): boolean {
  for (const entry of entries) {
    for (const h of entry.hooks ?? []) {
      if (h.type === 'command' && h.command === command) return true;
    }
  }
  return false;
}

function pruneStaleNotifyHooks(entries: HookEntry[], keepCommand: string, source = 'codex'): HookEntry[] {
  const pruned = entries
    .map((entry) => ({
      hooks: (entry.hooks ?? []).filter(
        (h) => !(h.type === 'command' && isNotifyHookCommand(h.command, source) && h.command !== keepCommand),
      ),
    }))
    .filter((entry) => (entry.hooks ?? []).length > 0);
  return pruned.length === entries.length &&
    entries.every((entry, i) => (entry.hooks ?? []).length === (pruned[i]?.hooks ?? []).length)
    ? entries
    : pruned;
}

export async function upsertCodexHooksJson(
  notifyPath: string,
  events: readonly string[] = CODEX_HOOK_EVENTS,
): Promise<{ changed: boolean; configured: boolean }> {
  const settingsPath = codexHooksJsonPath();
  const hookCommand = buildHookCommand(notifyPath, 'codex');
  const existing = await readJson(settingsPath);
  const settings = existing ?? {};
  const hooks = (settings.hooks as Record<string, HookEntry[]>) ?? {};
  let changed = false;

  for (const event of events) {
    let entries = Array.isArray(hooks[event]) ? [...hooks[event]!] : [];
    const cleaned = pruneStaleNotifyHooks(entries, hookCommand, 'codex');
    if (cleaned !== entries) {
      entries = cleaned;
      changed = true;
    }
    if (hasHook(entries, hookCommand)) {
      hooks[event] = entries;
      continue;
    }
    entries.push({ hooks: [{ type: 'command', command: hookCommand }] });
    hooks[event] = entries;
    changed = true;
  }

  if (!changed) {
    return { changed: false, configured: events.every((e) => hasHook(hooks[e] ?? [], hookCommand)) };
  }

  settings.hooks = hooks;
  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
  return { changed: true, configured: true };
}

export async function isCodexHooksJsonConfigured(notifyPath: string): Promise<boolean> {
  const settingsPath = codexHooksJsonPath();
  const hookCommand = buildHookCommand(notifyPath, 'codex');
  const existing = await readJson(settingsPath);
  if (!existing?.hooks) return false;
  const hooks = existing.hooks as Record<string, HookEntry[]>;
  return CODEX_HOOK_EVENTS.every((event) => hasHook(hooks[event] ?? [], hookCommand));
}
