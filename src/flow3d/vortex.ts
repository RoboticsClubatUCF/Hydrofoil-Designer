/**
 * Vortex model of a lifting foil for the 3-D flow view.
 *
 * Coordinates (metres): x downstream, y along the span, z up; the undisturbed
 * free surface is z = 0. The foil carries the lifting-line circulation Γ(y)
 * (bound vortex on the quarter-chord line). Where Γ changes along the span,
 * vorticity is shed from the trailing edge and rolls up into the two tip
 * vortices (prescribed wake: filaments drift to the centroid of the shed
 * vorticity and the pair descends at Γ₀ / (2π b′)).
 *
 * The free surface is represented by mirror images above z = 0 with the same
 * strength. That makes the potential zero on z = 0, the high-Froude-number
 * limit used for the design's free-surface lift factor.
 *
 * Each segment is stored as 8 floats: ax ay az bx by bz Γ rc, where the vortex
 * vector points from a to b and rc is the core radius.
 */

export const SEG_STRIDE = 8;
const FOUR_PI = 4 * Math.PI;

/** Add the velocity induced at (px,py,pz) by every segment to out[0..2]. */
export function addSegmentVelocity(
  seg: ArrayLike<number>,
  n: number,
  px: number,
  py: number,
  pz: number,
  out: Float64Array | number[],
): void {
  let vx = 0,
    vy = 0,
    vz = 0;
  for (let i = 0; i < n; i++) {
    const o = i * SEG_STRIDE;
    const ax = seg[o],
      ay = seg[o + 1],
      az = seg[o + 2];
    const bx = seg[o + 3],
      by = seg[o + 4],
      bz = seg[o + 5];
    const r1x = px - ax,
      r1y = py - ay,
      r1z = pz - az;
    const r2x = px - bx,
      r2y = py - by,
      r2z = pz - bz;
    const cx = r1y * r2z - r1z * r2y;
    const cy = r1z * r2x - r1x * r2z;
    const cz = r1x * r2y - r1y * r2x;
    const r0x = bx - ax,
      r0y = by - ay,
      r0z = bz - az;
    const L2 = r0x * r0x + r0y * r0y + r0z * r0z;
    const rc = seg[o + 7];
    const den = cx * cx + cy * cy + cz * cz + rc * rc * L2;
    if (den < 1e-24) continue;
    const l1 = Math.sqrt(r1x * r1x + r1y * r1y + r1z * r1z);
    const l2 = Math.sqrt(r2x * r2x + r2y * r2y + r2z * r2z);
    if (l1 < 1e-12 || l2 < 1e-12) continue;
    const dot =
      r0x * (r1x / l1 - r2x / l2) + r0y * (r1y / l1 - r2y / l2) + r0z * (r1z / l1 - r2z / l2);
    const k = (seg[o + 6] * dot) / (FOUR_PI * den);
    vx += k * cx;
    vy += k * cy;
    vz += k * cz;
  }
  out[0] += vx;
  out[1] += vy;
  out[2] += vz;
}

export interface VortexFoilInput {
  /** quarter-chord line position */
  x0: number;
  z0: number;
  /** span, m */
  b: number;
  /** nose-up pitch relative to the free stream, rad */
  pitch: number;
  /** free-stream speed, m/s */
  V: number;
  chordAt: (eta: number) => number;
  /** circulation at η = 2|y|/b, m²/s, positive for upward lift */
  gammaAt: (eta: number) => number;
  /** spanwise bound segments (even) */
  nSpan: number;
}

export interface WakeInfo {
  /** semi-span position of each rolled-up tip vortex, m */
  yTip: number;
  /** distance behind the trailing edge where roll-up is complete, m */
  xRoll: number;
  /** descent rate of the vortex pair, m/s */
  descent: number;
  /** total circulation of each tip vortex, m²/s */
  gammaTip: number;
  /** core radius of the rolled-up vortices, m */
  core: number;
  /** tip-vortex path (one side, y > 0), x y z triplets */
  path: number[];
}

const NWAKE = 6;

/**
 * Bound, trailing and tip-vortex segments of one foil (no images).
 * Returns the segment list and the prescribed wake used.
 */
