import type { CursorsFile } from 'quotern-core';

// The Tauri collector does not have an account grant for Cursor's online usage export.
// Existing history remains in the bucket store; the card opens the user's official dashboard.
export async function parseCursorIncremental(cursors: CursorsFile) {
  return { cursors, result: { buckets: [], filesProcessed: 0, eventsParsed: 0, skipped: true,
    error: '请在 Cursor 官方用量页查看在线统计' } };
}
