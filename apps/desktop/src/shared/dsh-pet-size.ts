import type { PetSize } from '../main/pet-core.js';

// Match Clawd's painted height (84/108/140 * .84). The video character
// occupies 285/640 of its canvas width; transparent video margins are excluded.
export const DSH_PET_WIDTHS = { small: 160, medium: 204, large: 264 } as const;

export function dshPetSize(width: unknown): PetSize {
  if (typeof width !== 'number' || !Number.isFinite(width)) return 'medium';
  return (Object.keys(DSH_PET_WIDTHS) as PetSize[]).reduce((nearest, size) =>
    Math.abs(DSH_PET_WIDTHS[size] - width) < Math.abs(DSH_PET_WIDTHS[nearest] - width) ? size : nearest);
}
