import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';

import { writeNotifyScript } from './claude.js';
import { isCodexHooksJsonConfigured, upsertCodexHooksJson } from './codex-hooks-json.js';
import { codexConfigPath, codexNotifyOriginalPath } from '../paths.js';

function parseTomlStringArray(rhs: string): string[] | null {
  const trimmed = rhs.trim();
  if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return null;
  const inner = trimmed.slice(1, -1).trim();
  if (!inner) return [];

  const parts: string[] = [];
  let current = '';
  let inString = false;
  let quote: string | null = null;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i]!;
    if (!inString) {
      if (ch === '"' || ch === "'") {
        inString = true;
        quote = ch;
        current = '';
      }
      continue;
    }
    if (ch === quote) {
      parts.push(current);
      inString = false;
      quote = null;
      continue;
    }
    current += ch;
  }
  return parts.length > 0 ? parts : null;
}

function formatTomlStringArray(arr: string[]): string {
  return `[${arr.map((s) => JSON.stringify(String(s))).join(', ')}]`;
}

function findTomlArrayBlockEnd(lines: string[], startIndex: number, rhs: string): number {
  const first = rhs.trim();
  if (!first.startsWith('[')) return startIndex;

  let inString = false;
  let quote: string | null = null;
  let depth = 0;
  let sawOpen = false;

  function scanChunk(chunk: string): boolean {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i]!;
      if (!inString) {
        if (ch === '"' || ch === "'") {
          inString = true;
          quote = ch;
          continue;
        }
        if (ch === '[') {
          depth += 1;
          sawOpen = true;
          continue;
        }
        if (ch === ']') {
          depth -= 1;
          if (sawOpen && depth === 0) return true;
        }
        continue;
      }
      if (ch === quote) {
        inString = false;
        quote = null;
      }
    }
    return false;
  }

  if (scanChunk(first)) return startIndex;
  for (let j = startIndex + 1; j < lines.length; j++) {
    if (scanChunk(lines[j]!)) return j;
  }
  return startIndex;
}

function readTomlArrayLiteral(lines: string[], startIndex: number, rhs: string): string | null {
  const first = rhs.trim();
  if (!first.startsWith('[')) return null;

  let inString = false;
  let quote: string | null = null;
  let depth = 0;
  let sawOpen = false;

  function scanChunk(chunk: string): number {
    for (let i = 0; i < chunk.length; i++) {
      const ch = chunk[i]!;
      if (!inString) {
        if (ch === '"' || ch === "'") {
          inString = true;
          quote = ch;
          continue;
        }
        if (ch === '[') {
          depth += 1;
          sawOpen = true;
          continue;
        }
        if (ch === ']') {
          depth -= 1;
          if (sawOpen && depth === 0) return i;
        }
        continue;
      }
      if (ch === quote) {
        inString = false;
        quote = null;
      }
    }
    return -1;
  }

  const parts = [first];
  let endPos = scanChunk(first);
  if (endPos !== -1) return first.slice(0, endPos + 1).trim();

  for (let j = startIndex + 1; j < lines.length; j++) {
    const line = lines[j]!;
    endPos = scanChunk(line);
    if (endPos !== -1) {
      parts.push(line.slice(0, endPos + 1));
      return parts.join('\n').trim();
    }
    parts.push(line);
  }
  return null;
}

function extractNotify(text: string): string[] | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(/^\s*notify\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const rhs = (m[1] ?? '').trim();
    const literal = readTomlArrayLiteral(lines, i, rhs);
    if (!literal) continue;
    const parsed = parseTomlStringArray(literal);
    if (parsed) return parsed;
  }
  return null;
}

