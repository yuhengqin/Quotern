/** A compact, read-only view of subscription windows for the pet bubble. */
export interface PetLimit {
  provider: string;
  window: string;
  usedPercent: number;
  resetAt: number | null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function ready(value: unknown): Record<string, unknown> | null {
  const snapshot = record(value);
  return snapshot?.status === 'ready' && snapshot.stale !== true ? snapshot : null;
}

function add(rows: PetLimit[], provider: string, label: string, value: unknown, mode: 'used' | 'remaining' = 'used'): void {
  const window = record(value);
  if (!window) return;
  const raw = mode === 'remaining' ? window.remainingPercent : window.usedPercent;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return;
  const usedPercent = Math.max(0, Math.min(100, mode === 'remaining' ? 100 - raw : raw));
  if (usedPercent <= 0 || usedPercent >= 100) return;
  rows.push({
    provider,
    window: label,
    usedPercent,
    resetAt: typeof window.resetsAt === 'number' && Number.isFinite(window.resetsAt) ? window.resetsAt : null,
  });
}

export function collectPetLimits(snapshots: Record<string, unknown>): PetLimit[] {
  const rows: PetLimit[] = [];
  const codex = ready(snapshots.codex);
  add(rows, 'Codex', '5h', codex?.fiveHour);
  add(rows, 'Codex', '7d', codex?.weekly);
  const claude = ready(snapshots.claude);
  add(rows, 'Claude', '5h', claude?.fiveHour);
  add(rows, 'Claude', '7d', claude?.sevenDay);
  const cursor = ready(snapshots.cursor);
  add(rows, 'Cursor', 'Cursor', cursor?.cursorModels);
  add(rows, 'Cursor', 'Other', cursor?.otherModels);
  add(rows, 'Cursor', 'Plan', cursor?.plan);
  const names: Record<string, string> = {
    copilot: 'GitHub Copilot', grok: 'Grok', kimiCode: 'Kimi Code', kimiDesktop: 'Kimi Desktop',
    zcode: 'ZCode', antigravity: 'Antigravity', qoder: 'Qoder', minimax: 'MiniMax',
    deepseek: 'DeepSeek', opencode: 'OpenCode', traeGlobal: 'TRAE', traeCn: 'TRAE CN',
    workbuddyGlobal: 'WorkBuddy', workbuddyMainland: 'WorkBuddy CN',
  };
  for (const [key, provider] of Object.entries(names)) {
    const snapshot = ready(snapshots[key]);
    if (!snapshot || !Array.isArray(snapshot.limits)) continue;
    for (const item of snapshot.limits) {
      const limit = record(item);
      if (!limit || typeof limit.label !== 'string') continue;
      const mode = key === 'copilot' ? 'remaining' : 'used';
      if (mode === 'remaining' && limit.unlimited === true) continue;
      add(rows, provider, limit.label, limit, mode);
    }
  }
  return rows.sort((a, b) => b.usedPercent - a.usedPercent || a.provider.localeCompare(b.provider));
}
