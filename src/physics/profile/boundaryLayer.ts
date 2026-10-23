/**
 * Integral boundary-layer march on the inviscid surface speed (no viscous–inviscid
 * coupling), used to estimate section drag, transition and separation when no
 * polar data is supplied.
 *
 *  - Laminar: Thwaites' method with the Cebeci–Bradshaw fits for H(λ) and l(λ).
 *  - Transition: Michel's criterion, or laminar separation (assumed to reattach
 *    turbulent as a short bubble).
 *  - Turbulent: Head's entrainment method with the Ludwieg–Tillmann skin friction.
 *  - Drag: Squire–Young formula applied at the trailing edge of each surface.
 *
 * All quantities are non-dimensional (V∞ = 1, chord = 1).
 */
import type { PanelResult, PanelSolution } from './panel';

export interface SurfaceBL {
  /** chordwise transition location (x/c) */
  xTransition: number;
  /** true if transition was triggered by laminar separation (a separation bubble) */
  bubble: boolean;
  /** chordwise turbulent-separation location, or null if attached to the TE */
  xSeparation: number | null;
  thetaTE: number;
  hTE: number;
  ueTE: number;
  cd: number;
  /** For plotting: chordwise x and shape factor along the surface */
  x: number[];
  H: number[];
  cf: number[];
}

export interface SectionBL {
  upper: SurfaceBL;
  lower: SurfaceBL;
  cd: number;
}

const H_SEP_TURB = 2.4;

function H1ofH(H: number): number {
  return H <= 1.6
    ? 3.3 + 0.8234 * Math.pow(H - 1.1, -1.287)
    : 3.3 + 1.5501 * Math.pow(H - 0.6778, -3.064);
}

function HofH1(H1: number): number {
  if (H1 <= 3.32) return 3.0;
  return H1 >= 5.3
    ? 1.1 + Math.pow((H1 - 3.3) / 0.8234, -1 / 1.287)
    : 0.6778 + Math.pow((H1 - 3.3) / 1.5501, -1 / 3.064);
}

function thwaitesH(lam: number): { H: number; l: number } {
  if (lam >= 0) {
    const L = Math.min(lam, 0.1);
    return { H: 2.61 - 3.75 * L + 5.24 * L * L, l: 0.22 + 1.57 * L - 1.8 * L * L };
  }
  const L = Math.max(lam, -0.1);
  return { H: 2.088 + 0.0731 / (L + 0.14), l: 0.22 + 1.402 * L + (0.018 * L) / (L + 0.107) };
}

