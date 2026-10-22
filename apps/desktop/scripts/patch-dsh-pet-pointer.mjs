// Keep the audited vendor snapshot intact; Windows input uses bounded polling.
export function patchDshPetPointer({ helper, preload, sprite }) {
  const replace = (source, from, to) => {
    if (!source.includes(from)) throw new Error('unsupported upstream pointer patch');
    return source.replace(from, to);
  };
  helper = replace(helper, 'const { connectHost, fileResponse }', 'const { connectHost, fileResponse, createPointerSampler }');
  helper = replace(helper, '  win.setIgnoreMouseEvents(ignore, { forward: true });', `  if (windowIgnore.get(win.id) === ignore) return;
  win.setIgnoreMouseEvents(ignore, { forward: process.platform !== 'win32' });`);
  helper = replace(helper, 'const POINTER_POLL_MS = 60;', "const POINTER_POLL_MS = process.platform === 'win32' ? 16 : 60;");
  helper = replace(helper, '    const pointerTimer = setInterval(() => {', '    const samplePointer = createPointerSampler();\n    let activityPoint = null, activityAt = Date.now(), idleSent = false;\n    const pointerTimer = setInterval(() => {');
  helper = replace(helper, '      const point = screen.getCursorScreenPoint();', `      const point = screen.getCursorScreenPoint();
      if (!activityPoint || activityPoint.x !== point.x || activityPoint.y !== point.y) { activityAt = Date.now(); activityPoint = point; }
      const idle = Date.now() - activityAt >= 60000;
      if (idle !== idleSent) { idleSent = idle; win.webContents.send('pet:idle', idle); }`);
  helper = replace(helper, '      if (next !== ignoring) setWindowIgnore(win, next);', `      if (next !== ignoring) setWindowIgnore(win, next);
      if (process.platform === 'win32') {
        const sample = samplePointer(b, point, zone === 'body', busy);
        if (sample) win.webContents.send('pet:cursor-position', sample);
      }`);
  preload = replace(preload, '  setInteractive(interactive) {', `  onIdle(cb) {
    const listener = (_event, idle) => cb(idle === true);
    ipcRenderer.on('pet:idle', listener);
    return () => ipcRenderer.removeListener('pet:idle', listener);
  },
  onCursorPosition(cb) {
    const listener = (_event, point) => cb(point);
    ipcRenderer.on('pet:cursor-position', listener);
    return () => ipcRenderer.removeListener('pet:cursor-position', listener);
  },
  setInteractive(interactive) {`);
  sprite = replace(sprite, "    window.addEventListener('mousemove', (e) => this.onMouseMove(e), { signal: ac.signal });", `    window.addEventListener('mousemove', (e) => this.onMouseMove(e), { signal: ac.signal });
    if (window.petBridge?.onCursorPosition) {
      const off = window.petBridge.onCursorPosition(point => {
        if (this.inputBusy()) return;
        this.onMouseMove({ clientX: toLocal(point.x), clientY: toLocal(point.y), buttons: 0 });
      });
      ac.signal.addEventListener('abort', off, { once: true });
    }`);
  return { helper, preload, sprite };
}
