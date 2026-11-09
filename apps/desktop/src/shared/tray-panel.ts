export interface TrayPanelState { mode?: 'summary' | 'full' }
export const TRAY_PANEL_GET = 'tray-panel:get';
export const TRAY_PANEL_MODE = 'tray-panel:mode';
export function normalizeTrayPanel(value: unknown): TrayPanelState {
  if (!value || typeof value !== 'object') return {};
  const { mode } = value as Record<string, unknown>;
  return mode === 'summary' || mode === 'full' ? { mode } : {};
}
