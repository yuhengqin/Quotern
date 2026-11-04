/** Replace the desktop-only menu; keep the audited vendor snapshot untouched. */
export function patchDshPetMenu(sprite) {
  const replace = (from, to) => {
    if (!sprite.includes(from)) throw new Error('unsupported upstream native menu event patch');
    sprite = sprite.replace(from, to);
  };
  // A native submenu lives outside the renderer. Pointer/focus leaving its DOM
  // must not cancel that menu; Electron owns outside-click and Escape dismissal.
  replace(`        this.closeMenu();
        if (this.dragState.active) this.onPointerUp();
        this.setInteractive(false);`, `        if (!this.menuOpen && this.dragState.active) this.onPointerUp();
        if (!this.inputBusy()) this.setInteractive(false);`);
  replace(`        this.closeMenu();
        if (!this.dragState.active) this.setInteractive(false);`, `        if (!this.inputBusy()) this.setInteractive(false);`);
  const start = sprite.indexOf('  onContextMenu(e) {');
  const end = sprite.indexOf('  onMenuAction(leaf) {', start);
  if (start < 0 || end < start) throw new Error('unsupported upstream context menu');
  return sprite.slice(0, start) + `  async onContextMenu(e) {
    const d = this.dragState;
    if (d.active || d.dragging || this.justDragged || this.menuOpen) return;
    e.preventDefault();
    this.stopThrow(); this.stopMove();
    this.menuOpen = true;
    this.setInteractive(true); this.syncInputBusy();
    window.__dshPetDebug.menuOpen = true;
    const token = {}; this.nativeMenuToken = token;
    let cancelled = false;
    const release = () => {
      if (this.nativeMenuToken !== token) return;
      this.nativeMenuToken = null; this.menuClose = null;
      this.menuOpen = false; window.__dshPetDebug.menuOpen = false;
      this.syncInputBusy();
      if (!this.inputBusy()) this.setInteractive(false);
    };
    this.menuClose = () => { cancelled = true; window.petBridge.closeContextMenu(); release(); };
    try {
      const selected = await window.petBridge.showContextMenu(S.buildMenuTree(this.animations));
      if (cancelled || this.ac.signal.aborted) return;
      release();
      if (selected?.local) this.onMenuAction(selected.local);
      else if (selected?.command) {
        const response = await fetch(BASE + '/context-menu-action', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: selected.command }) });
        if (!response.ok || !(await response.json()).ok) throw new Error('host-action');
        pollStateNow();
      }
    } catch {
      release();
      if (!this.ac.signal.aborted) this.showCompanionText(this.companionData?.labels?.failed || '操作失败，请稍后重试');
    } finally { release(); }
  }

` + sprite.slice(end);
}
