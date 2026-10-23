/**
 * Bending of a solid foil carried by a centre strut (T-foil): each half-span is a
 * cantilever from the root. The spanwise lift comes from the lifting-line shape;
 * section properties scale from the unit-chord profile (I ∝ c⁴).
 */
import { chordRatio, type PlanformType } from '../wing/planform';

export interface BeamResult {
  /** η = 2y/b from root (0) to tip (1) */
  eta: number[];
  /** bending moment, N·m */
  moment: number[];
  /** bending stress at the extreme fibre, Pa */
  stress: number[];
  /** vertical deflection, m */
  deflection: number[];
  tipDeflection: number;
  maxStress: number;
  etaMaxStress: number;
}

/**
 * @param lift total foil lift (N), shared equally between the halves
 * @param loadShape half-span load per unit η with ∫₀¹ w dη = 1, sampled on etaIn
 */
export function cantileverBending(
  lift: number,
  span: number,
  rootChord: number,
  type: PlanformType,
  lambda: number,
  etaIn: number[],
  loadShape: number[],
  ixx1: number,
  z1: number,
  E: number,
): BeamResult {
  const n = etaIn.length;
  const half = span / 2;
  const L2 = lift / 2;
  // load per unit length along y: q(y) = L2 · w(η) / half
  const moment = new Array<number>(n).fill(0);
  // M(η0) = L2 · half · ∫_{η0}^1 w(η)(η − η0) dη  → integrate from tip inwards
  for (let i = n - 1; i >= 0; i--) {
    let s = 0;
    for (let j = i + 1; j < n; j++) {
      const d = etaIn[j] - etaIn[j - 1];
      s +=
        0.5 *
        (loadShape[j] * (etaIn[j] - etaIn[i]) + loadShape[j - 1] * (etaIn[j - 1] - etaIn[i])) *
        d;
    }
    moment[i] = L2 * half * s;
  }
  const stress: number[] = [];
  const curvature: number[] = [];
  for (let i = 0; i < n; i++) {
    const c = rootChord * chordRatio(type, lambda, etaIn[i]);
    const I = ixx1 * c ** 4;
    const Z = z1 * c ** 3;
    stress.push(c > 1e-9 ? moment[i] / Z : 0);
    curvature.push(c > 1e-9 ? moment[i] / (E * I) : (curvature[i - 1] ?? 0));
  }
  // integrate twice from the root (slope = 0, deflection = 0 at the root)
  const slope = new Array<number>(n).fill(0);
  const deflection = new Array<number>(n).fill(0);
  for (let i = 1; i < n; i++) {
    const dy = (etaIn[i] - etaIn[i - 1]) * half;
    slope[i] = slope[i - 1] + 0.5 * (curvature[i] + curvature[i - 1]) * dy;
    deflection[i] = deflection[i - 1] + 0.5 * (slope[i] + slope[i - 1]) * dy;
  }
  let maxStress = 0,
    etaMaxStress = 0;
  stress.forEach((s, i) => {
    if (s > maxStress) {
      maxStress = s;
      etaMaxStress = etaIn[i];
    }
  });
  return {
    eta: etaIn,
    moment,
    stress,
    deflection,
    tipDeflection: deflection[n - 1],
    maxStress,
    etaMaxStress,
  };
}
