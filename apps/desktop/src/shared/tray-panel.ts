export interface TrayPanelState { pinned: boolean; mode?: 'summary' | 'full'; x?: number; y?: number }
export interface TrayPanelViewState extends TrayPanelState { expanded: boolean }
export const TRAY_PANEL_GET = 'tray-panel:get';
export const TRAY_PANEL_SET = 'tray-panel:set';
export const TRAY_PANEL_SET_EXPANDED = 'tray-panel:set-expanded';
export const TRAY_PANEL_HIDE = 'tray-panel:hide';
export const TRAY_PANEL_CHANGED = 'tray-panel:changed';
export const TRAY_PANEL_MODE = 'tray-panel:mode';
export function normalizeTrayPanel(value: unknown): TrayPanelState {
  if (!value || typeof value !== 'object') return { pinned: false };
  const row = value as Record<string, unknown>;
  return { pinned: row.pinned === true, ...(row.mode === 'summary' || row.mode === 'full' ? { mode: row.mode } : {}), ...(typeof row.x === 'number' && Number.isFinite(row.x) && typeof row.y === 'number' && Number.isFinite(row.y) ? { x: Math.round(row.x), y: Math.round(row.y) } : {}) };
}
