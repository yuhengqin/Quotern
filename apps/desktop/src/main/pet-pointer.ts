import type { Point, Rect } from './pet-core.js';

/** Local hover coordinates only; never synthesize button or drag events. */
export function createPetCursorSampler() {
  let previous: Point | null | undefined = null;
  let previousWidth = 0;
  return (bounds: Rect, cursor: Point, hovering: boolean, pressed: boolean): Point | null | undefined => {
    // Force a fresh sample after capture ends, including an explicit leave.
    if (pressed) { previous = undefined; return undefined; }
    if (!hovering) {
      if (previous === null) return undefined;
      previous = null;
      return null;
    }
    const point = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
    if (previous && previous.x === point.x && previous.y === point.y && previousWidth === bounds.width) return undefined;
    previous = point;
    previousWidth = bounds.width;
    return point;
  };
}
