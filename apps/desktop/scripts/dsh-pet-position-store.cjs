// Rare user-placement writes are acknowledged before returning to the renderer.
// Chromium localStorage is buffered and loses immediate hide/restart updates.
const fs = require('node:fs');
const path = require('node:path');

function valid(state) {
  return state?.version === 1 && Number.isFinite(state.rx) && state.rx >= 0 && state.rx <= 1 &&
    Number.isFinite(state.ry) && state.ry >= 0 && state.ry <= 1 && typeof state.docked === 'boolean';
}
function installPositionStore({ app, ipcMain, getWindow }) {
  const file = path.join(app.getPath('userData'), 'companion-position.json');
  const read = () => {
    try { const data = JSON.parse(fs.readFileSync(file, 'utf8')); return data && typeof data === 'object' && !Array.isArray(data) ? data : {}; }
    catch { return {}; }
  };
  const trusted = (event, id) => typeof id === 'string' && id.length <= 200 && getWindow(id)?.webContents === event.sender && event.senderFrame === event.sender.mainFrame;
  ipcMain.on('pet:read-companion-position', (event, id) => {
    if (!trusted(event, id)) { event.returnValue = null; return; }
    const saved = read()[id];
    event.returnValue = valid(saved) ? saved : null;
  });
  ipcMain.on('pet:save-companion-position', (event, id, state) => {
    if (!trusted(event, id) || (state !== null && !valid(state))) { event.returnValue = false; return; }
    let ok = false;
    try {
      const saved = Object.assign(Object.create(null), read());
      if (state === null) delete saved[id];
      else saved[id] = { version: 1, rx: state.rx, ry: state.ry, docked: state.docked };
      fs.writeFileSync(file + '.tmp', JSON.stringify(saved), { mode: 0o600 });
      fs.renameSync(file + '.tmp', file);
      ok = true;
    } catch { /* Placement must never take down the helper. */ }
    event.returnValue = ok;
  });
}
module.exports = { installPositionStore };
