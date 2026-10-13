/**
 * Byte-exact incremental reader for append-only JSONL logs.
 *
 * Parsers resume from a stored byte offset. Reading with readline and then
 * storing `stat().size` loses data: a scan that lands while an agent is
 * mid-write yields a truncated last "line" whose JSON.parse fails, yet the
 * cursor still jumps past those bytes, so the record is skipped forever once
 * the writer completes it. The same mismatch double-counts when the file grew
 * between stat and EOF.
 *
 * This reader reports the offset it actually consumed:
 * - lines terminated by `\n` are always committed;
 * - a trailing line without `\n` is only committed when it parses as JSON
 *   (a complete record whose newline has not landed yet, or a file the writer
 *   left unterminated); otherwise the cursor stops at its first byte so the
 *   next round re-reads it whole.
 */
import { createReadStream } from 'node:fs';

const NEWLINE = 0x0a;
const CARRIAGE_RETURN = 0x0d;

export interface JsonlTailResult {
  /** Byte offset just past the last committed line; store this as the cursor. */
  nextOffset: number;
  /** True when a trailing partial line was left for the next round. */
  pendingPartial: boolean;
}

export interface ReadJsonlTailOptions {
  /** Byte offset to resume from (default 0). */
  start?: number;
  /**
   * Called once per complete line, in file order. Blank lines are skipped.
   * Return `false` to stop reading; `nextOffset` then covers only the lines
   * handed over so far.
   */
  onLine: (line: string) => void | boolean;
  /**
   * Decides whether a trailing line that has no newline is a complete record.
   * Defaults to a JSON.parse probe.
   */
  isCompleteRecord?: (line: string) => boolean;
}

export interface JsonlLineReader extends AsyncIterable<string> {
  /** Byte offset just past the last committed line. Updated as iteration proceeds. */
  readonly nextOffset: number;
  /** True when a trailing partial line was left for the next round. */
  readonly pendingPartial: boolean;
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

class JsonlLineReaderImpl implements JsonlLineReader {
  private offset: number;
  private partial = false;

  constructor(
    private readonly filePath: string,
    start: number,
    private readonly isComplete: (line: string) => boolean,
  ) {
    this.offset = start;
  }

  get nextOffset(): number {
    return this.offset;
  }

  get pendingPartial(): boolean {
    return this.partial;
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<string> {
    const start = this.offset;
    let carry: Buffer = Buffer.alloc(0);
    let carryStart = start;

    const stream = createReadStream(this.filePath, { start });
    try {
      for await (const chunk of stream) {
        const buf = chunk as Buffer;
        carry = carry.length === 0 ? buf : Buffer.concat([carry, buf]);
        let searchFrom = 0;
        for (;;) {
          const idx = carry.indexOf(NEWLINE, searchFrom);
          if (idx === -1) break;
          const line = decodeLine(carry.subarray(searchFrom, idx));
          searchFrom = idx + 1;
          this.offset = carryStart + searchFrom;
          this.partial = false;
          if (line !== null) yield line;
        }
        if (searchFrom > 0) {
          carry = carry.subarray(searchFrom);
          carryStart += searchFrom;
        }
      }
    } finally {
      stream.destroy();
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
    if (this.isComplete(tail)) {
      this.offset = carryStart + carry.length;
      this.partial = false;
      yield tail;
      return;
    }
    this.offset = carryStart;
    this.partial = true;
  }
}

export function createJsonlLineReader(
  filePath: string,
  start = 0,
  options?: { isCompleteRecord?: (line: string) => boolean },
): JsonlLineReader {
  return new JsonlLineReaderImpl(
    filePath,
    start,
    options?.isCompleteRecord ?? looksLikeJson,
  );
}

/** Collect complete lines via `onLine`. Thin wrapper over {@link createJsonlLineReader}. */
export async function readJsonlTail(
  filePath: string,
  options: ReadJsonlTailOptions,
): Promise<JsonlTailResult> {
  const reader = createJsonlLineReader(filePath, options.start ?? 0, {
    isCompleteRecord: options.isCompleteRecord,
  });
  for await (const line of reader) {
    if (options.onLine(line) === false) break;
  }
  return { nextOffset: reader.nextOffset, pendingPartial: reader.pendingPartial };
}
