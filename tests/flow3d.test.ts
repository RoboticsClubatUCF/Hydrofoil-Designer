import { describe, expect, it } from 'vitest';
import { G } from '../src/physics/fluid';
import { liftingLine } from '../src/physics/wing/liftingLine';
import { MATERIALS } from '../src/physics/structure/materials';
import { solveDesign } from '../src/solver/solve';
import { foilValues } from '../src/solver/variables';
import { DEFAULT_REQUIREMENTS, type DesignInput } from '../src/solver/types';
import { buildFlow, type FlowSection } from '../src/flow3d/build';
import { FFT2 } from '../src/flow3d/fft';
import {
  addBracketVelocity,
  insideSection,
  prepareNearField,
  panelCl,
} from '../src/flow3d/nearField';
import { SurfaceSim, kelvinWavelength, type SurfaceGrid } from '../src/flow3d/surface';
import type { FlowRequest } from '../src/flow3d/types';
import { traceStreamline, velocityAt } from '../src/flow3d/velocity';
import { addSegmentVelocity } from '../src/flow3d/vortex';
import { angleMarker, foilDimensions, spanLoads } from '../src/flow3d/loads';
import { exampleSection, rad } from './helpers';

const model = exampleSection();
const near = prepareNearField(model.geometry);
const section: FlowSection = { model, near };

const design = (values: Record<string, number>): DesignInput => ({
  values,
  planform: 'rectangular',
  salinity: 0,
  material: MATERIALS[0],
  requirements: DEFAULT_REQUIREMENTS,
  objective: 'minDrag',
});

function flowFor(values: Record<string, number>, V: number, h: number, nSpan = 16) {
  const res = solveDesign(design(values), model);
  const req: FlowRequest = {
    V,
    loadFactor: 1,
    nSpan,
    foils: [{ name: 'Main foil', slot: 1, planform: 'rectangular', values: res.values, x0: 0, h }],
  };
  return { res, state: buildFlow(req, () => section) };
}

describe('FFT', () => {
  it('round-trips and matches a single mode', () => {
    const nx = 16,
      ny = 8;
    const f = new FFT2(nx, ny);
    const re = new Float64Array(nx * ny),
      im = new Float64Array(nx * ny);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++)
        re[j * nx + i] = Math.cos((2 * Math.PI * (3 * i)) / nx + (2 * Math.PI * j) / ny);
    const orig = re.slice();
    f.transform(re, im, false);
    // energy only in modes (3, 1) and (−3, −1)
    expect(re[1 * nx + 3]).toBeCloseTo((nx * ny) / 2, 6);
    expect(re[(ny - 1) * nx + (nx - 3)]).toBeCloseTo((nx * ny) / 2, 6);
    f.transform(re, im, true);
    for (let k = 0; k < re.length; k++) expect(re[k]).toBeCloseTo(orig[k], 10);
  });
});

describe('Biot–Savart segments', () => {
  it('a long segment matches the 2-D vortex, in the right direction', () => {
    const seg = [0, -500, 0, 0, 500, 0, 2, 0];
    const out = [0, 0, 0];
    addSegmentVelocity(seg, 1, 0, 0, 0.3, out);
    // vortex along +y, point above: velocity along +x of Γ/(2πd)
    expect(out[0]).toBeCloseTo(2 / (2 * Math.PI * 0.3), 4);
    expect(Math.abs(out[1]) + Math.abs(out[2])).toBeLessThan(1e-9);
  });
});

