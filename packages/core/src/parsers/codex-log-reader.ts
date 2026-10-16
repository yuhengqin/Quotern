import { lstat, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { decompress as fzstdDecompress } from 'fzstd';

import { createJsonlLineReader, type JsonlLineReader } from './jsonl-tail.js';

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

export function logicalCodexPath(path: string): string {
  return path.endsWith('.jsonl.zst') ? path.slice(0, -'.zst'.length) : path;
}

function isErrno(error: unknown, code: string): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function isCodexLogPath(path: string): boolean {
  return path.endsWith('.jsonl') || path.endsWith('.jsonl.zst');
}

function counterpartPath(path: string): string | null {
  if (path.endsWith('.jsonl.zst')) return path.slice(0, -'.zst'.length);
  if (path.endsWith('.jsonl')) return `${path}.zst`;
  return null;
}

function isCompressedPath(path: string): boolean {
  return path.endsWith('.jsonl.zst');
}

function looksLikeJson(line: string): boolean {
  try {
    JSON.parse(line);
    return true;
  } catch {
    return false;
  }
}

function decodeLine(raw: Buffer): string | null {
  let end = raw.length;
  if (end > 0 && raw[end - 1] === CARRIAGE_RETURN) end -= 1;
  if (end === 0) return null;
  const line = raw.subarray(0, end).toString('utf8');
  if (!line.trim()) return null;
  return line;
}

async function visitDirectory(directory: string, files: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isErrno(error, 'ENOENT')) return;
    throw error;
  }

  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;

    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      await visitDirectory(path, files);
    } else if (entry.isFile() && isCodexLogPath(path)) {
      files.push(path);
    }
  }
}

export async function findCodexLogFiles(roots: readonly string[]): Promise<string[]> {
  const discovered: string[] = [];

  for (const root of roots) {
    let rootInfo;
    try {
      rootInfo = await lstat(root);
    } catch (error) {
      if (isErrno(error, 'ENOENT')) continue;
      throw error;
    }
    if (!rootInfo.isDirectory()) continue;
    await visitDirectory(root, discovered);
  }

  const preferredByLogicalPath = new Map<string, string>();
  for (const path of discovered) {
    const logicalPath = logicalCodexPath(path);
    const current = preferredByLogicalPath.get(logicalPath);
    if (
      current === undefined ||
      (isCompressedPath(current) && !isCompressedPath(path))
    ) {
      preferredByLogicalPath.set(logicalPath, path);
    }
  }

  return [...preferredByLogicalPath.values()].sort();
}

class ZstdJsonlLineReader implements JsonlLineReader {
  private offset: number;
  private partial = false;

  constructor(private readonly filePath: string, start: number) {
    this.offset = start;
  }

  get nextOffset(): number {
    return this.offset;
  }

  get pendingPartial(): boolean {
    return this.partial;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    const compressed = await readFile(this.filePath);
    const decoded = Buffer.from(fzstdDecompress(compressed));
    let carry = decoded.subarray(this.offset);
    let carryStart = this.offset;

    let searchFrom = 0;
    for (;;) {
      const index = carry.indexOf(NEWLINE, searchFrom);
      if (index === -1) break;
      const line = decodeLine(carry.subarray(searchFrom, index));
      searchFrom = index + 1;
      this.offset = carryStart + searchFrom;
      this.partial = false;
      if (line !== null) yield line;
    }
    if (searchFrom > 0) {
      carry = carry.subarray(searchFrom);
      carryStart += searchFrom;
    }

    let trailing = carry;
    if (trailing.length > 0 && trailing[trailing.length - 1] === CARRIAGE_RETURN) {
      trailing = trailing.subarray(0, trailing.length - 1);
    }
    const tail = trailing.toString('utf8');
    if (!tail.trim()) {
      this.offset = carryStart + carry.length;
      this.partial = false;
      return;
    }
    if (looksLikeJson(tail)) {
      this.offset = carryStart + carry.length;
      this.partial = false;
      yield tail;
      return;
    }
    this.offset = carryStart;
    this.partial = true;
  }
}

function createUnderlyingReader(filePath: string, start: number): JsonlLineReader {
  return isCompressedPath(filePath)
    ? new ZstdJsonlLineReader(filePath, start)
    : createJsonlLineReader(filePath, start);
}

class CodexLogLineReader implements JsonlLineReader {
  private reader: JsonlLineReader;
  private fallbackAttempted = false;
  private yieldedAnyLine = false;

  constructor(private readonly filePath: string, private readonly start: number) {
    this.reader = createUnderlyingReader(filePath, start);
  }

  get nextOffset(): number {
    return this.reader.nextOffset;
  }

  get pendingPartial(): boolean {
    return this.reader.pendingPartial;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    const initialReader = this.reader;
    try {
      for await (const line of initialReader) {
        this.yieldedAnyLine = true;
        yield line;
      }
    } catch (error) {
      const counterpart = counterpartPath(this.filePath);
      const canFallback =
        counterpart !== null &&
        !this.fallbackAttempted &&
        !this.yieldedAnyLine &&
        initialReader.nextOffset === this.start &&
        isErrno(error, 'ENOENT');
      if (!canFallback) throw error;

      this.fallbackAttempted = true;
      const fallbackReader = createUnderlyingReader(counterpart, this.start);
      this.reader = fallbackReader;
      for await (const line of fallbackReader) {
        this.yieldedAnyLine = true;
        yield line;
      }
    }
  }
}

export function createCodexLineReader(filePath: string, start = 0): JsonlLineReader {
  return new CodexLogLineReader(filePath, start);
}
