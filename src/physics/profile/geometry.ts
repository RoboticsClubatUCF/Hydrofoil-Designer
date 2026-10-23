/**
 * Section geometry: a smooth arc-length spline through the parsed points, cosine
 * resampling for the panel method, and shape/structural properties at unit chord.
 */
import { cubicSpline, goldenMin, interp } from '../numeric';
import type { ParsedProfile, Pt } from './parse';

export interface SectionGeometry {
  name: string;
  /** Dense upper/lower surfaces, LE→TE, monotonic x (for interpolation and plots). */
  upper: Pt[];
  lower: Pt[];
  /** Panel nodes, Selig order (TE upper → LE → TE lower). */
  nodes: Pt[];
  tMax: number; // t/c
  xTMax: number;
  camberMax: number; // signed, fraction of chord
  xCamberMax: number;
  leRadius: number; // fraction of chord
  teGap: number; // fraction of chord
  teAngleDeg: number;
  /** Cross-section properties at unit chord (scale with c², c³, c⁴). */
  area: number; // A₁
  centroid: Pt;
  ixx: number; // second moment about horizontal centroidal axis, I₁
  zMax: number; // largest distance from neutral axis to surface, fraction of chord
  sectionModulus: number; // Z₁ = I₁ / zMax
  camberLine: Pt[];
  thickness: (x: number) => number;
  yUpper: (x: number) => number;
  yLower: (x: number) => number;
}

