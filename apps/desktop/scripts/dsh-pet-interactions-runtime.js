/* Quotern-owned desktop interactions. Loaded after controls.js, before renderer boot.
 * Keep the video player, scoring, physical movement and audited upstream files intact. */
'use strict';
(() => {
  const proto = PetSprite.prototype;
  const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const areas = () => typeof WORK_AREAS !== 'undefined' && WORK_AREAS.length ? WORK_AREAS : AREAS;
  const storageKey = pet => 'quotern-companion-position-v1:' + pet.pet.id;
  const native = Object.fromEntries(['onClick', 'onMouseMove', 'onPointerDown', 'onPointerMove', 'onPointerUp', 'renderBubble', 'handleEnded', 'onWorkTick', 'tryMove', 'position', 'relayout', 'goHome', 'onMenuAction', 'onContextMenu', 'moveToCenter', 'throwWith', 'applyControlLock', 'finishPlayback', 'dispose'].map(name => [name, proto[name]]));

  proto.initCompanion = function () {
    this.companionReady = true;
    this.companionClickIndex = 0;
    this.companionQuipIndex = 0;
    this.companionHover = false;
    this.stage.style.rotate = '0deg';
    this.stage.style.translate = '0px';
    this.stage.style.transformOrigin = '50% 90%';
    this.stage.style.transition = reduced() ? 'none' : 'rotate 120ms ease-out, translate 120ms ease-out';
    // Reserve room for the multiline usage card without changing the sprite's position.
    this.margin.t = Math.max(this.margin.t, 200);
    this.margin.l = Math.max(this.margin.l, 160);
    this.margin.r = Math.max(this.margin.r, 160);
    this.margin.b = Math.max(this.margin.b, 200);
    this.el.style.top = this.margin.t + 'px';
    this.el.style.left = this.margin.l + 'px';
    this.restoreCompanionPosition();
    this.position();
    if (window.petBridge?.onIdle) {
      const off = window.petBridge.onIdle(idle => this.setCompanionIdle(idle));
      this.ac.signal.addEventListener('abort', off, { once: true });
    }
    window.addEventListener('mouseleave', () => this.setCompanionHover(false), { signal: this.ac.signal });
  };

  proto.onCompanionSnapshot = function (data) {
    if (!data || typeof data.hoverText !== 'string' || !Array.isArray(data.quips)) return;
    const signature = JSON.stringify(data);
    if (signature === this.companionSignature) return;
    this.companionSignature = signature;
    this.companionData = data;
    this.renderBubble();
    this.reconcileCompanionActivity();
  };

  proto.showCompanionText = function (text) {
    clearTimeout(this.companionSpeechTimer);
    this.companionSpeech = text;
    this.renderBubble();
    this.companionSpeechTimer = setTimeout(() => {
      this.companionSpeech = null;
      this.renderBubble();
    }, 6000);
  };

  proto.renderBubble = function () {
    this.companionBubbleOn = false;
    this.bubble.classList.remove('is-companion-below');
    for (const key of ['fontSize', 'minWidth', 'maxWidth', 'left', 'top', 'bottom']) this.bubble.style[key] = '';
    native.renderBubble.call(this);
    if (this.frozen) { this.bubble.classList.remove('is-on'); return; }
    const terminal = this.workOn && this.workText && ['success', 'error'].includes(this.workState);
    // Existing terminal, broadcast, quota and task information keeps its slot;
    // a user click may briefly take the nonterminal slot, hover is last priority.
    if (terminal || (this.whisperOn && this.whisperView)) return;
    const speech = this.companionSpeech;
    if (!speech && ((this.bubbleOn && this.balanceView) || (this.workOn && this.workText))) return;
    const text = speech || (this.companionHover && !this.menuOpen && this.companionData?.hoverText);
    if (!text) return;
    this.bubble.innerHTML = '';
    this.bubble.classList.add('is-whisper', 'is-on');
    this.bubble.style.fontSize = Math.max(12, S.resolveFontPx(this.font || S.DEFAULT_FONT, this.size).bubble * .75) + 'px';
    this.bubble.style.minWidth = '140px';
    this.bubble.style.maxWidth = '240px';
    for (const line of String(text).split('\n')) {
      const row = document.createElement('div');
      row.className = 'pet-bub-row';
      row.textContent = line;
      this.bubble.appendChild(row);
    }
    this.companionBubbleOn = true;
    this.positionCompanionBubble();
    window.__dshPetDebug.lastBubbleTitle = String(text);
  };
  proto.positionCompanionBubble = function () {
    if (!this.companionBubbleOn) return;
    const bounds = this.bubble.getBoundingClientRect?.();
    if (bounds?.width && bounds?.height) {
      const a = S.resolveRect(areas(), this.pos.x + this.halfW, this.pos.y + this.halfH);
      const center = Math.max(a.x + bounds.width / 2 + 8, Math.min(a.x + a.width - bounds.width / 2 - 8, this.pos.x + this.halfW));
      this.bubble.style.left = (center - this.pos.x) + 'px';
      this.bubble.style.bottom = 'auto';
      const above = this.pos.y + this.hitRect.y - bounds.height - 8;
      this.bubble.style.top = (above >= a.y ? this.hitRect.y - bounds.height - 8 : this.hitRect.y + this.hitRect.h + 8) + 'px';
      this.bubble.classList.toggle('is-companion-below', above < a.y);
    }
  };

  proto.onClick = function () {
    if (this.dragState.active || this.dragState.dragging || this.justDragged || this.pressScoreFired) return native.onClick.call(this);
    this.companionPhase = null;
    this.companionManual = true;
    // Cursor activity is owned by the helper. A click may override rest only
    // for its actual video, rather than clearing a still-current idle signal.
    this.stopThrow(); this.stopMove();
    const pool = this.animations.clicks;
    if (pool.length) {
      this.pendingSquash = true;
      this.playOnce(pool[this.companionClickIndex++ % pool.length]);
    } else this.companionManual = false;
    const quips = this.companionData?.quips;
    if (quips?.length) this.showCompanionText(quips[this.companionQuipIndex++ % quips.length]);
  };

  proto.setCompanionHover = function (hover, lean = 0) {
    const changed = this.companionHover !== hover;
    this.companionHover = hover;
    const f = hover && !this.frozen && !this.inputBusy() && !this.companionDock && !reduced() ? Math.max(-1, Math.min(1, lean)) : 0;
    this.stage.style.transition = reduced() ? 'none' : 'rotate 120ms ease-out, translate 120ms ease-out';
    this.stage.style.rotate = (f * 2) + 'deg';
    this.stage.style.translate = (f * this.size * 0.025) + 'px';
    if (changed) {
      this.renderBubble();
      if (this.companionDock && !this.frozen && !this.inputBusy()) {
        clearTimeout(this.companionCollapseTimer);
        if (hover) this.setCompanionExpanded(true);
        else this.companionCollapseTimer = setTimeout(() => {
          if (!this.inputBusy() && !this.companionHover) this.setCompanionExpanded(false);
        }, 300);
      }
    }
  };
  proto.onMouseMove = function (event) {
    native.onMouseMove.call(this, event);
    const r = this.hitRect, x = event.clientX - this.margin.l, y = event.clientY - this.margin.t;
    const hover = !this.dragState.active && !this.menuOpen && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
    this.setCompanionHover(hover, (x - r.x - r.w / 2) / (r.w / 2));
    if (this.companionData) this.setTip(false);
  };

  proto.companionCanRest = function () {
    return !this.inputBusy() && !this.frozen && !this.controlPlayback && !this.companionManual && !this.throwRef && !this.posFollow && !this.workState && !this.companionData?.syncing;
  };
  proto.companionAnimation = function (name) {
    return this.animations.categories?.some(category => category.actions.includes(name)) ? name : null;
  };
  proto.setCompanionIdle = function (idle) {
    this.companionIdle = Boolean(idle);
    this.reconcileCompanionActivity();
  };
  proto.reconcileCompanionActivity = function () {
    if (this.companionIdle && this.companionCanRest()) {
      if (this.companionPhase === 'yawn' || this.companionPhase === 'sleep') return;
      const yawn = this.companionAnimation('哈欠连天'), sleep = this.companionAnimation('原地小憩沉眠');
      if (!sleep) return;
      this.stopMove();
      this.companionPhase = yawn ? 'yawn' : 'sleep';
      if (yawn) this.playOnce(yawn); else this.switchTo(sleep, false);
      return;
    }
    if (this.companionPhase === 'yawn' || this.companionPhase === 'sleep') {
      this.companionPhase = null;
      const wake = this.companionAnimation('打瞌睡被惊醒');
      if (!this.companionIdle && this.companionCanRest() && wake) { this.companionPhase = 'wake'; this.playOnce(wake); }
      else if (!this.workState && !this.frozen && !this.controlPlayback && !this.dragState.active) this.playIdle();
    }
    // Collector sync is just a busy animation; it never synthesizes Agent success/error.
    if (this.companionData?.syncing && !this.workState && !this.inputBusy() && !this.frozen && !this.controlPlayback && !this.companionManual) {
      const slot = this.animations.events?.workStatus?.[1];
      if (slot && this.companionPhase !== 'sync') { this.stopMove(); this.companionPhase = 'sync'; this.switchTo(S.pickSlot(slot), false); }
    } else if (this.companionPhase === 'sync') {
      this.companionPhase = null;
      if (!this.workState && !this.inputBusy() && !this.frozen && !this.controlPlayback) this.playIdle();
    }
  };
  proto.handleEnded = function () {
    if (this.dragState.active || this.frozen) return native.handleEnded.call(this);
    this.companionManual = false;
    if (this.companionPhase === 'yawn' && this.companionIdle && this.companionCanRest()) {
      this.companionPhase = 'sleep'; this.switchTo(this.companionAnimation('原地小憩沉眠'), false); return;
    }
    this.companionPhase = null;
    native.handleEnded.call(this);
    this.reconcileCompanionActivity();
  };
  proto.onWorkTick = function (snapshot, tick) {
    if (snapshot?.state && !this.frozen) this.companionPhase = null;
    native.onWorkTick.call(this, snapshot, tick);
    this.reconcileCompanionActivity();
  };
  proto.applyControlLock = function (data) {
    if (data?.locked) {
      this.companionPhase = null; this.companionManual = false;
      clearTimeout(this.companionCollapseTimer);
      cancelAnimationFrame(this.companionSlide); this.companionSlide = null;
      this.stage.style.rotate = '0deg'; this.stage.style.translate = '0px';
    }
    const wasFrozen = this.frozen;
    native.applyControlLock.call(this, data);
    if (wasFrozen && !this.frozen) {
      if (this.companionDock) this.setCompanionExpanded(this.companionHover, false);
      this.reconcileCompanionActivity();
    }
  };
  proto.finishPlayback = function (...args) {
    native.finishPlayback.apply(this, args);
    if (args[0] === 'failed') { this.companionManual = false; this.companionPhase = null; }
  };

  // Dock coordinates use the visible body, not the video's transparent margins.
  proto.companionDockArea = function () {
    const list = areas();
    const point = { x: this.pos.x + this.halfW, y: this.pos.y + this.halfH };
    const area = S.resolveRect(list, point.x, point.y);
    if (!area) return null;
    const right = area.x + area.width, top = this.pos.y + this.hitRect.y, bottom = top + this.hitRect.h;
    const neighbour = list.some(other => other !== area && other.x <= right + 1 && other.x + other.width > right + 1 && other.y < bottom && other.y + other.height > top);
    return neighbour ? null : area;
  };
  proto.tryCompanionDock = function () {
    if (this.throwRef || this.dragState.active) return false;
    const area = this.companionDockArea();
    if (!area || Math.abs(area.x + area.width - (this.pos.x + this.hitRect.x + this.hitRect.w)) > 24) return false;
    this.stopMove(); this.stopThrow();
    this.companionDock = { area, y: this.pos.y, expanded: false };
    this.setCompanionHover(false);
    this.setCompanionExpanded(false, false);
    this.saveCompanionPosition();
    return true;
  };
  proto.setCompanionExpanded = function (expanded, animate = true) {
    const dock = this.companionDock;
    if (!dock || this.frozen) return;
    cancelAnimationFrame(this.companionSlide);
    dock.expanded = expanded;
    const r = this.hitRect, a = dock.area;
    const x = a.x + a.width - r.x - (expanded ? r.w : Math.min(18, r.w));
    const y = Math.max(a.y - r.y, Math.min(a.y + a.height - r.y - r.h, dock.y));
    const startX = this.pos.x, startY = this.pos.y, started = performance.now();
    const step = time => {
      if (this.companionDock !== dock || this.frozen) return;
      const t = Math.max(0, Math.min(1, (time - started) / 200));
      const ease = 1 - (1 - t) ** 3;
      this.sendBounds(startX + (x - startX) * ease, startY + (y - startY) * ease);
      this.positionCompanionBubble();
      if (t < 1) this.companionSlide = requestAnimationFrame(step);
      else this.companionSlide = null;
    };
    if (animate && !reduced()) this.companionSlide = requestAnimationFrame(step);
    else { this.companionSlide = null; this.sendBounds(x, y); this.positionCompanionBubble(); }
  };
  proto.undockCompanion = function (keepPosition = false) {
    if (!this.companionDock) return;
    if (keepPosition) cancelAnimationFrame(this.companionSlide);
    else this.setCompanionExpanded(true, false);
    this.companionDock = null;
    this.customPos = { rx: (this.pos.x + this.halfW) / VIEW.w, ry: (this.pos.y + this.halfH) / VIEW.h };
    this.saveCompanionPosition();
  };
  proto.saveCompanionPosition = function () {
    const dock = this.companionDock;
    const x = dock ? dock.area.x + dock.area.width - this.hitRect.x - this.hitRect.w : this.pos.x;
    const state = { version: 1, rx: (x + this.halfW) / VIEW.w, ry: (this.pos.y + this.halfH) / VIEW.h, docked: Boolean(dock) };
    try {
      if (window.petBridge?.saveCompanionPosition) window.petBridge.saveCompanionPosition(this.pet.id, state);
      else window.localStorage.setItem(storageKey(this), JSON.stringify(state));
    } catch { /* Storage failure must not disable the pet. */ }
  };
  proto.restoreCompanionPosition = function () {
    try {
      const saved = window.petBridge?.readCompanionPosition ? window.petBridge.readCompanionPosition(this.pet.id) : JSON.parse(window.localStorage.getItem(storageKey(this)));
      if (saved?.version !== 1 || !Number.isFinite(saved.rx) || !Number.isFinite(saved.ry) || saved.rx < 0 || saved.rx > 1 || saved.ry < 0 || saved.ry > 1) return;
      const p = S.clampPointToRegion(areas(), saved.rx * VIEW.w, saved.ry * VIEW.h);
      const a = S.resolveRect(areas(), p.x, p.y), r = this.hitRect;
      // Restoring an existing dock is independent of the drag-to-dock threshold.
      const x = saved.docked ? a.x + a.width - r.x - r.w : Math.max(a.x - r.x, Math.min(a.x + a.width - r.x - r.w, p.x - this.halfW));
      const y = Math.max(a.y - r.y, Math.min(a.y + a.height - r.y - r.h, p.y - this.halfH));
      this.customPos = { rx: (x + this.halfW) / VIEW.w, ry: (y + this.halfH) / VIEW.h };
      this.sendBounds(x, y);
      if (saved.docked) this.tryCompanionDock();
    } catch (error) { window.__dshPetDebug.positionRestoreError = String(error); /* Fall back to the configured corner. */ }
  };
  proto.position = function () {
    if (this.companionDock) this.setCompanionExpanded(this.companionDock.expanded, false);
    else native.position.call(this);
  };
  proto.relayout = function () {
    if (!this.companionDock) return native.relayout.call(this);
    const expanded = this.companionDock.expanded;
    this.companionDock = null;
    this.restoreCompanionPosition();
    if (this.companionDock) this.setCompanionExpanded(expanded, false);
  };
  proto.tryMove = function (...args) {
    return this.companionDock || ['yawn', 'sleep'].includes(this.companionPhase) ? false : native.tryMove.apply(this, args);
  };
  for (const name of ['moveToCenter', 'throwWith']) proto[name] = function (...args) {
    if (this.dragState.active) return;
    this.undockCompanion(); this.setCompanionIdle(false);
    return native[name].apply(this, args);
  };
  proto.goHome = function () {
    this.undockCompanion();
    try {
      window.petBridge?.saveCompanionPosition?.(this.pet.id, null);
      window.localStorage.removeItem(storageKey(this));
    } catch { /* optional persistence */ }
    return native.goHome.call(this);
  };

  proto.onPointerDown = function (event) {
    if (event.button === 0) {
      this.companionPhase = null; this.companionManual = true;
      if (this.frozen) this.preemptControl();
      if (this.companionDock) this.setCompanionExpanded(true, false);
      this.stage.style.rotate = '0deg'; this.stage.style.translate = '0px';
    }
    return native.onPointerDown.call(this, event);
  };
  proto.onPointerMove = function (event) {
    const result = native.onPointerMove.call(this, event);
    if (this.dragState.dragging) this.undockCompanion(true);
    return result;
  };
  proto.onPointerUp = function (event) {
    const dragged = this.dragState.dragging;
    const result = native.onPointerUp.call(this, event);
    this.companionManual = false;
    if (dragged && !this.tryCompanionDock()) this.saveCompanionPosition();
    return result;
  };
  proto.onContextMenu = function (event) {
    if (this.companionDock && !this.dragState.active && !this.justDragged) this.setCompanionExpanded(true, false);
    return native.onContextMenu.call(this, event);
  };
  proto.onMenuAction = function (leaf) {
    if (leaf?.anim) {
      this.companionPhase = null; this.companionManual = true;
      if (this.animations.moves.actions.some(action => action.name === leaf.anim)) this.undockCompanion();
    }
    if (!['quotern-sync', 'quotern-settings'].includes(leaf?.action)) return native.onMenuAction.call(this, leaf);
    this.preemptControl(); this.closeMenu();
    const route = leaf.action === 'quotern-sync' ? '/sync' : '/open-settings';
    return fetch(BASE + route, { method: 'POST' }).then(async response => {
      if (!response.ok || !(await response.json()).ok) throw new Error('host-action');
      pollStateNow();
    }).catch(() => { if (!this.ac.signal.aborted) this.showCompanionText(this.companionData?.labels?.failed || '操作失败，请稍后重试'); });
  };
  proto.disposeCompanion = function () {
    clearTimeout(this.companionSpeechTimer); clearTimeout(this.companionCollapseTimer);
    cancelAnimationFrame(this.companionSlide);
  };
  proto.dispose = function () { this.disposeCompanion(); return native.dispose.call(this); };

  // Keep constructor-owned DOM/listener lifecycle; subclasses inherit the patched player.
  const UpstreamSprite = PetSprite;
  PetSprite = class QuoternPetSprite extends UpstreamSprite {
    constructor(pet) { super(pet); this.initCompanion(); }
  };
})();
