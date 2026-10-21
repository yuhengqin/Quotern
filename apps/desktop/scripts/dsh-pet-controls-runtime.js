/* Quotern desktop backport of dsh-pet cf3ed3c playback/lock/motion (MIT).
 * Source: https://github.com/PC2005-cloud/dsh-pet/tree/cf3ed3c4dd6829b252f352d4c61a18db6fdb26d4
 * Loaded after the audited sprite/events, before renderer boot. No new network listener. */
'use strict';
(() => {
  const proto = PetSprite.prototype;
  let inputEpoch = 0, releaseBarrier = Promise.resolve();
  const post = (route, pet, body) => fetch(BASE + route + '?pet=' + encodeURIComponent(pet), {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }).catch(() => {});
  proto.reportPlayback = function (id, status, reason) {
    if (id) void post('/playback/' + encodeURIComponent(id) + '/report', this.pet.id, { status, ...(reason ? { reason } : {}) });
  };
  proto.finishPlayback = function (status, reason, id = this.controlPlayback) {
    if (!id || id !== this.controlPlayback) return;
    this.controlPlayback = null;
    this.reportPlayback(id, status, reason);
  };
  proto.switchTo = function (next, once, receipt) {
    const id = receipt || this.controlNextPlayback;
    this.controlNextPlayback = null;
    if (!next) { this.reportPlayback(id, 'failed', 'missing-animation'); return; }
    this.controlLoadCleanup?.();
    this.finishPlayback('cancelled', 'replaced');
    this.controlPlayback = id || null;
    const gen = ++this.gen, el = this.front === 0 ? this.videoB : this.videoA;
    this.pending = { anim: next, once, gen };
    let committed = false;
    const cleanup = () => {
      clearTimeout(timer); el.removeEventListener('loadeddata', ready); el.removeEventListener('error', error);
      if (this.controlLoadCleanup === cleanup) this.controlLoadCleanup = null;
    };
    const fail = reason => {
      if (this.gen !== gen) return;
      cleanup(); this.pending = null; this.finishPlayback('failed', reason, id);
    };
    const error = () => fail('video-error');
    const ready = () => {
      if (this.gen !== gen || committed) return;
      committed = true; clearTimeout(timer); el.removeEventListener('loadeddata', ready);
      const old = this.front === 0 ? this.videoA : this.videoB;
      el.classList.add('is-front');
      if (old !== el) { old.classList.remove('is-front'); old.onended = null; old.pause(); }
      this.front = this.front === 0 ? 1 : 0; this.pending = null;
      el.style.transform = this.facing === 'right' ? 'scaleX(-1)' : '';
      el.play().then(() => {
        if (this.gen !== gen) return;
        this.reportPlayback(id, 'playing');
        if (this.pendingSquash) { this.pendingSquash = false; this.startSquash(el); }
        if (this.pendingMove) this.startMoveDrive(el);
      }, () => fail('play-rejected'));
    };
    const timer = setTimeout(() => fail('load-timeout'), 10_000);
    this.controlLoadCleanup = cleanup;
    el.onended = once ? () => {
      if (this.gen !== gen) return;
      cleanup(); this.finishPlayback('ended', undefined, id); this.handleEnded();
    } : null;
    el.loop = !once; el.muted = true; el.autoplay = false; el.playsInline = true;
    el.addEventListener('loadeddata', ready); el.addEventListener('error', error);
    el.src = this.assetBase + encodeURIComponent(next) + (S.ANIMATION_EXT || '.webm');
    el.load();
    if (el.readyState >= 2) ready();
  };
  proto.playOnce = function (name, id) { this.anim = name; this.once = true; this.switchTo(name, true, id); };
  const tryMove = proto.tryMove;
  proto.tryMove = function (name, id) {
    this.controlNextPlayback = id;
    const result = tryMove.call(this, name);
    this.controlNextPlayback = null;
    return result;
  };
  const idle = proto.playIdle, ended = proto.handleEnded, resumeWork = proto.resumeWorkStatusAnim;
  proto.playIdle = function () { if (!this.frozen) return idle.call(this); };
  proto.handleEnded = function () { if (!this.frozen) return ended.call(this); };
  proto.resumeWorkStatusAnim = function () { return !this.frozen && resumeWork.call(this); };

  proto.stopPosFollow = function () {
    this.controlMoveToken = (this.controlMoveToken || 0) + 1;
    if (this.posFollow != null) cancelAnimationFrame(this.posFollow);
    this.posFollow = null;
  };
  const stopMove = proto.stopMove;
  proto.stopMove = function () { this.stopPosFollow(); return stopMove.call(this); };
  proto.moveToCenter = function (rx, ry, mode, duration = 0) {
    if (this.dragState.active) return;
    this.stopMove(); this.stopThrow(); this.stopDragFollow();
    const target = S.clampPointToRegion(AREAS, rx * VIEW.w, ry * VIEW.h);
    const x = target.x - this.halfW, y = target.y - this.halfH;
    const from = { ...this.pos }, start = performance.now(), token = this.controlMoveToken;
    let last = start, vx = 0, vy = 0;
    const move = (px, py) => {
      const clamped = S.clampPointToRegion(AREAS, px + this.halfW, py + this.halfH);
      this.customPos = { rx: clamped.x / VIEW.w, ry: clamped.y / VIEW.h };
      this.sendBounds(clamped.x - this.halfW, clamped.y - this.halfH);
    };
    if (mode === 'instant' || mode === 'line' && duration === 0) { move(x, y); return; }
    const frame = now => {
      if (token !== this.controlMoveToken || this.dragState.active) return;
      const elapsed = now - start;
      if (mode === 'line') {
        const fraction = Math.min(1, elapsed / duration);
        move(from.x + (x - from.x) * fraction, from.y + (y - from.y) * fraction);
        if (fraction === 1) { this.posFollow = null; return; }
      } else {
        const dt = Math.min(.033, Math.max(0, (now - last) / 1000)); last = now;
        vx = S.springStep(vx, this.pos.x, x, dt); vy = S.springStep(vy, this.pos.y, y, dt);
        if (Math.hypot(this.pos.x - x, this.pos.y - y) < 1 || elapsed > 10_000) { move(x, y); this.posFollow = null; return; }
        move(this.pos.x + vx * dt, this.pos.y + vy * dt);
      }
      this.posFollow = requestAnimationFrame(frame);
    };
    this.posFollow = requestAnimationFrame(frame);
  };
  proto.throwWith = function (angle, power) {
    if (this.dragState.active) return;
    this.stopMove(); this.stopThrow(); this.stopDragFollow();
    const speed = S.MAX_THROW_SPEED * (1 - Math.exp(-(power * 1200) / S.MAX_THROW_SPEED));
    const rad = ((angle % 360) * Math.PI) / 180;
    this.startThrow(this.pos.x, this.pos.y, Math.cos(rad) * speed, -Math.sin(rad) * speed);
  };

  proto.applyControlLock = function (data) {
    clearTimeout(this.controlLockTimer);
    const frozen = data?.locked === true && data.expiresAt > Date.now();
    if (frozen) this.controlLockTimer = setTimeout(() => this.applyControlLock({ locked: false }), Math.max(0, data.expiresAt - Date.now()));
    if (frozen === Boolean(this.frozen)) return;
    this.frozen = frozen;
    if (frozen) {
      this.controlLoadCleanup?.(); this.pending = null; ++this.gen;
      this.finishPlayback('cancelled', 'locked');
      this.stopMove(); this.stopThrow(); this.stopDragFollow();
      this.videoA.pause(); this.videoB.pause();
      clearTimeout(this.whisperTimer); clearTimeout(this.bubbleTimer); clearTimeout(this.workTimer);
      this.whisperOn = this.bubbleOn = this.workOn = false; this.renderBubble();
    } else if (!this.dragState.active) {
      if (this.controlWork) {
        const { snapshot, tick } = this.controlWork; this.controlWork = null;
        this.onWorkTick(snapshot, tick);
        if (!snapshot?.state || !this.pet.workStatusEnabled) this.playIdle();
      }
      else if (!this.resumeWorkStatusAnim()) this.playIdle();
    }
  };
  proto.preemptControl = function () {
    ++inputEpoch;
    this.finishPlayback('cancelled', 'user-input');
    if (this.frozen) this.applyControlLock({ locked: false });
    // The host may already own a lock that this renderer has not observed yet.
    releaseBarrier = releaseBarrier.then(() => post('/lock/release', this.pet.id, { force: true }));
  };
  const pointer = proto.onPointerDown, menu = proto.onMenuAction, dispose = proto.dispose;
  proto.onPointerDown = function (event) { if (event.button === 0) this.preemptControl(); return pointer.call(this, event); };
  proto.onMenuAction = function (leaf) { this.preemptControl(); return menu.call(this, leaf); };
  proto.dispose = function () {
    this.controlLoadCleanup?.(); this.finishPlayback('cancelled', 'disposed');
    clearTimeout(this.controlLockTimer); this.stopPosFollow(); return dispose.call(this);
  };
  const work = proto.onWorkTick, balanceTick = proto.onBalanceTick, notice = proto.showBalanceNotice;
  proto.onWorkTick = function (snapshot, tick) {
    if (this.frozen) { this.controlWork = { snapshot, tick }; return; }
    return work.call(this, snapshot, tick);
  };
  proto.onBalanceTick = function (state, tick, manual) { if (!this.frozen || manual) return balanceTick.call(this, state, tick, manual); };
  proto.showBalanceNotice = function (state, manual) { if (!this.frozen || manual) return notice.call(this, state, manual); };

  if (typeof applyAnimLeaf === 'function') {
    applyAnimLeaf = function (petId, leaf) {
      const hit = leaf.data;
      if (!hit || typeof hit.name !== 'string') return;
      for (const pet of sprites) if (pet.pet.id === petId) {
        if (pet.dragState.active) { pet.reportPlayback(hit.playbackId, 'cancelled', 'user-input'); continue; }
        pet.stopMove(); pet.stopThrow();
        if (hit.facing === 'left' || hit.facing === 'right') pet.facing = hit.facing;
        if (S.isNoMirrorAnimation(pet.animations.categories, hit.name)) pet.facing = 'left';
        if (pet.animations.moves.actions.some(action => action.name === hit.name) && pet.tryMove(hit.name, hit.playbackId) !== false) continue;
        pet.playOnce(hit.name, hit.playbackId);
      }
    };
    // One in-flight read avoids stale snapshots undoing a user takeover or a newer command.
    let reading = null;
    pollStateOnce = function () {
      if (reading) return reading;
      reading = (async () => {
        const epoch = inputEpoch;
        await releaseBarrier;
        if (epoch !== inputEpoch) return;
        const state = await S.fetchState(STATE_URL); if (!state || epoch !== inputEpoch) return;
        const first = stateBaseline === null;
        const changed = first ? sprites.flatMap(pet => Object.entries(state.pets?.[pet.pet.id] || {})
          .filter(([key]) => ['anim', 'position', 'throw'].includes(key))
          .map(([key, leaf]) => ({ path: 'pets.' + pet.pet.id + '.' + key, leaf }))) : S.takeChanged(state, stateBaseline);
        if (first) stateBaseline = S.flattenCounters(state);
        // Locks are current state, not replayable events. Restore them even on the first read.
        for (const pet of sprites) pet.applyControlLock(state.pets?.[pet.pet.id]?.lock?.data);
        changed.sort((a, b) => a.leaf.counter - b.leaf.counter);
        for (const change of changed) {
          if (change.leaf.data === null || change.path.endsWith('.lock')) continue;
          if (change.path === 'sections.balance') applyBalanceLeaf(change.leaf);
          else if (change.path === 'sections.workStatus') applyWorkStatusLeaf(change.leaf);
          else for (const pet of sprites) {
            const prefix = 'pets.' + pet.pet.id + '.';
            if (change.path === prefix + 'say') applySayLeaf(pet.pet.id, change.leaf);
            else if (change.path === prefix + 'anim') {
              if (first && change.leaf.data.playbackId) {
                const response = await fetch(BASE + '/playback/' + encodeURIComponent(change.leaf.data.playbackId));
                if ((await response.json()).status !== 'accepted') continue;
              }
              applyAnimLeaf(pet.pet.id, change.leaf);
            }
            else if (change.path === prefix + 'position') { const d = change.leaf.data; pet.moveToCenter(d.x, d.y, d.mode, d.duration); }
            else if (change.path === prefix + 'throw') { const d = change.leaf.data; pet.throwWith(d.angle, d.power); }
          }
        }
      })().catch(() => {}).finally(() => { reading = null; });
      return reading;
    };
  }
})();