function setNotify(text: string, notifyCmd: string[]): string {
  const lines = text.split(/\r?\n/);
  const notifyLine = `notify = ${formatTomlStringArray(notifyCmd)}`;
  const out: string[] = [];
  let replaced = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const m = line.match(/^\s*notify\s*=\s*(.*)\s*$/);
    if (m) {
      if (!replaced) {
        out.push(notifyLine);
        replaced = true;
      }
      const rhs = (m[1] ?? '').trim();
      i = findTomlArrayBlockEnd(lines, i, rhs);
      continue;
    }
    out.push(line);
  }

  if (!replaced) {
    const firstTableIdx = out.findIndex((l) => /^\s*\[/.test(l));
    const headerIdx = firstTableIdx === -1 ? out.length : firstTableIdx;
    out.splice(headerIdx, 0, notifyLine);
  }

  return `${out.join('\n').replace(/\n+$/, '')}\n`;
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function buildCodexNotifyCmd(notifyPath: string): string[] {
  if (process.platform === 'win32') {
    return [notifyPath, '--source=codex'];
  }
  return ['/bin/bash', notifyPath, '--source=codex'];
}

/** Own tud notify argv (any generation) — must not be saved as "original" to chain. */
export function isOwnCodexNotifyCmd(notify: string[] | null): boolean {
  if (!notify || notify.length === 0) return false;
  const joined = notify.join(' ');
  return /notify\.(mjs|sh|cmd|ps1)/.test(joined) && joined.includes('--source=codex');
}

export function isLegacyCodexNotifyCmd(notify: string[] | null, notifyPath: string): boolean {
  if (!notify || notify.length !== 1) return false;
  const entry = notify[0] ?? '';
  return (
    /notify\.(mjs|sh|cmd)/.test(entry) &&
    (entry.includes('--source=codex') || entry.includes(notifyPath))
  );
}

async function upsertCodexNotify(notifyPath: string, dataDir: string): Promise<{ changed: boolean; configured: boolean }> {
  const configPath = codexConfigPath();
  if (!existsSync(configPath)) {
    return { changed: false, configured: false };
  }

  const notifyCmd = buildCodexNotifyCmd(notifyPath);
  const originalText = await readFile(configPath, 'utf8');
  const existingNotify = extractNotify(originalText) ?? [];
  const already = arraysEqual(existingNotify, notifyCmd);

  if (already) {
    return { changed: false, configured: true };
  }

  const notifyOriginalPath = codexNotifyOriginalPath(dataDir);
  if (
    existingNotify &&
    existingNotify.length > 0 &&
    !existsSync(notifyOriginalPath) &&
    !isOwnCodexNotifyCmd(existingNotify)
  ) {
    await mkdir(dirname(notifyOriginalPath), { recursive: true });
    await writeFile(
      notifyOriginalPath,
      `${JSON.stringify({ notify: existingNotify, capturedAt: new Date().toISOString() }, null, 2)}\n`,
      'utf8',
    );
  }

  const backupPath = `${configPath}.bak.${new Date().toISOString().replace(/[:.]/g, '-')}`;
  await copyFile(configPath, backupPath);
  await writeFile(configPath, setNotify(originalText, notifyCmd), 'utf8');
  return { changed: true, configured: true };
}

export async function isCodexNotifyConfigured(notifyPath: string): Promise<boolean> {
  const configPath = codexConfigPath();
  if (!existsSync(configPath)) return false;
  const text = await readFile(configPath, 'utf8');
  const notify = extractNotify(text) ?? [];
  return arraysEqual(notify, buildCodexNotifyCmd(notifyPath));
}

export async function isCodexHookConfigured(notifyPath: string): Promise<boolean> {
  const [notify, hooksJson] = await Promise.all([
    isCodexNotifyConfigured(notifyPath),
    isCodexHooksJsonConfigured(notifyPath),
  ]);
  return notify || hooksJson;
}

export async function setupCodexHook(
  dataDir: string,
): Promise<{ notifyPath: string; hookOk: boolean }> {
  const notifyPath = await writeNotifyScript(dataDir);
  let hookOk = false;
  try {
    const [notifyRes, hooksRes] = await Promise.all([
      upsertCodexNotify(notifyPath, dataDir),
      upsertCodexHooksJson(notifyPath),
    ]);
    hookOk = notifyRes.configured || hooksRes.configured;
  } catch {
    hookOk = false;
  }
  return { notifyPath, hookOk };
}
