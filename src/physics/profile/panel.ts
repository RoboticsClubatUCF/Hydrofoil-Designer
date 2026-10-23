/**
 * Linear-strength vortex panel method (inviscid, incompressible).
 *
 * Nodes run TE(upper) → LE → TE(lower), i.e. counter-clockwise. The vortex
 * strength γ varies linearly along each panel; with the body interior at rest,
 * γ at a node equals the surface speed along the node direction. Flow tangency
 * is enforced at panel midpoints plus the Kutta condition γ₀ + γ_N = 0.
 *
 * The problem is linear in the freestream, so it is solved once for a freestream
 * along x and once along y; any angle of attack is a superposition.
 *
 * At a sharp trailing edge the two coincident end nodes form a nearly singular
 * pair, so the two nodes nearest each trailing edge are replaced by linear
 * extrapolation from the next two. Their panels are tiny, so forces are unaffected.
 *
 * Ref: Katz & Plotkin, Low-Speed Aerodynamics (2nd ed.), §11.4; Kuethe & Chow.
 */
import { luFactor } from '../numeric';
import type { Pt } from './parse';

export interface PanelSolution {
  nodes: Pt[];
  /** Arc length at each node from the upper trailing edge. */
  s: number[];
  /** Node surface speed (signed, along node order) for unit freestream along x / along y. */
  g0: number[];
  g90: number[];
}

export interface PanelResult {
  alpha: number;
  cl: number;
  cm: number; // about quarter chord, nose-up positive
  /** Signed surface speed at nodes (V∞ = 1), positive along node order. */
  vt: number[];
  cp: number[];
  cpMin: number;
  xCpMin: number;
}

export function solvePanels(nodes: Pt[]): PanelSolution {
  const N = nodes.length - 1; // panels
  const tx: number[] = [],
    ty: number[] = [],
    len: number[] = [],
    mx: number[] = [],
    my: number[] = [];
  for (let j = 0; j < N; j++) {
    const dx = nodes[j + 1].x - nodes[j].x,
      dy = nodes[j + 1].y - nodes[j].y;
    const l = Math.hypot(dx, dy);
    len.push(l);
    tx.push(dx / l);
    ty.push(dy / l);
    mx.push((nodes[j].x + nodes[j + 1].x) / 2);
    my.push((nodes[j].y + nodes[j + 1].y) / 2);
  }
  const A: number[][] = Array.from({ length: N + 1 }, () => new Array<number>(N + 1).fill(0));
  const K = 1 / (2 * Math.PI);
  for (let i = 0; i < N; i++) {
    const nix = -ty[i],
      niy = tx[i]; // left (inward) normal — any consistent normal works for a zero condition
    for (let j = 0; j < N; j++) {
      let I0: number, I1: number;
      const l = len[j];
      let x: number, z: number;
      if (i === j) {
        x = l / 2;
        z = 0;
        I0 = -Math.PI; // outside of the body is to the right of the panel
        I1 = 0;
      } else {
        const dx = mx[i] - nodes[j].x,
          dy = my[i] - nodes[j].y;
        x = dx * tx[j] + dy * ty[j];
        z = -dx * ty[j] + dy * tx[j];
        I0 = Math.atan2(z, x - l) - Math.atan2(z, x);
        if (I0 > Math.PI) I0 -= 2 * Math.PI;
        if (I0 < -Math.PI) I0 += 2 * Math.PI;
        I1 = 0.5 * Math.log((x * x + z * z) / ((x - l) * (x - l) + z * z));
      }
      // ∫ξ z/D dξ and ∫ξ (x−ξ)/D dξ over the panel, D = (x−ξ)² + z²
      const J0 = x * I0 - z * I1;
      const J1 = x * I1 - l + z * I0;
      // γ(ξ) = γa(1 − ξ/l) + γb ξ/l; counter-clockwise vortex: u = −K∫γ z/D, w = K∫γ (x−ξ)/D
      const ua = -K * (I0 - J0 / l),
        ub = -K * (J0 / l);
      const wa = K * (I1 - J1 / l),
        wb = K * (J1 / l);
      const nlx = -ty[j],
        nly = tx[j];
      A[i][j] += (ua * tx[j] + wa * nlx) * nix + (ua * ty[j] + wa * nly) * niy;
      A[i][j + 1] += (ub * tx[j] + wb * nlx) * nix + (ub * ty[j] + wb * nly) * niy;
    }
  }
  A[N][0] = 1;
  A[N][N] = 1;
  const solve = luFactor(A);
  const s = [0];
  for (let j = 0; j < N; j++) s.push(s[j] + len[j]);
  const run = (ux: number, uy: number) => {
    const b = new Array<number>(N + 1).fill(0);
    for (let i = 0; i < N; i++) b[i] = -(ux * -ty[i] + uy * tx[i]);
    return repairTrailingEdge(solve(b), s);
  };
  return { nodes, s, g0: run(1, 0), g90: run(0, 1) };
}

