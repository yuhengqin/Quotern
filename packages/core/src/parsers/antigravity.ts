import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { readFile, stat } from 'node:fs/promises';

import type { CursorsFile, QueueBucket, TokenTotals } from '../types.js';
import { geminiHome } from '../paths.js';
import { toUtcHalfHourStart } from '../queue/keys.js';
import {
  accumulateBucket,
  bucketsFromState,
  type BucketAccumulator,
} from './shared.js';

/** Legacy / standalone Antigravity app under `~/.gemini/antigravity`. */
export const ANTIGRAVITY_COLLECTOR_APP = 'antigravity-app';
/** Desktop / IDE under `~/.gemini/antigravity-ide`. */
export const ANTIGRAVITY_COLLECTOR_IDE = 'antigravity-ide';
/** CLI (`agy`) under `~/.gemini/antigravity-cli`. */
export const ANTIGRAVITY_COLLECTOR_CLI = 'antigravity-cli';

const VARIANT_DIRS = [
  { dir: 'antigravity-cli', collector: ANTIGRAVITY_COLLECTOR_CLI },
  { dir: 'antigravity-ide', collector: ANTIGRAVITY_COLLECTOR_IDE },
  { dir: 'antigravity', collector: ANTIGRAVITY_COLLECTOR_APP },
] as const;

export function resolveAntigravityBrainDirs(home = geminiHome()): string[] {
  return VARIANT_DIRS.map((v) => join(home, v.dir, 'brain'));
}

/** Infer collector from absolute transcript path (cli/ide before bare antigravity). */
export function antigravityCollectorForPath(filePath: string): string {
  const normalized = filePath.split(/[/\\]/).join('/');
  if (normalized.includes('/antigravity-cli/')) return ANTIGRAVITY_COLLECTOR_CLI;
  if (normalized.includes('/antigravity-ide/')) return ANTIGRAVITY_COLLECTOR_IDE;
  return ANTIGRAVITY_COLLECTOR_APP;
}

/** Session uuid folder under brain/<uuid>/.system_generated/logs/transcript.jsonl */
export function antigravityProjectFromPath(filePath: string): string {
  // …/brain/<session>/.system_generated/logs/transcript.jsonl → 3 parents up from file
  let dir = dirname(filePath); // logs
  dir = dirname(dir); // .system_generated
  dir = dirname(dir); // session uuid
  const name = basename(dir);
  return name && name !== 'brain' ? name : 'unknown';
}