const spacing = (t: number) => (1 - Math.cos(Math.PI * t)) / 2;
export function buildGeometry(p: ParsedProfile, panels = 160): SectionGeometry {
  const loop: Pt[] = [...p.upper].reverse().concat(p.lower.slice(1));
  const s: number[] = [0];
  for (let i = 1; i < loop.length; i++)
    s.push(s[i - 1] + Math.hypot(loop[i].x - loop[i - 1].x, loop[i].y - loop[i - 1].y));
  const sx = cubicSpline(
    s,
    loop.map((q) => q.x),
  );
  const sy = cubicSpline(
    s,
    loop.map((q) => q.y),
  );
  const iLE = p.upper.length - 1;
  const sLo = s[Math.max(0, iLE - 1)],
    sHi = s[Math.min(s.length - 1, iLE + 1)];
  const sLE = goldenMin((t) => sx.value(t), sLo, sHi, 1e-10).x;
  const sEnd = s[s.length - 1];

  const at = (t: number): Pt => ({ x: sx.value(t), y: sy.value(t) });

  // Panel nodes: cosine spacing on each side (clusters at LE and TE).
  const half = Math.max(20, Math.round(panels / 2));
  const nodes: Pt[] = [];
  for (let i = 0; i <= half; i++) nodes.push(at(sLE * (1 - spacing(1 - i / half))));
  for (let i = 1; i <= half; i++) nodes.push(at(sLE + (sEnd - sLE) * spacing(i / half)));

  // Dense surfaces LE→TE.
  const dense = 300;
  const upper: Pt[] = [];
  const lower: Pt[] = [];
  for (let i = 0; i <= dense; i++) {
    const f = (1 - Math.cos((Math.PI * i) / dense)) / 2;
    upper.push(at(sLE - f * sLE));
    lower.push(at(sLE + f * (sEnd - sLE)));
  }
  const monotone = (pts: Pt[]) => {
    const out: Pt[] = [pts[0]];
    for (const q of pts.slice(1)) if (q.x > out[out.length - 1].x) out.push(q);
    return out;
  };
  const up = monotone(upper),
    lo = monotone(lower);
  const ux = up.map((q) => q.x),
    uy = up.map((q) => q.y);
  const lx = lo.map((q) => q.x),
    ly = lo.map((q) => q.y);
  const yUpper = (x: number) => interp(x, ux, uy);
  const yLower = (x: number) => interp(x, lx, ly);
  const thickness = (x: number) => yUpper(x) - yLower(x);

  let tMax = 0,
    xT = 0,
    cMax = 0,
    xC = 0;
  const camberLine: Pt[] = [];
  const xLE = sx.value(sLE);
  const xTE = Math.max(ux[ux.length - 1], lx[lx.length - 1]);
  for (let i = 0; i <= 400; i++) {
    const x = xLE + ((xTE - xLE) * (1 - Math.cos((Math.PI * i) / 400))) / 2;
    const t = thickness(x);
    const c = (yUpper(x) + yLower(x)) / 2;
    camberLine.push({ x, y: c });
    if (t > tMax) {
      tMax = t;
      xT = x;
    }
    if (Math.abs(c) > Math.abs(cMax)) {
      cMax = c;
      xC = x;
    }
  }

  // Leading-edge radius from spline curvature.
  const dx = sx.d1(sLE),
    dy = sy.d1(sLE),
    ddx = sx.d2(sLE),
    ddy = sy.d2(sLE);
  const kappa = Math.abs(dx * ddy - dy * ddx) / Math.pow(dx * dx + dy * dy, 1.5);
  const leRadius = kappa > 0 ? 1 / kappa : 0;

  const tU = loop[0],
    tL = loop[loop.length - 1];
  const teGap = Math.hypot(tU.x - tL.x, tU.y - tL.y);
  const slope = (f: (x: number) => number) => (f(0.99) - f(0.97)) / 0.02;
  const teAngleDeg = ((Math.atan(-slope(yUpper)) + Math.atan(slope(yLower))) * 180) / Math.PI;

  // Polygon section properties (closed loop: dense upper TE→LE, then lower LE→TE).
  const poly: Pt[] = [...up].reverse().concat(lo.slice(1));
  let A = 0,
    Cx = 0,
    Cy = 0,
    Ix = 0;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i],
      b = poly[(i + 1) % poly.length];
    const cr = a.x * b.y - b.x * a.y;
    A += cr / 2;
    Cx += ((a.x + b.x) * cr) / 6;
    Cy += ((a.y + b.y) * cr) / 6;
    Ix += ((a.y * a.y + a.y * b.y + b.y * b.y) * cr) / 12;
  }
  Cx /= A;
  Cy /= A;
  const ixx = Ix - A * Cy * Cy;
  let zMax = 0;
  for (const q of poly) zMax = Math.max(zMax, Math.abs(q.y - Cy));

  return {
    name: p.name,
    upper: up,
    lower: lo,
    nodes,
    tMax,
    xTMax: xT,
    camberMax: cMax,
    xCamberMax: xC,
    leRadius,
    teGap,
    teAngleDeg,
    area: A,
    centroid: { x: Cx, y: Cy },
    ixx,
    zMax,
    sectionModulus: ixx / zMax,
    camberLine,
    thickness,
    yUpper,
    yLower,
  };
}

/** NACA 4-digit generator (closed trailing edge), used for tests and checks. */
export function naca4(code: string, n = 80): ParsedProfile {
  const m = Number(code[0]) / 100,
    pp = Number(code[1]) / 10,
    t = Number(code.slice(2)) / 100;
  const upper: Pt[] = [],
    lower: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const x = (1 - Math.cos((Math.PI * i) / n)) / 2;
    const yt =
      5 *
      t *
      (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    let yc = 0,
      dyc = 0;
    if (m > 0) {
      if (x < pp) {
        yc = (m / pp ** 2) * (2 * pp * x - x * x);
        dyc = ((2 * m) / pp ** 2) * (pp - x);
      } else {
        yc = (m / (1 - pp) ** 2) * (1 - 2 * pp + 2 * pp * x - x * x);
        dyc = ((2 * m) / (1 - pp) ** 2) * (pp - x);
      }
    }
    const th = Math.atan(dyc);
    upper.push({ x: x - yt * Math.sin(th), y: yc + yt * Math.cos(th) });
    lower.push({ x: x + yt * Math.sin(th), y: yc - yt * Math.cos(th) });
  }
  upper[n] = { x: 1, y: 0 };
  lower[n] = { x: 1, y: 0 };
  return {
    name: `NACA ${code}`,
    format: 'selig',
    upper,
    lower,
    pointCount: 2 * n + 2,
    warnings: [],
  };
}
