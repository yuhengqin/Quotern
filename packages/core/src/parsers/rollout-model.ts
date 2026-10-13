import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

export function readModel(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const model = value.trim();
  return model.length > 0 ? model : null;
}

/** Model recorded on a Codex / Every Code rollout event, if any. */
export function modelFromRolloutEvent(obj: Record<string, unknown>): string | null {
  if (obj.type === 'turn_context') {
    const payload = obj.payload as { model?: unknown } | undefined;
    return readModel(payload?.model);
  }

  if (obj.type === 'thread_settings_applied') {
    // Recent Codex rollouts omit `info.model` from token_count events but
    // record the active model here. Older rollouts can nest the settings
    // under payload, so accept both shapes.
    const settings =
      (obj.thread_settings as Record<string, unknown> | undefined) ??
      ((obj.payload as Record<string, unknown> | undefined)
        ?.thread_settings as Record<string, unknown> | undefined);
    return readModel(settings?.model);
  }

  if (obj.type === 'world_state') {
    const payload = obj.payload as Record<string, unknown> | undefined;
    const state = payload?.state as Record<string, unknown> | undefined;
    const collab = payload?.collaboration_mode as Record<string, unknown> | undefined;
    return readModel(state?.model) ?? readModel(collab?.model);
  }

  return null;
}

/**
 * Scan bytes `[0, endOffset)` for the last model event. Used when an old
 * incremental bookmark has an offset but no `lastModel`.
 */
export async function recoverLastModelBeforeOffset(
  filePath: string,
  endOffset: number,
): Promise<string | null> {
  if (endOffset <= 0) return null;
  let lastModel: string | null = null;
  const stream = createReadStream(filePath, {
    start: 0,
    end: endOffset - 1,
  });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  for await (const line of rl) {
    if (!line.trim()) continue;
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      const model = modelFromRolloutEvent(obj);
      if (model) lastModel = model;
    } catch {
      continue;
    }
  }
  return lastModel;
}