describe('section near field', () => {
  const a = rad(4);
  const a0 = Math.cos(a),
    a90 = Math.sin(a);
  const Gc = a0 * near.gam0 + a90 * near.gam90;
  // full 2-D flow: free stream + bracket + the point vortex put back
  const vel = (xi: number, ze: number) => {
    const out = [a0, a90];
    addBracketVelocity(near, a0, a90, Gc, xi, ze, out);
    const r2 = xi * xi + ze * ze;
    out[0] += (-Gc * ze) / (2 * Math.PI * r2);
    out[1] += (Gc * xi) / (2 * Math.PI * r2);
    return out;
  };

  it('circulation gives the panel lift (Kutta–Joukowski, clockwise = lift)', () => {
    expect(-2 * Gc).toBeCloseTo(panelCl(near, a), 3);
  });

  it('flow is tangent to the surface and the interior is at rest', () => {
    const g = model.geometry;
    let worst = 0;
    for (const x of [0.05, 0.2, 0.4, 0.6, 0.8, 0.95]) {
      for (const surf of [g.yUpper, g.yLower]) {
        const y = surf(x);
        const slope = (surf(x + 1e-4) - surf(x - 1e-4)) / 2e-4;
        const nrm = [-slope, 1].map((c) => c / Math.hypot(slope, 1));
        const sgn = surf === g.yUpper ? 1 : -1;
        const off = 0.004;
        const v = vel(x - 0.25 + sgn * off * nrm[0], y + sgn * off * nrm[1]);
        const vn = v[0] * nrm[0] + v[1] * nrm[1];
        worst = Math.max(worst, Math.abs(vn) / Math.hypot(v[0], v[1]));
        // inside, a little below the surface
        const vi = vel(
          x - 0.25 - sgn * 0.3 * g.thickness(x) * nrm[0],
          y - sgn * 0.3 * g.thickness(x) * nrm[1],
        );
        expect(Math.hypot(vi[0], vi[1])).toBeLessThan(0.05);
        expect(insideSection(near, x - 0.25, y - sgn * 0.3 * g.thickness(x))).toBe(true);
      }
    }
    expect(worst).toBeLessThan(0.03);
  });

  it('the bracket field decays away from the section', () => {
    const out = [0, 0];
    addBracketVelocity(near, a0, a90, Gc, 2.5, 0.5, out);
    expect(Math.hypot(out[0], out[1])).toBeLessThan(0.01);
  });
});

