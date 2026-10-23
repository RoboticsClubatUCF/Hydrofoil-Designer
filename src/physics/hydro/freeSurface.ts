/**
 * Lift loss of a foil running near the free surface, high-Froude-number limit.
 * The surface acts like a mirror-image vortex; the commonly used fit is
 *
 *   k_FS = CL(h) / CL(∞) = (16 (h/c)² + 1) / (16 (h/c)² + 2)
 *
 * which gives ½ at the surface and → 1 when deep (≈ 0.94 at one chord).
 * Ref: Hoerner & Borst, Fluid-Dynamic Lift (1985), ch. 10 (hydrofoils).
 */
export function freeSurfaceFactor(depthOverChord: number): number {
  const h2 = 16 * depthOverChord * depthOverChord;
  return (h2 + 1) / (h2 + 2);
}

/** Depth/chord below which lift loss and ventilation become a concern. */
export const SHALLOW_H_OVER_C = 1;
export const VENTILATION_H_OVER_C = 0.5;
