/**
 * What the 3-D view draws over each foil: its measurements (dimension lines)
 * and its lift and drag along the span. Physics frame: x downstream, y span,
 * z up; lengths in m, forces in N.
 */
import { chordRatio } from '../physics/wing/planform';
import type { FlowFoil } from './types';

export type Vec3 = [number, number, number];

export type DimensionKind = 'span' | 'rootChord' | 'tipChord' | 'depth';

export interface Dimension {
  kind: DimensionKind;
  /** ends of the dimension line (arrowheads point outward from here) */
  a: Vec3;
  b: Vec3;
  /** extension lines from the foil to the dimension line */
  ext: [Vec3, Vec3][];
  /** the measured length, m */
  value: number;
}

/** Chord at semi-span fraction eta (0 root, 1 tip), m. */
export function chordAt(f: FlowFoil, eta: number) {
  return f.cr * chordRatio(f.planform, f.lambda, Math.min(1, Math.abs(eta)));
}

/** Point in the chord plane at distance xc behind the quarter chord (along the pitched chord) and span position y. */
export function chordPoint(f: FlowFoil, xc: number, y: number): Vec3 {
  return [f.x0 + xc * Math.cos(f.pitch), y, f.z0 - xc * Math.sin(f.pitch)];
}

const add = (p: Vec3, d: Vec3, s: number): Vec3 => [
  p[0] + s * d[0],
  p[1] + s * d[1],
  p[2] + s * d[2],
];

/**
 * Span ahead of the foil, root chord and tip chord (tapered planforms) below it,
 * and depth of the quarter chord below the undisturbed surface, beside the near tip (y < 0).
 */
export function foilDimensions(f: FlowFoil): Dimension[] {
  const cr = f.cr;
  const half = f.b / 2;
  const ct = chordAt(f, 1);
  const gap = 0.06 * cr;
  const over = 0.08 * cr;
  const out: Dimension[] = [];

  // span: in the chord plane, half a root chord ahead of the root leading edge
  const xs = -0.25 * cr - 0.5 * cr;
  out.push({
    kind: 'span',
    a: chordPoint(f, xs, -half),
    b: chordPoint(f, xs, half),
    ext: [-half, half].map((y) => [
      chordPoint(f, -0.25 * ct - gap, y),
      chordPoint(f, xs - over, y),
    ]) as [Vec3, Vec3][],
    value: f.b,
  });

  // chords: parallel to the chord line, below the foil
  const down: Vec3 = [-Math.sin(f.pitch), 0, -Math.cos(f.pitch)];
  const below = 0.45 * cr;
  const chordDim = (kind: DimensionKind, c: number, y: number): Dimension => {
    const le = chordPoint(f, -0.25 * c, y);
    const te = chordPoint(f, 0.75 * c, y);
    return {
      kind,
      a: add(le, down, below),
      b: add(te, down, below),
      ext: [le, te].map((p) => [add(p, down, gap), add(p, down, below + over)]) as [Vec3, Vec3][],
      value: c,
    };
  };
  out.push(chordDim('rootChord', cr, 0));
  if (f.planform === 'tapered' && Math.abs(ct - cr) > 1e-3 * cr && ct > 0.02 * cr)
    out.push(chordDim('tipChord', ct, -half));

  // depth: vertical, from the quarter chord up to the surface, outboard of the near tip
  const yd = -half - 0.5 * cr;
  out.push({
    kind: 'depth',
    a: [f.x0, yd, f.z0],
    b: [f.x0, yd, 0],
    ext: [
      [
        [f.x0, -half - gap, f.z0],
        [f.x0, yd - over, f.z0],
      ],
    ],
    value: -f.z0,
  });
  return out;
}

export interface AngleMarker {
  /** horizontal line through the pivot (free-stream direction) */
  ref: [Vec3, Vec3];
  /** chord line through the pivot, at the foil's pitch */
  chord: [Vec3, Vec3];
  /** arc from the horizontal to the chord line, ahead of the pivot */
  arc: Vec3[];
  /** where the label goes */
  label: Vec3;
}

/**
 * Angle of the chord to the free stream, drawn as a small side view just
 * outboard of the far tip (y > 0), clear of the force arrows and other dimensions.
 */
export function angleMarker(f: FlowFoil): AngleMarker {
  const c = f.cr;
  const y = f.b / 2 + 0.8 * c;
  const o: Vec3 = [f.x0, y, f.z0];
  const half = 0.9 * c;
  const cP = Math.cos(f.pitch),
    sP = Math.sin(f.pitch);
  const r = 0.7 * c;
  const n = 16;
  const arc = Array.from({ length: n + 1 }, (_, i): Vec3 => {
    const t = (f.pitch * i) / n;
    return [f.x0 - r * Math.cos(t), y, f.z0 + r * Math.sin(t)];
  });
  return {
    ref: [
      [f.x0 - half, y, f.z0],
      [f.x0 + half, y, f.z0],
    ],
    chord: [
      [f.x0 - half * cP, y, f.z0 + half * sP],
      [f.x0 + half * cP, y, f.z0 - half * sP],
    ],
    arc,
    label: add(o, [0, 0, 1], 0.8 * c),
  };
}

export interface SpanLoads {
  /** semi-span fractions, signed (−1 … 1) */
  eta: number[];
  /** lift per unit span, N/m (up) */
  lift: number[];
  /** drag per unit span, N/m (downstream) */
  drag: number[];
}

/** Circulation at eta from the foil's stations (uniform in |eta|). */
function gammaAt(f: FlowFoil, eta: number) {
  const n = f.stGamma.length;
  const s = Math.min(1, Math.abs(eta)) * (n - 1);
  const j = Math.min(n - 2, Math.floor(s));
  const t = s - j;
  return f.stGamma[j] * (1 - t) + f.stGamma[j + 1] * t;
}

/**
 * Lift and drag per unit span at the given signed semi-span fractions.
 * Lift follows the lifting-line circulation (ρVΓ), scaled to integrate to the
 * foil's lift. Drag is split into profile drag along the chord (uniform section
 * drag coefficient) and induced drag along the lift (uniform induced angle),
 * so it integrates to the foil's drag.
 */
export function spanLoads(f: FlowFoil, eta: number[]): SpanLoads {
  const n = f.stGamma.length;
  // ∫Γ dy over the whole span (trapezoid over the stations, both halves)
  let g = 0;
  for (let j = 0; j < n - 1; j++) g += 0.5 * (f.stGamma[j] + f.stGamma[j + 1]) * (f.b / (n - 1));
  const L = f.op.L;
  const D = f.op.D;
  const kL = g > 0 ? L / g : 0;
  const cd = Math.max(f.op.CDp + f.op.CDi, 1e-12);
  const lift = eta.map((e) => kL * gammaAt(f, e));
  const drag = eta.map(
    (e, i) =>
      (D / cd) * ((f.op.CDp * chordAt(f, e)) / f.S + (L !== 0 ? (f.op.CDi * lift[i]) / L : 0)),
  );
  return { eta, lift, drag };
}
