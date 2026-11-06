export interface TrayPanelState { pinned: boolean; x?: number; y?: number }
export const TRAY_PANEL_GET = 'tray-panel:get';
export const TRAY_PANEL_SET = 'tray-panel:set';
export const TRAY_PANEL_CHANGED = 'tray-panel:changed';
export function normalizeTrayPanel(value: unknown): TrayPanelState {
  if (!value || typeof value !== 'object') return { pinned: false };
  const row = value as Record<string, unknown>;
  return { pinned: row.pinned === true, ...(typeof row.x === 'number' && Number.isFinite(row.x) && typeof row.y === 'number' && Number.isFinite(row.y) ? { x: Math.round(row.x), y: Math.round(row.y) } : {}) };
}
