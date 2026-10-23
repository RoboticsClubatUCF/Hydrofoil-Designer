/**
 * Near field of a foil section for the 3-D flow view.
 *
 * Close to the foil the flow is taken from the section's own vortex-panel
 * solution (the same linear-strength vortex panel method used for the section
 * pressures), evaluated at any field point. Far from the section the foil looks
 * like its bound vortex, which the 3-D vortex model already carries, so the
 * near field adds only
 *
 *     panel field − point vortex of the same circulation at the quarter chord,
 *
 * which has no net circulation, falls off like a doublet, and is faded out
 * beyond 2–3 chords. Coordinates here are section coordinates at unit chord with
 * the quarter chord at the origin: ξ along the chord (leading edge → trailing
 * edge), ζ towards the upper surface.
 */
import type { SectionGeometry } from '../physics/profile/geometry';
import { alphaForCl, panelAt, solvePanels, type PanelSolution } from '../physics/profile/panel';

const K = 1 / (2 * Math.PI);
export const PROFILE_SAMPLES = 64;
/** near-field fade: full inside R0 chords, zero beyond R1 */
export const NEAR_R0 = 2;
export const NEAR_R1 = 3;

export interface NearFieldSection {
  /** panel nodes, ξ ζ pairs (quarter chord at origin), Selig order */
  nodes: Float64Array;
  n: number;
  /** node vortex strength for unit free stream along the chord / normal to it */
  g0: Float64Array;
  g90: Float64Array;
  /** circulation (counter-clockwise positive) of g0 and g90, per unit chord and speed */
  gam0: number;
  gam90: number;
  panel: PanelSolution;
  /** upper and lower surface at x = s², s = i/(PROFILE_SAMPLES−1), leading edge at x = 0 */
  profU: Float64Array;
  profL: Float64Array;
  /** section area and centroid at unit chord (centroid ξ relative to the quarter chord) */
  area: number;
  xCentroid: number;
}

/** Build the near-field section from the panel geometry (every second node: 100 panels). */
export function prepareNearField(g: SectionGeometry): NearFieldSection {
  const pts = g.nodes.filter((_, i) => i % 2 === 0 || i === g.nodes.length - 1);
  const panel = solvePanels(pts);
  const n = pts.length;
  const nodes = new Float64Array(2 * n);
  pts.forEach((p, i) => {
    nodes[2 * i] = p.x - 0.25;
    nodes[2 * i + 1] = p.y;
  });
  let gam0 = 0,
    gam90 = 0;
  for (let j = 0; j < n - 1; j++) {
    const ds = panel.s[j + 1] - panel.s[j];
    gam0 += 0.5 * (panel.g0[j] + panel.g0[j + 1]) * ds;
    gam90 += 0.5 * (panel.g90[j] + panel.g90[j + 1]) * ds;
  }
  const profU = new Float64Array(PROFILE_SAMPLES);
  const profL = new Float64Array(PROFILE_SAMPLES);
  for (let i = 0; i < PROFILE_SAMPLES; i++) {
    const x = (i / (PROFILE_SAMPLES - 1)) ** 2;
    profU[i] = g.yUpper(x);
    profL[i] = g.yLower(x);
  }
  return {
    nodes,
    n,
    g0: Float64Array.from(panel.g0),
    g90: Float64Array.from(panel.g90),
    gam0,
    gam90,
    panel,
    profU,
    profL,
    area: g.area,
    xCentroid: g.centroid.x - 0.25,
  };
}

/** Inviscid panel angle (relative to the chord) that gives this section lift coefficient. */
export function panelAlphaForCl(sec: NearFieldSection, cl: number): number {
  return alphaForCl(sec.panel, cl);
}

export function panelCl(sec: NearFieldSection, alpha: number): number {
  return panelAt(sec.panel, alpha).cl;
}

/**
 * Velocity at (ξ, ζ) induced by linear-strength vortex panels with node strengths
 * γ_j = a0·g0_j + a90·g90_j, minus a point vortex of circulation G at the origin.
 * a0, a90 and G are speeds (G is circulation per unit chord). Adds to out[0..1].
 */
export function addBracketVelocity(
  sec: NearFieldSection,
  a0: number,
  a90: number,
  G: number,
  xi: number,
  ze: number,
  out: Float64Array | number[],
): void {
  const { nodes, g0, g90, n } = sec;
  let u = 0,
    w = 0;
  let ax = nodes[0],
    az = nodes[1];
  let ga = a0 * g0[0] + a90 * g90[0];
  for (let j = 0; j < n - 1; j++) {
    const bx = nodes[2 * j + 2],
      bz = nodes[2 * j + 3];
    const gb = a0 * g0[j + 1] + a90 * g90[j + 1];
    const dx = bx - ax,
      dz = bz - az;
    const l = Math.hypot(dx, dz);
    if (l > 1e-12) {
      const tx = dx / l,
        tz = dz / l;
      const rx = xi - ax,
        rz = ze - az;
      const xl = rx * tx + rz * tz;
      const zl = -rx * tz + rz * tx;
      let I0 = Math.atan2(zl, xl - l) - Math.atan2(zl, xl);
      if (I0 > Math.PI) I0 -= 2 * Math.PI;
      if (I0 < -Math.PI) I0 += 2 * Math.PI;
      const I1 =
        0.5 * Math.log((xl * xl + zl * zl + 1e-30) / ((xl - l) * (xl - l) + zl * zl + 1e-30));
      const J0 = xl * I0 - zl * I1;
      const J1 = xl * I1 - l + zl * I0;
      const ul = -K * ((I0 - J0 / l) * ga + (J0 / l) * gb);
      const wl = K * ((I1 - J1 / l) * ga + (J1 / l) * gb);
      u += ul * tx - wl * tz;
      w += ul * tz + wl * tx;
    }
    ax = bx;
    az = bz;
    ga = gb;
  }
  const r2 = Math.max(xi * xi + ze * ze, 1e-12);
  u -= (-G * K * ze) / r2;
  w -= (G * K * xi) / r2;
  out[0] += u;
  out[1] += w;
}

/** Is (ξ, ζ) inside the section? */
export function insideSection(sec: NearFieldSection, xi: number, ze: number): boolean {
  const x = xi + 0.25;
  if (x < 0 || x > 1) return false;
  const s = Math.sqrt(x) * (PROFILE_SAMPLES - 1);
  const k0 = Math.min(PROFILE_SAMPLES - 2, Math.floor(s));
  const t = s - k0;
  const yu = sec.profU[k0] + (sec.profU[k0 + 1] - sec.profU[k0]) * t;
  const yl = sec.profL[k0] + (sec.profL[k0 + 1] - sec.profL[k0]) * t;
  return ze <= yu && ze >= yl;
}

export function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