describe('3-D flow of a designed foil', () => {
  const values = { m: 90, V: 5, b: 0.8, cr: 0.15, h: 0.6 };
  const { res, state } = flowFor(values, 5, 0.6);
  const f = state.foils[0];

  it('operating point at the design speed is the designed one', () => {
    const v = res.values;
    expect(f.op.alpha).toBeCloseTo(v.alpha, 4);
    expect(f.op.CL).toBeCloseTo(v.CL, 5);
    expect(f.op.D / v.D).toBeCloseTo(1, 3);
    expect(f.op.kFS).toBeCloseTo(v.kFS, 6);
    expect(f.op.cavMargin).toBeCloseTo(v.cavMargin, 3);
    expect(f.op.stalled).toBe(false);
  });

  it('bound circulation carries the design lift (ρ V ∫Γ dy = L)', () => {
    let lift = 0;
    for (let i = 0; i < 16; i++) {
      const o = i * 8;
      lift += state.rho * state.V * state.segs[o + 6] * (state.segs[o + 4] - state.segs[o + 1]);
    }
    expect(lift / res.values.L).toBeCloseTo(1, 2);
  });

  it('water does not flow through the 3-D foil at mid-span', () => {
    const g = model.geometry;
    const cp = Math.cos(f.pitch),
      sp = Math.sin(f.pitch);
    const v = [0, 0, 0];
    let worst = 0;
    for (const x of [0.1, 0.3, 0.5, 0.7, 0.9]) {
      for (const surf of [g.yUpper, g.yLower]) {
        const sgn = surf === g.yUpper ? 1 : -1;
        const slope = (surf(x + 1e-4) - surf(x - 1e-4)) / 2e-4;
        const n = [-slope, 1].map((c) => (sgn * c) / Math.hypot(slope, 1));
        const xi = x - 0.25 + 0.004 * n[0],
          ze = surf(x) + 0.004 * n[1];
        // section frame → water frame
        const X = f.x0 + f.cr * (xi * cp + ze * sp),
          Z = f.z0 + f.cr * (-xi * sp + ze * cp);
        const inside = velocityAt(state, X, 0.05, Z, v);
        expect(inside).toBe(false);
        const nx = n[0] * cp + n[1] * sp,
          nz = -n[0] * sp + n[1] * cp;
        worst = Math.max(worst, Math.abs(v[0] * nx + v[2] * nz) / state.V);
      }
    }
    // the residual comes from the viscous lift slope used for the design circulation
    expect(worst).toBeLessThan(0.04);
    expect(velocityAt(state, f.x0 + 0.1 * f.cr, 0.1, f.z0 + 0.01 * f.cr, v)).toBe(true);
  });

  it('downwash in deep water matches the lifting line', () => {
    const deep = flowFor(values, 5, 50, 24).state;
    const fd = deep.foils[0];
    const r = liftingLine('rectangular', fd.AR, 1, fd.op.a0);
    for (const eta of [0, 0.5]) {
      const v = [5, 0, 0];
      addSegmentVelocity(deep.segs, deep.nSeg, fd.x0, (eta * fd.b) / 2, fd.z0, v);
      const ai = -Math.atan2(v[2], v[0]);
      const clLocal = (r.clRatio[Math.round(eta * 100)] ?? 1) * fd.op.CL;
      const aiLL = fd.op.alpha - fd.op.alphaL0 - clLocal / fd.op.a0;
      expect(Math.abs(ai - aiLL) / aiLL).toBeLessThan(0.12);
    }
  });

  it('a streamline below the foil passes it without entering', () => {
    const s = traceStreamline(state, [-0.5, 0.1, f.z0 - 0.03], 1.0);
    const n = s.pts.length / 3;
    expect(s.pts[3 * (n - 1)]).toBeGreaterThan(0.9);
    // it is deflected downward behind the foil (downwash)
    expect(s.pts[3 * (n - 1) + 2]).toBeLessThan(f.z0 - 0.03);
  });

  it('dimension lines measure the span, root chord and depth', () => {
    const dims = foilDimensions(f);
    const len = (k: string) => {
      const d = dims.find((x) => x.kind === k)!;
      return Math.hypot(d.a[0] - d.b[0], d.a[1] - d.b[1], d.a[2] - d.b[2]);
    };
    expect(len('span')).toBeCloseTo(f.b, 9);
    expect(len('rootChord')).toBeCloseTo(f.cr, 9);
    expect(len('depth')).toBeCloseTo(0.6, 9);
    // a rectangular foil has no separate tip chord
    expect(dims.some((d) => d.kind === 'tipChord')).toBe(false);
    // the span line is ahead of the leading edge, the chord line below the foil
    const span = dims.find((d) => d.kind === 'span')!;
    const root = dims.find((d) => d.kind === 'rootChord')!;
    expect(span.a[0]).toBeLessThan(f.x0 - 0.25 * f.cr);
    expect(root.a[2]).toBeLessThan(f.z0 - 0.3 * f.cr);
  });

  it('the angle marker shows the chord at the foil pitch to the horizontal', () => {
    const m = angleMarker(f);
    const [a, b] = m.chord;
    expect(Math.atan2(a[2] - b[2], b[0] - a[0])).toBeCloseTo(f.pitch, 9);
    expect(m.ref[0][2]).toBe(m.ref[1][2]);
    // beside the far tip, clear of the foil
    expect(m.label[1]).toBeGreaterThan(f.b / 2);
  });

  it('lift and drag along the span add up to the foil lift and drag', () => {
    const n = 400;
    const eta = Array.from({ length: n + 1 }, (_, i) => -1 + (2 * i) / n);
    const s = spanLoads(f, eta);
    const sum = (q: number[]) =>
      q.reduce((acc, x, i) => (i ? acc + 0.5 * (x + q[i - 1]) * (f.b / n) : 0), 0);
    expect(sum(s.lift) / f.op.L).toBeCloseTo(1, 2);
    expect(sum(s.drag) / f.op.D).toBeCloseTo(1, 2);
    // most lift at the root, little at the tips
    expect(s.lift[n / 2]).toBeGreaterThan(3 * s.lift[1]);
  });

  it('below take-off speed the foil is stalled and carries less than the weight', () => {
    const slow = flowFor(values, 0.5 * res.values.Vto, 0.6).state.foils[0];
    expect(slow.op.stalled).toBe(true);
    expect(slow.op.L).toBeLessThan(slow.op.Lreq);
  });
});

