import type { PetSize } from '../main/pet-core.js';

// Presets use the full video canvas width; the visible character's height
// is approximately 285/640 of that width, excluding transparent margins.
export const DSH_PET_WIDTHS = { small: 204, medium: 264, large: 364 } as const;

export function dshPetSize(width: unknown): PetSize {
  if (typeof width !== 'number' || !Number.isFinite(width)) return 'medium';
  return (Object.keys(DSH_PET_WIDTHS) as PetSize[]).reduce((nearest, size) =>
    Math.abs(DSH_PET_WIDTHS[size] - width) < Math.abs(DSH_PET_WIDTHS[nearest] - width) ? size : nearest);
}