/** March one surface. xi: distance from stagnation (starts > 0), ue: speed (> 0), x: chordwise position. */
export function marchSurface(xi: number[], ue: number[], x: number[], Re: number): SurfaceBL {
  const n = xi.length;
  const outX: number[] = [],
    outH: number[] = [],
    outCf: number[] = [];
  const due = (i: number) => {
    const a = Math.max(0, i - 1),
      b = Math.min(n - 1, i + 1);
    return (ue[b] - ue[a]) / (xi[b] - xi[a] || 1e-12);
  };
  // --- laminar (Thwaites) ---
  let integral = (Math.pow(ue[0], 5) * xi[0]) / 6; // ue ≈ kξ near the stagnation point
  let theta = Math.sqrt((0.45 / Re) * (integral / Math.pow(ue[0], 6)));
  let i = 0;
  let bubble = false;
  let transitioned = false;
  for (; i < n; i++) {
    if (i > 0) {
      integral += 0.5 * (Math.pow(ue[i], 5) + Math.pow(ue[i - 1], 5)) * (xi[i] - xi[i - 1]);
      theta = Math.sqrt((0.45 / Re) * (integral / Math.pow(ue[i], 6)));
    }
    const lam = theta * theta * due(i) * Re;
    const { H, l } = thwaitesH(lam);
    outX.push(x[i]);
    outH.push(H);
    outCf.push((2 * l) / (Re * ue[i] * theta));
    const ReTheta = Re * ue[i] * theta;
    const ReX = Re * ue[i] * xi[i];
    const michel = 1.174 * (1 + 22400 / ReX) * Math.pow(ReX, 0.46);
    if (lam < -0.09) {
      bubble = true;
      transitioned = true;
      break;
    }
    if (ReTheta > michel && i > 0) {
      transitioned = true;
      break;
    }
  }
  if (!transitioned) {
    const H = outH[outH.length - 1];
    return {
      xTransition: 1,
      bubble: false,
      xSeparation: null,
      thetaTE: theta,
      hTE: H,
      ueTE: ue[n - 1],
      cd: 2 * theta * Math.pow(ue[n - 1], (H + 5) / 2),
      x: outX,
      H: outH,
      cf: outCf,
    };
  }
  const xTransition = x[i];
  // --- turbulent (Head) ---
  let H = 1.4;
  let Y = ue[i] * theta * H1ofH(H); // ue θ H1
  let xSeparation: number | null = null;
  const rhs = (
    xiv: number,
    th: number,
    Yv: number,
    ueAt: (s: number) => number,
    dueAt: (s: number) => number,
  ) => {
    const u = ueAt(xiv);
    const H1 = Math.max(3.33, Yv / (u * th));
    const Hh = Math.min(HofH1(H1), H_SEP_TURB + 0.6);
    const ReT = Math.max(Re * u * th, 50);
    const cf = 0.246 * Math.pow(10, -0.678 * Hh) * Math.pow(ReT, -0.268);
    const dth = cf / 2 - ((Hh + 2) * th * dueAt(xiv)) / u;
    const dY = u * 0.0306 * Math.pow(Math.max(H1 - 3, 1e-6), -0.6169);
    return { dth, dY, H: Hh, cf };
  };
  for (let k = i; k < n - 1; k++) {
    const x0 = xi[k],
      x1 = xi[k + 1];
    const u0 = ue[k],
      u1 = ue[k + 1];
    const slope = (u1 - u0) / (x1 - x0 || 1e-12);
    const ueAt = (s: number) => Math.max(1e-6, u0 + slope * (s - x0));
    const dueAt = () => slope;
    const sub = 4;
    const h = (x1 - x0) / sub;
    for (let m = 0; m < sub; m++) {
      const s0 = x0 + m * h;
      const k1 = rhs(s0, theta, Y, ueAt, dueAt);
      const thP = Math.max(1e-9, theta + h * k1.dth);
      const YP = Y + h * k1.dY;
      const k2 = rhs(s0 + h, thP, YP, ueAt, dueAt);
      theta = Math.max(1e-9, theta + 0.5 * h * (k1.dth + k2.dth));
      Y = Y + 0.5 * h * (k1.dY + k2.dY);
      H = k2.H;
      // Past separation, hold H at the separation value so θ keeps growing in the
      // adverse gradient without the shape factor running away.
      if (H >= H_SEP_TURB) {
        if (xSeparation === null) xSeparation = x[k];
        H = H_SEP_TURB;
        Y = ueAt(s0 + h) * theta * H1ofH(H);
      }
    }
    const fin = rhs(x1, theta, Y, ueAt, dueAt);
    outX.push(x[k + 1]);
    outH.push(H);
    outCf.push(fin.cf);
  }
  const ueTE = ue[n - 1];
  return {
    xTransition,
    bubble,
    xSeparation,
    thetaTE: theta,
    hTE: H,
    ueTE,
    cd: 2 * theta * Math.pow(ueTE, (H + 5) / 2),
    x: outX,
    H: outH,
    cf: outCf,
  };
}

/** Run both surfaces for one inviscid solution. */
export function sectionBoundaryLayer(sol: PanelSolution, res: PanelResult, Re: number): SectionBL {
  const vt = res.vt;
  const n = vt.length;
  // stagnation point: sign change of vt (negative on upper, positive on lower)
  let k = -1;
  let best = Infinity;
  for (let j = 0; j < n - 1; j++) {
    if (vt[j] <= 0 && vt[j + 1] > 0) {
      const d = Math.abs(sol.nodes[j].x); // prefer the change nearest the leading edge
      if (d < best) {
        best = d;
        k = j;
      }
    }
  }
  if (k < 0) k = n >> 1;
  const f = vt[k] / (vt[k] - vt[k + 1] || 1e-12);
  const sStag = sol.s[k] + f * (sol.s[k + 1] - sol.s[k]);
  const up = { xi: [] as number[], ue: [] as number[], x: [] as number[] };
  for (let j = k; j >= 0; j--) {
    const xi = sStag - sol.s[j];
    if (xi <= 1e-9) continue;
    up.xi.push(xi);
    up.ue.push(Math.max(1e-6, Math.abs(vt[j])));
    up.x.push(sol.nodes[j].x);
  }
  const lo = { xi: [] as number[], ue: [] as number[], x: [] as number[] };
  for (let j = k + 1; j < n; j++) {
    const xi = sol.s[j] - sStag;
    if (xi <= 1e-9) continue;
    lo.xi.push(xi);
    lo.ue.push(Math.max(1e-6, Math.abs(vt[j])));
    lo.x.push(sol.nodes[j].x);
  }
  const upper = marchSurface(up.xi, up.ue, up.x, Re);
  const lower = marchSurface(lo.xi, lo.ue, lo.x, Re);
  return { upper, lower, cd: upper.cd + lower.cd };
}