describe('free-surface waves', () => {
  it('2-D foil: downstream waves of wavelength 2πU²/g and amplitude 2Γ/U·e^(−k₀h)', () => {
    const U = 4,
      h = 0.5,
      gam = 0.2;
    const lam = kelvinWavelength(U);
    const nx = 1024,
      ny = 4;
    const Lx = 16 * lam;
    const grid: SurfaceGrid = { nx, ny, Lx, Ly: (Lx * ny) / nx, xUp: 0.2 * Lx, sides: false };
    const sim = new SurfaceSim(grid);
    const ys = [0, grid.Ly / 4, grid.Ly / 2];
    sim.setParams(
      {
        U,
        foils: [
          {
            x0: 0,
            h,
            y: ys,
            gamma: ys.map(() => gam),
            area: ys.map(() => 0),
            xArea: ys.map(() => 0),
          },
        ],
        strut: null,
        depth: Infinity,
      },
      0.02,
    );
    sim.initSteady(40);
    let max = 0;
    const zeros: number[] = [];
    for (let i = 1; i < nx; i++) {
      const x = sim.xOf(i),
        xp = sim.xOf(i - 1);
      if (x < 2 * lam || x > 5 * lam || xp > x) continue;
      max = Math.max(max, Math.abs(sim.eta[i]));
      if (sim.eta[i - 1] < 0 && sim.eta[i] >= 0)
        zeros.push(xp + ((x - xp) * -sim.eta[i - 1]) / (sim.eta[i] - sim.eta[i - 1]));
    }
    const k0 = G / (U * U);
    const amp = ((2 * gam) / U) * Math.exp(-k0 * h);
    expect(Math.abs(max - amp) / amp).toBeLessThan(0.1);
    expect(zeros.length).toBeGreaterThanOrEqual(2);
    const measured = (zeros[zeros.length - 1] - zeros[0]) / (zeros.length - 1);
    expect(Math.abs(measured - lam) / lam).toBeLessThan(0.02);
  });
});

describe('3-D flow with a secondary foil', () => {
  const res = solveDesign(
    {
      ...design({ m: 90, V: 5, b: 0.8, cr: 0.15, b2: 0.4, cr2: 0.08, share: 0.8, h: 0.6 }),
      foil2: { planform: 'rectangular', sameSection: true },
    },
    model,
  );
  const v1 = foilValues(res.values, 1);
  const v2 = foilValues(res.values, 2);
  const state = buildFlow(
    {
      V: 5,
      loadFactor: 1,
      nSpan: 16,
      foils: [
        { name: 'Main foil', slot: 1, planform: 'rectangular', values: v1, x0: 0, h: 0.6 },
        { name: 'Secondary foil', slot: 1, planform: 'rectangular', values: v2, x0: 0.7, h: 0.6 },
      ],
    },
    () => section,
  );
  const [main, rear] = state.foils;

  it('each foil keeps its designed operating point', () => {
    expect(main.op.alpha).toBeCloseTo(res.values.alpha, 4);
    expect(rear.op.alpha).toBeCloseTo(res.values.alpha2, 4);
    expect(rear.op.L / res.values.L2).toBeCloseTo(1, 4);
  });

  it('the rear foil sits in the main foil’s downwash and is trimmed nose-up to meet its design angle', () => {
    expect(rear.op.otherAngle).toBeLessThan(0);
    expect(rear.pitch).toBeGreaterThan(rear.op.alpha);
    // the main foil only feels a little upwash from the smaller foil behind it
    expect(Math.abs(main.op.otherAngle)).toBeLessThan(Math.abs(rear.op.otherAngle));
  });

  it('water does not flow through the rear foil', () => {
    const g = model.geometry;
    const cp = Math.cos(rear.pitch),
      sp = Math.sin(rear.pitch);
    const vel = [0, 0, 0];
    let worst = 0;
    for (const x of [0.2, 0.5, 0.8]) {
      for (const surf of [g.yUpper, g.yLower]) {
        const sgn = surf === g.yUpper ? 1 : -1;
        const slope = (surf(x + 1e-4) - surf(x - 1e-4)) / 2e-4;
        const n = [-slope, 1].map((c) => (sgn * c) / Math.hypot(slope, 1));
        const xi = x - 0.25 + 0.004 * n[0],
          ze = surf(x) + 0.004 * n[1];
        const X = rear.x0 + rear.cr * (xi * cp + ze * sp),
          Z = rear.z0 + rear.cr * (-xi * sp + ze * cp);
        velocityAt(state, X, 0.03, Z, vel);
        const nx = n[0] * cp + n[1] * sp,
          nz = -n[0] * sp + n[1] * cp;
        worst = Math.max(worst, Math.abs(vel[0] * nx + vel[2] * nz) / state.V);
      }
    }
    expect(worst).toBeLessThan(0.05);
  });
});
