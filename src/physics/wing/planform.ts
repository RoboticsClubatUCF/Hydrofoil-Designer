/** Planform shapes for a straight (unswept, untwisted) foil. η = 2|y|/b runs 0 at the root to 1 at the tip. */

export type PlanformType = 'rectangular' | 'tapered' | 'elliptical';

export const PLANFORM_LABEL: Record<PlanformType, string> = {
  rectangular: 'Rectangular',
  tapered: 'Tapered',
  elliptical: 'Elliptical',
};

/** Chord at η as a fraction of root chord. */
export function chordRatio(type: PlanformType, lambda: number, eta: number): number {
  switch (type) {
    case 'rectangular':
      return 1;
    case 'tapered':
      return 1 - (1 - lambda) * eta;
    case 'elliptical':
      return Math.sqrt(Math.max(0, 1 - eta * eta));
  }
}

/** Mean geometric chord / root chord  (c̄ = S / b). */
export function meanChordRatio(type: PlanformType, lambda: number): number {
  switch (type) {
    case 'rectangular':
      return 1;
    case 'tapered':
      return (1 + lambda) / 2;
    case 'elliptical':
      return Math.PI / 4;
  }
}

/** Mean aerodynamic chord / root chord. */
export function macRatio(type: PlanformType, lambda: number): number {
  switch (type) {
    case 'rectangular':
      return 1;
    case 'tapered':
      return ((2 / 3) * (1 + lambda + lambda * lambda)) / (1 + lambda);
    case 'elliptical':
      return 8 / (3 * Math.PI);
  }
}

/** ∫c² dy over the full span divided by (b · c_r²) — used for foil volume and mass. */
export function chordSquaredRatio(type: PlanformType, lambda: number): number {
  switch (type) {
    case 'rectangular':
      return 1;
    case 'tapered':
      return (1 + lambda + lambda * lambda) / 3;
    case 'elliptical':
      return 2 / 3;
  }
}

/** Planform outline (one half, root at y = 0) for drawings, in units of the given root chord and span. */
export function planformOutline(
  type: PlanformType,
  lambda: number,
  span: number,
  rootChord: number,
  n = 60,
) {
  const pts: { y: number; xLE: number; xTE: number }[] = [];
  for (let i = 0; i <= n; i++) {
    const eta = i / n;
    const c = rootChord * chordRatio(type, lambda, eta);
    // quarter-chord line kept straight (unswept)
    const xq = 0.25 * rootChord;
    pts.push({ y: (eta * span) / 2, xLE: xq - 0.25 * c, xTE: xq + 0.75 * c });
  }
  return pts;
}