export function listAntigravitySessionFiles(brainDir: string): string[] {
  const out: string[] = [];
  if (!brainDir || !existsSync(brainDir)) return out;
  let entries;
  try {
    entries = readdirSync(brainDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const transcriptPath = join(
      brainDir,
      entry.name,
      '.system_generated',
      'logs',
      'transcript.jsonl',
    );
    if (existsSync(transcriptPath)) out.push(transcriptPath);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

export function listAntigravityTranscripts(home = geminiHome()): string[] {
  return resolveAntigravityBrainDirs(home).flatMap((dir) => listAntigravitySessionFiles(dir));
}

export function isCjkCodePoint(code: number | undefined): boolean {
  if (code == null) return false;
  return (
    (code >= 0x3400 && code <= 0x4dbf) ||
    (code >= 0x4e00 && code <= 0x9fff) ||
    (code >= 0x3040 && code <= 0x30ff)
  );
}

/** CJK ≈ 1 token/char; other ≈ ceil(len/4). Upper-bound estimate (no cache discount). */
export function estimateAntigravityTokens(text: string): number {
  if (typeof text !== 'string' || text.length === 0) return 0;
  let cjk = 0;
  let other = 0;
  for (const ch of text) {
    if (isCjkCodePoint(ch.codePointAt(0))) cjk += 1;
    else other += 1;
  }
  return cjk + Math.ceil(other / 4);
}

function antigravityValueTokens(value: unknown): number {
  if (typeof value === 'string') return estimateAntigravityTokens(value);
  if (value == null) return 0;
  try {
    return estimateAntigravityTokens(JSON.stringify(value));
  } catch {
    return 0;
  }
}

export function antigravityContextTokens(event: {
  type?: string;
  content?: unknown;
  tool_calls?: unknown;
}): number {
  if (!event || typeof event !== 'object') return 0;
  let tokens = antigravityValueTokens(event.content);
  if (event.type === 'PLANNER_RESPONSE' && event.tool_calls) {
    tokens += antigravityValueTokens(event.tool_calls);
  }
  return tokens;
}

export function normalizeAntigravityTranscriptModel(modelName: string | null | undefined): string | null {
  if (!modelName || typeof modelName !== 'string') return null;
  let slug = modelName
    .trim()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(thinking|xhigh|high|medium|low|fast)\b/gi, ' ')
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (!slug) return null;

  for (const marker of ['gemini', 'claude', 'gpt']) {
    const idx = slug.indexOf(marker);
    if (idx >= 0) {
      slug = slug.slice(idx);
      break;
    }
  }
  if (/^(gemini|claude|gpt)-/.test(slug)) return slug;
  return `antigravity-${slug}`;
}

export function parseAntigravityModelSelection(content: string): string | null {
  if (!content) return null;
  const match = content.match(
    /changed setting `Model Selection` from .*? to ([^`\n]+?)(?:\s*\([^)]*\))?\.(?:\s+|$)/i,
  );
  if (!match?.[1]) return null;
  return normalizeAntigravityTranscriptModel(match[1]);
}

async function readAntigravityDefaultModel(filePath: string): Promise<string | null> {
  try {
    // …/antigravity-cli/brain/<uuid>/.system_generated/logs/transcript.jsonl → 5 up
    let dir = filePath;
    for (let i = 0; i < 5; i++) dir = dirname(dir);
    const raw = await readFile(join(dir, 'settings.json'), 'utf8');
    const settings = JSON.parse(raw) as { model?: string };
    if (settings.model && typeof settings.model === 'string') {
      return normalizeAntigravityTranscriptModel(settings.model);
    }
  } catch {
    // ignore
  }
  return null;
}

interface FileParseResult {
  lastLine: number;
  eventsAggregated: number;
  contextTokens: number;
  previousContextTokens: number;
  currentModel: string | null;
}

async function parseAntigravityFile(opts: {
  filePath: string;
  lastLine: number;
  initialContextTokens: number;
  initialPrevContext: number;
  initialModel: string | null;
  sinceMs: number;
  collector: string;
  project: string;
  bucketState: BucketAccumulator;
}): Promise<FileParseResult> {
  const {
    filePath,
    lastLine,
    initialContextTokens,
    initialPrevContext,
    initialModel,
    sinceMs,
    collector,
    project,
    bucketState,
  } = opts;

  let raw = '';
  try {
    raw = await readFile(filePath, 'utf8');
  } catch {
    raw = '';
  }
  if (!raw.trim()) {
    return {
      lastLine: 0,
      eventsAggregated: 0,
      contextTokens: 0,
      previousContextTokens: 0,
      currentModel: null,
    };
  }

  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const canResume = Number.isFinite(lastLine) && lastLine > 0 && lastLine <= lines.length;
  const cachedTokens = Number.isFinite(initialContextTokens) ? initialContextTokens : 0;
  const cachedPrev = Number.isFinite(initialPrevContext) ? initialPrevContext : 0;
  const cachedModel = typeof initialModel === 'string' ? initialModel : null;
  const resumed = canResume && (cachedTokens > 0 || cachedModel !== null);
  const scanStart = resumed ? lastLine : 0;

  let currentModel = resumed ? cachedModel : null;
  if (!currentModel) {
    currentModel = await readAntigravityDefaultModel(filePath);
  }
  let contextTokens = resumed ? cachedTokens : 0;
  let previousContextTokens = resumed ? cachedPrev : 0;
  let lastCompletedLine = Math.min(Number.isFinite(lastLine) ? lastLine : 0, lines.length);
  let eventsAggregated = 0;

  for (let i = scanStart; i < lines.length; i++) {
    const line = lines[i]!;
    let parsed: {
      type?: string;
      created_at?: string;
      content?: unknown;
      thinking?: unknown;
      tool_calls?: unknown;
    };
    try {
      parsed = JSON.parse(line) as typeof parsed;
    } catch {
      // Partial / corrupt line at the append frontier: stop so next sync retries.
      if (i >= lastLine) break;
      continue;
    }

    const isNewEvent = i >= lastLine;

    if (parsed.type === 'USER_INPUT' || parsed.type === 'USER_SETTINGS_CHANGE') {
      const content = typeof parsed.content === 'string' ? parsed.content : '';
      const model = parseAntigravityModelSelection(content);
      if (model) currentModel = model;
    }

    const eventContextTokens = antigravityContextTokens(parsed);

    if (!isNewEvent) {
      contextTokens += eventContextTokens;
      lastCompletedLine = i + 1;
      continue;
    }

    const timestamp = parsed.created_at;
    if (!timestamp) {
      contextTokens += eventContextTokens;
      lastCompletedLine = i + 1;
      continue;
    }

    const hourStart = toUtcHalfHourStart(timestamp);
    if (!hourStart) {
      contextTokens += eventContextTokens;
      lastCompletedLine = i + 1;
      continue;
    }

    if (parsed.type !== 'PLANNER_RESPONSE') {
      contextTokens += eventContextTokens;
      lastCompletedLine = i + 1;
      continue;
    }

    const content = typeof parsed.content === 'string' ? parsed.content : '';
    const thinking = typeof parsed.thinking === 'string' ? parsed.thinking : '';
    const inputDelta = Math.max(0, contextTokens - previousContextTokens);
    const outputTokens =
      antigravityValueTokens(content) + antigravityValueTokens(parsed.tool_calls);
    const reasoningTokens = antigravityValueTokens(thinking);
    const total = inputDelta + outputTokens + reasoningTokens;

    if (total > 0 && new Date(hourStart).getTime() >= sinceMs) {
      const delta: TokenTotals = {
        input_tokens: inputDelta,
        output_tokens: outputTokens,
        cached_input_tokens: 0,
        cache_creation_input_tokens: 0,
        reasoning_output_tokens: reasoningTokens,
        total_tokens: total,
        conversation_count: 1,
      };
      accumulateBucket(
        bucketState,
        'antigravity',
        currentModel || 'antigravity-unknown',
        project,
        hourStart,
        delta,
        collector,
      );
      eventsAggregated += 1;
    }

    previousContextTokens = contextTokens;
    contextTokens += eventContextTokens;
    lastCompletedLine = i + 1;
  }

  return {
    lastLine: lastCompletedLine,
    eventsAggregated,
    contextTokens,
    previousContextTokens,
    currentModel,
  };
}

export interface ParseAntigravityResult {
  buckets: QueueBucket[];
  eventsParsed: number;
  filesProcessed: number;
  skipped?: boolean;
  error?: string;
}

export async function parseAntigravityIncremental(
  cursors: CursorsFile,
  statsSince: string,
): Promise<{ result: ParseAntigravityResult; cursors: CursorsFile }> {
  const sinceMs = new Date(statsSince).getTime();
  if (!cursors.antigravity) {
    cursors.antigravity = { files: {} };
  }
  const fileCursors = cursors.antigravity.files;
  const bucketState: BucketAccumulator = new Map();
  const files = listAntigravityTranscripts();

  let eventsParsed = 0;
  let filesProcessed = 0;

  for (const filePath of files) {
    const st = await stat(filePath).catch(() => null);
    if (!st?.isFile()) continue;

    const prev = fileCursors[filePath];
    const inode = st.ino || 0;
    const size = Number.isFinite(st.size) ? st.size : 0;
    const mtimeMs = Number.isFinite(st.mtimeMs) ? st.mtimeMs : 0;

    const unchanged =
      prev && prev.inode === inode && prev.size === size && prev.mtimeMs === mtimeMs;
    if (unchanged) {
      filesProcessed += 1;
      continue;
    }

    const sameFile = prev && prev.inode === inode;
    const lastLine = sameFile ? Number(prev.lastLine || 0) : 0;
    const initialContextTokens = sameFile ? Number(prev.contextTokens || 0) : 0;
    const initialPrevContext = sameFile ? Number(prev.previousContextTokens || 0) : 0;
    const initialModel =
      sameFile && typeof prev.currentModel === 'string' ? prev.currentModel : null;

    const collector = antigravityCollectorForPath(filePath);
    const project = antigravityProjectFromPath(filePath);

    const parsed = await parseAntigravityFile({
      filePath,
      lastLine,
      initialContextTokens,
      initialPrevContext,
      initialModel,
      sinceMs,
      collector,
      project,
      bucketState,
    });

    fileCursors[filePath] = {
      inode,
      size,
      mtimeMs,
      lastLine: parsed.lastLine,
      contextTokens: parsed.contextTokens,
      previousContextTokens: parsed.previousContextTokens,
      currentModel: parsed.currentModel,
    };

    eventsParsed += parsed.eventsAggregated;
    filesProcessed += 1;
  }

  return {
    result: {
      buckets: bucketsFromState(bucketState, 'antigravity'),
      eventsParsed,
      filesProcessed,
    },
    cursors,
  };
}
