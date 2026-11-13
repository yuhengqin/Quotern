import { BrowserWindow, ipcMain } from 'electron';

/** Complete appearance bridge for existing UI suites; disk behavior has its own suite. */
export function registerAppearanceFixture() {
  let preferences = null;
  const save = value => {
    preferences = { style: value.style, palette: value.palette };
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send('appearance:changed', preferences);
    return { ...preferences };
  };
  ipcMain.handle('appearance:get', () => preferences ? { ...preferences } : null);
  ipcMain.handle('appearance:set', (_event, value) => save(value));
  ipcMain.handle('appearance:initialize', (_event, value) => preferences ? { ...preferences } : save(value));
}