export function foilVortexSegments(f: VortexFoilInput, CL: number, AR: number) {
  const N = f.nSpan;
  const half = f.b / 2;
  const segs: number[] = [];
  const push = (
    a: [number, number, number],
    b: [number, number, number],
    gam: number,
    rc: number,
  ) => segs.push(a[0], a[1], a[2], b[0], b[1], b[2], gam, rc);

  const cp = Math.cos(f.pitch),
    sp = Math.sin(f.pitch);
  const qc = (y: number): [number, number, number] => [f.x0, y, f.z0];
  const te = (y: number): [number, number, number] => {
    const c = f.chordAt(Math.min(1, Math.abs(y) / half));
    return [f.x0 + 0.75 * c * cp, y, f.z0 - 0.75 * c * sp];
  };

  // spanwise edges (cosine spacing, finer at the tips) and segment circulations
  const edge: number[] = [];
  for (let k = 0; k <= N; k++) edge.push(-half * Math.cos((k * Math.PI) / N));
  edge[N / 2] = 0;
  const gam: number[] = [];
  for (let i = 0; i < N; i++) {
    // average over the segment (Simpson) so the total lift is kept
    const ya = Math.abs(edge[i]),
      yb = Math.abs(edge[i + 1]);
    const ym = (ya + yb) / 2;
    gam.push((f.gammaAt(ya / half) + 4 * f.gammaAt(ym / half) + f.gammaAt(yb / half)) / 6);
  }
  const cRoot = f.chordAt(0);
  const g0 = Math.max(...gam.map(Math.abs), 1e-12);

  // centroid of the shed vorticity on one side: b′/2 = ∫₀^{b/2} Γ dy / Γ(0)
  let area = 0;
  for (let i = N / 2; i < N; i++) area += gam[i] * (edge[i + 1] - edge[i]);
  const gRoot = gam[N / 2];
  const yTip = gRoot > 0 ? Math.min(0.98 * half, Math.max(0.5 * half, area / gRoot)) : 0.8 * half;
  // roll-up distance ≈ 0.28·AR/CL spans (Spreiter & Sacks), kept to 1–6 spans for display
  const xRoll = f.b * Math.min(6, Math.max(1, (0.28 * AR) / Math.max(Math.abs(CL), 0.05)));
  const descent = Math.abs(gRoot) / (2 * Math.PI * 2 * yTip);
  const slope = descent / Math.max(f.V, 1e-3);
  const core = Math.max(0.035 * f.b, 0.04 * cRoot);

  // bound vortex
  for (let i = 0; i < N; i++) push(qc(edge[i]), qc(edge[i + 1]), gam[i], 1e-3 * cRoot);

  // trailing filaments: QC → TE → rolled-up wake → merge into the tip vortex
  let xTEmax = -Infinity;
  for (let k = 0; k <= N; k++) xTEmax = Math.max(xTEmax, te(edge[k])[0]);
  const zTE = te(0)[2];
  const R = (t: number) => 1 - Math.pow(1 - Math.min(1, t), 3);
  const merge: Record<number, [number, number, number]> = {};
  const tipGamma: Record<number, number> = { 1: 0, [-1]: 0 };
  for (let k = 0; k <= N; k++) {
    const s = (k > 0 ? gam[k - 1] : 0) - (k < N ? gam[k] : 0);
    if (Math.abs(s) < 1e-9 * g0) continue;
    const y = edge[k];
    const side = y >= 0 ? 1 : -1;
    const dy = Math.min(
      k > 0 ? Math.abs(edge[k] - edge[k - 1]) : Infinity,
      k < N ? Math.abs(edge[k + 1] - edge[k]) : Infinity,
    );
    const rc0 = Math.max(0.5 * dy, 0.01 * cRoot);
    const a = qc(y);
    const t = te(y);
    push(a, t, s, rc0);
    let prev = t;
    for (let j = 1; j <= NWAKE; j++) {
      const tt = (j / NWAKE) ** 2;
      const d = xRoll * tt;
      const r = R(tt);
      const p: [number, number, number] = [
        xTEmax + d,
        y + (side * yTip - y) * r,
        zTE + (t[2] - zTE) * (1 - r) - slope * d * r,
      ];
      const rcm = rc0 + (core - rc0) * R(((j - 0.5) / NWAKE) ** 2);
      push(prev, p, s, rcm);
      prev = p;
    }
    merge[side] = prev;
    tipGamma[side] += s;
  }

  // rolled-up tip vortices continuing downstream (last point far away ≈ semi-infinite)
  const path: number[] = [];
  for (const side of [1, -1]) {
    const m = merge[side];
    if (!m) continue;
    let prev = m;
    if (side === 1) path.push(...m);
    for (const d of [0.5, 1.5, 3.5, 7.5, 200]) {
      const dist = d * f.b;
      const p: [number, number, number] = [m[0] + dist, m[1], m[2] - slope * dist];
      push(prev, p, tipGamma[side], core * (1 + 0.15 * Math.min(d, 10)));
      prev = p;
      if (side === 1 && d < 100) path.push(...p);
    }
  }

  const wake: WakeInfo = { yTip, xRoll, descent, gammaTip: tipGamma[1], core, path };
  return { segs, wake, edge, gam };
}

/** Mirror segments in the free surface z = 0 (same strength: zero potential on the surface). */
export function withImages(segs: number[]): number[] {
  const out = segs.slice();
  for (let o = 0; o < segs.length; o += SEG_STRIDE) {
    out.push(
      segs[o],
      segs[o + 1],
      -segs[o + 2],
      segs[o + 3],
      segs[o + 4],
      -segs[o + 5],
      segs[o + 6],
      segs[o + 7],
    );
  }
  return out;
}
