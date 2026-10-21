// Backport d893303 (confined wandering) and 97f1396 (turn direction) without
// changing the audited upstream snapshot or the existing input/chat patches.
export function patchDshPetMotion(source) {
  const required = (from, to) => {
    if (source.split(from).length !== 2) throw new Error('unsupported upstream motion patch');
    source = source.replace(from, to);
  };
  required("const dir = (this.facing === 'right') !== this.animations.turn.includes(this.anim) ? 1 : -1;",
    "const dir = this.facing === 'right' ? 1 : -1;");
  required(`    const plan = S.planMove({
      cx: this.currentCenterX(),
      cy: this.currentCenterY(),`, `    const cx = this.currentCenterX();
    const cy = this.currentCenterY();
    const wanderArea = this.confineToScreen ? S.resolveRect(AREAS, cx, cy) : null;
    const plan = S.planMove({
      cx,
      cy,`);
  required(`      // 落点按显示器并集判定：能骑缝跨屏走，但走不进外接矩形里的空洞
      areas: AREAS,`, `      // Locked wandering stays on the current (or nearest) screen; otherwise keep the union.
      areas: wanderArea ? [wanderArea] : AREAS,`);
  return source;
}
