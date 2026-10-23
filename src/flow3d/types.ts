/** Data passed from the calculation worker to the 3-D view (plain, structured-clone friendly). */
import type { PlanformType } from '../physics/wing/planform';
import type { WakeInfo } from './vortex';

/** Operating state of one foil at the speed, load and depth chosen in the 3-D view. */
export interface FoilOp {
  V: number;
  /** lift the foil has to carry, N */
  Lreq: number;
  /** lift it produces (less than Lreq when stalled), N */
  L: number;
  q: number;
  Re: number;
  h: number;
  hc: number;
  kFS: number;
  alphaL0: number;
  a0: number;
  CLa: number;
  e: number;
  kPeak: number;
  CLreq: number;
  CL: number;
  CLmax: number;
  stalled: boolean;
  /** geometric angle of attack to the local flow, rad */
  alpha: number;
  alphaStall: number;
  stallMargin: number;
  CDp: number;
  CDi: number;
  D: number;
  P: number;
  LD: number;
  sigma: number;
  cpMin: number;
  cavMargin: number;
  /** cavitation inception speed at this load and depth, m/s (null: none below 80 m/s) */
  Vcav: number | null;
  /** mean flow angle induced by the other foil at this foil (negative = downwash), rad */
  otherAngle: number;
  /** largest gap between the local inflow angle and the panel angle for the design circulation, rad */
  angleGap: number;
}

export interface FlowFoil {
  name: string;
  planform: PlanformType;
  lambda: number;
  b: number;
  cr: number;
  S: number;
  AR: number;
  mac: number;
  /** quarter-chord line */
  x0: number;
  z0: number;
  /** nose-up pitch relative to the free stream, rad (α plus the other foil's induced angle) */
  pitch: number;
  op: FoilOp;
  /** near-field panel nodes ξ ζ (unit chord, quarter chord at origin) and strengths */
  nodes: Float32Array;
  g0: Float32Array;
  g90: Float32Array;
  /** upper/lower surface at x = s² (unit chord, LE at 0) */
  profU: Float32Array;
  profL: Float32Array;
  area1: number;
  xCentroid: number;
  /** stations uniform in η = 2|y|/b: chord, a0, a90, G (4 per station) */
  st: Float32Array;
  /** design-load section cl and circulation Γ (m²/s) at each station */
  stCl: Float32Array;
  stGamma: Float32Array;
  /** mesh section (unit chord, LE at 0), x y pairs, and Cp at those nodes per station */
  meshNodes: Float32Array;
  cp: Float32Array;
  wake: WakeInfo;
}

export interface FlowState {
  V: number;
  rho: number;
  nu: number;
  patm: number;
  pv: number;
  nStation: number;
  /** vortex segments incl. free-surface images, SEG_STRIDE floats each */
  segs: Float32Array;
  nSeg: number;
  foils: FlowFoil[];
  /** reference length for scene sizing, m */
  lref: number;
}

export interface FlowFoilRequest {
  name: string;
  /** which worker section to use */
  slot: 1 | 2;
  planform: PlanformType;
  /** design values of this foil (main-foil ids) */
  values: Record<string, number>;
  /** quarter-chord x position, m */
  x0: number;
  /** depth of the quarter chord below the surface, m */
  h: number;
}

export interface FlowRequest {
  V: number;
  /** multiplies each foil's design lift */
  loadFactor: number;
  foils: FlowFoilRequest[];
  nSpan: number;
}
