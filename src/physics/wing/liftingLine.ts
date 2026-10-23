/**
 * Prandtl lifting-line theory solved with Glauert's Fourier series (symmetric
 * loading, odd terms only) for an unswept, untwisted foil.
 *
 *   Γ(θ) = 2 b V Σ Aₙ sin(nθ),  y = (b/2) cos θ
 *   Σ Aₙ sin(nθᵢ) (sin θᵢ + n μᵢ) = μᵢ (α − α_L0) sin θᵢ,  μ = a₀ c / (4b)
 *
 * Solved for unit (α − α_L0) so results scale linearly with angle.
 * Ref: Anderson, Fundamentals of Aerodynamics, §5.3; Glauert (1926).
 */
import { solveLinear } from '../numeric';
import { chordRatio, meanChordRatio, type PlanformType } from './planform';

export interface LiftingLineResult {
  /** dCL/dα per radian for the finite foil */
  CLalpha: number;
  /** span efficiency e = 1/(1+δ) */
  e: number;
  delta: number;
  /** largest local cl divided by CL (≥ 1 except elliptical) */
  clPeakRatio: number;
  /** spanwise station of that peak, η */
  etaPeak: number;
  /** centroid of half-span load as a fraction of semi-span */
  loadCentroid: number;
  /** half-span distributions for plots and structure (η from 0 root to 1 tip) */
  eta: number[];
  /** local cl / CL */
  clRatio: number[];
  /** load per unit span normalised so ∫₀¹ w dη = 1 */
  loadShape: number[];
}

const cache = new Map<string, LiftingLineResult>();

export function liftingLine(
  type: PlanformType,
  AR: number,
  lambda: number,
  a0: number,
  terms = 24,
): LiftingLineResult {
  const key = `${type}|${AR.toPrecision(6)}|${type === 'tapered' ? lambda.toPrecision(6) : 1}|${a0.toPrecision(6)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const M = terms;
  const ns = Array.from({ length: M }, (_, k) => 2 * k + 1);
  // b / c_r from AR: S = b · c̄ = b · c_r · m  →  AR = b / (c_r · m)
  const m = meanChordRatio(type, lambda);
  const bOverCr = AR * m;
  const A: number[][] = [];
  const rhs: number[] = [];
  for (let i = 1; i <= M; i++) {
    const th = (i * Math.PI) / (2 * M);
    const eta = Math.cos(th);
    const cr = chordRatio(type, lambda, eta);
    const mu = (a0 * cr) / (4 * bOverCr);
    A.push(ns.map((n) => Math.sin(n * th) * (Math.sin(th) + n * mu)));
    rhs.push(mu * Math.sin(th));
  }
  const An = solveLinear(A, rhs);
  const A1 = An[0];
  const CLalpha = Math.PI * AR * A1;
  let delta = 0;
  for (let k = 1; k < M; k++) delta += ns[k] * (An[k] / A1) ** 2;
  const e = 1 / (1 + delta);

  // distributions
  const NPTS = 101;
  const eta: number[] = [],
    clRatio: number[] = [],
    gam: number[] = [];
  let clPeakRatio = 0,
    etaPeak = 0;
  for (let j = 0; j < NPTS; j++) {
    const et = j / (NPTS - 1);
    const th = Math.acos(Math.min(1, et));
    let s = 0;
    for (let k = 0; k < M; k++) s += An[k] * Math.sin(ns[k] * th);
    // Γ/(bV) = 2 s ; local cl = 2Γ/(V c) = 4 b s / c ; CL = π AR A1
    const c = chordRatio(type, lambda, et);
    let cl: number;
    if (c > 1e-9) cl = (4 * bOverCr * s) / c;
    else {
      // elliptical tip limit: use the neighbour value (finite for elliptic loading)
      cl = clRatio.length ? clRatio[clRatio.length - 1] * CLalpha : CLalpha;
    }
    eta.push(et);
    gam.push(2 * s);
    clRatio.push(cl / CLalpha);
    if (cl / CLalpha > clPeakRatio && et < 0.98) {
      clPeakRatio = cl / CLalpha;
      etaPeak = et;
    }
  }
  // normalise load shape ∫₀¹ w dη = 1 and centroid
  let area = 0,
    mom = 0;
  for (let j = 1; j < NPTS; j++) {
    const d = eta[j] - eta[j - 1];
    area += 0.5 * (gam[j] + gam[j - 1]) * d;
    mom += 0.5 * (gam[j] * eta[j] + gam[j - 1] * eta[j - 1]) * d;
  }
  const loadShape = gam.map((g) => g / area);
  const res: LiftingLineResult = {
    CLalpha,
    e,
    delta,
    clPeakRatio,
    etaPeak,
    loadCentroid: mom / area,
    eta,
    clRatio,
    loadShape,
  };
  if (cache.size > 5000) cache.clear();
  cache.set(key, res);
  return res;
}