function repairTrailingEdge(g: number[], s: number[]): number[] {
  const n = g.length;
  if (n < 10) return g;
  const out = g.slice();
  const ext = (k: number, a: number, b: number) =>
    g[a] + ((g[b] - g[a]) * (s[k] - s[a])) / (s[b] - s[a]);
  out[0] = ext(0, 2, 3);
  out[1] = ext(1, 2, 3);
  out[n - 1] = ext(n - 1, n - 3, n - 4);
  out[n - 2] = ext(n - 2, n - 3, n - 4);
  return out;
}

export function panelAt(sol: PanelSolution, alpha: number): PanelResult {
  const ca = Math.cos(alpha),
    sa = Math.sin(alpha);
  const n = sol.nodes.length;
  const vt = new Array<number>(n);
  const cp = new Array<number>(n);
  let cpMin = Infinity,
    xCpMin = 0;
  for (let k = 0; k < n; k++) {
    vt[k] = ca * sol.g0[k] + sa * sol.g90[k];
    cp[k] = 1 - vt[k] * vt[k];
    if (cp[k] < cpMin) {
      cpMin = cp[k];
      xCpMin = sol.nodes[k].x;
    }
  }
  let fx = 0,
    fy = 0,
    m = 0;
  for (let j = 0; j < n - 1; j++) {
    const a = sol.nodes[j],
      b = sol.nodes[j + 1];
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const cpm = 0.5 * (cp[j] + cp[j + 1]);
    // force = −Cp · (outward normal · length), outward normal · length = (dy, −dx)
    const dfx = -cpm * dy,
      dfy = cpm * dx;
    fx += dfx;
    fy += dfy;
    const rx = 0.5 * (a.x + b.x) - 0.25,
      ry = 0.5 * (a.y + b.y);
    m += -(rx * dfy - ry * dfx);
  }
  const cl = fy * ca - fx * sa;
  return { alpha, cl, cm: m, vt, cp, cpMin, xCpMin };
}

/** Inviscid lift-curve slope (per rad) and zero-lift angle (rad). */
export function inviscidLiftLine(sol: PanelSolution): { a0: number; alphaL0: number } {
  const r1 = panelAt(sol, (-2 * Math.PI) / 180);
  const r2 = panelAt(sol, (4 * Math.PI) / 180);
  const a0 = (r2.cl - r1.cl) / (r2.alpha - r1.alpha);
  return { a0, alphaL0: r1.alpha - r1.cl / a0 };
}

/** Angle (rad) at which the inviscid solution produces a target cl. */
export function alphaForCl(sol: PanelSolution, cl: number): number {
  const { a0, alphaL0 } = inviscidLiftLine(sol);
  let a = alphaL0 + cl / a0;
  let a1 = a + 0.01;
  let f = panelAt(sol, a).cl - cl;
  for (let i = 0; i < 8 && Math.abs(f) > 1e-10; i++) {
    const f1 = panelAt(sol, a1).cl - cl;
    if (f1 === f) break;
    const next = a1 - (f1 * (a1 - a)) / (f1 - f);
    a = a1;
    f = f1;
    a1 = next;
  }
  return a1;
}
