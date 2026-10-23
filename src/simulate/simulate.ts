/**
 * "Fly" the proposed foil: spanwise loading and structure at cruise, section
 * pressures, and a speed sweep at constant load. With a secondary foil each
 * foil is flown on the same speed range and the craft totals are added up.
 */
import { G } from '../physics/fluid';
import type { SectionModel } from '../physics/profile/sectionModel';
import { cantileverBending } from '../physics/structure/beam';
import { chordRatio, planformOutline, type PlanformType } from '../physics/wing/planform';
import { effLambda, ll, stripProfileDrag } from '../solver/relations';
import { foilValues } from '../solver/variables';
import type { Ctx, DesignInput, SolveResult } from '../solver/types';

export interface SpanResult {
  /** spanwise position from root, m */
  y: number[];
  chord: number[];
  clLocal: number[];
  liftPerSpan: number[]; // N/m
  moment: number[]; // N·m
  stress: number[]; // Pa
  deflection: number[]; // m
  clmax: number;
}

export interface SweepResult {
  V: number[];
  alpha: number[]; // rad
  CL: number[];
  D: number[];
  P: number[];
  LD: number[];
  cavMargin: number[] | null;
  stalled: boolean[];
  alphaStall: number;
  markers: { V?: number; Vto?: number; Vcav?: number };
}

/** Both foils together, on the same speeds as their own sweeps. */
export interface TotalSweep {
  V: number[];
  D: number[];
  P: number[];
  LD: number[];
  /** either foil stalled */
  stalled: boolean[];
  markers: { V?: number; Vto?: number; Vcav?: number };
}

export interface SectionPlots {
  cp: { x: number[]; cp: number[]; upper: boolean[] } | null;
  cl: number | null;
  liftCurve: { alphaDeg: number[]; cl: number[] };
  dragPolar: { cl: number[]; cd: number[] };
  op: { alphaDeg: number; cl: number; cd: number } | null;
  Re: number;
}

export interface FoilSimulation {
  span: SpanResult | null;
  section: SectionPlots | null;
  sweep: SweepResult | null;
  outline: { y: number; xLE: number; xTE: number }[] | null;
}

export interface Simulation extends FoilSimulation {
  /** the secondary foil, when there is one */
  second: FoilSimulation | null;
  total: TotalSweep | null;
}

const ok = (v: Record<string, number>, ...ids: string[]) => ids.every((k) => Number.isFinite(v[k]));

const finite = (...xs: (number | undefined)[]) =>
  xs.filter((x): x is number => x !== undefined && Number.isFinite(x));

export function simulate(
  input: DesignInput,
  section: SectionModel | null,
  res: SolveResult,
  section2: SectionModel | null = null,
): Simulation {
  const v = res.values;
  const two = input.foil2 ?? null;
  // one speed range for every foil, so the craft totals line up
  const vtoAll = finite(v.Vto, two ? v.Vto2 : undefined);
  const vcavAll = finite(v.Vcav, two ? v.Vcav2 : undefined);
  const vto = vtoAll.length ? Math.max(...vtoAll) : undefined;
  const vcav = vcavAll.length ? Math.min(...vcavAll) : undefined;
  const vRef = ok(v, 'V') ? v.V : vto !== undefined ? 1.6 * vto : 5;
  const lo = Math.max(0.3, 0.8 * (vto ?? 0.5 * vRef));
  let hi = Math.max(2 * vRef, 1.3 * (vto ?? 0.5 * vRef));
  if (vcav !== undefined && vcav < 4 * vRef) hi = Math.max(hi, 1.1 * vcav);
  const range: [number, number] = [lo, hi];

  const main = simulateFoil(input, input.planform, section, v, range);
  if (!two) return { ...main, second: null, total: null };
  const sec2 = two.sameSection ? section : section2;
  const second = simulateFoil(input, two.planform, sec2, foilValues(v, 2), range);
  let total: TotalSweep | null = null;
  if (main.sweep && second.sweep) {
    const a = main.sweep;
    const b = second.sweep;
    const D = a.D.map((d, i) => d + b.D[i]);
    total = {
      V: a.V,
      D,
      P: D.map((d, i) => d * a.V[i]),
      LD: D.map((d) => (v.L + v.L2) / d),
      stalled: a.stalled.map((s, i) => s || b.stalled[i]),
      markers: {
        V: v.V,
        Vto: vto,
        Vcav: vcav,
      },
    };
  }
  return { ...main, second, total };
}

function simulateFoil(
  input: DesignInput,
  planform: PlanformType,
  section: SectionModel | null,
  v: Record<string, number>,
  [lo, hi]: [number, number],
): FoilSimulation {
  const out: FoilSimulation = { span: null, section: null, sweep: null, outline: null };
  if (!section) return out;
  const Re = ok(v, 'Re') ? v.Re : 5e5;
  const ctx: Ctx = {
    planform,
    section,
    sec: section.at(Re),
    reEstimate: Re,
    salinity: input.salinity,
    material: input.material,
  };
  const lambda = effLambda(planform, v.lambda ?? 1);

  // ---- section plots
  const s = section.at(Re);
  const clOp = ok(v, 'clPeak') ? v.clPeak : ok(v, 'CL') ? v.CL : null;
  out.section = {
    cp: clOp !== null ? section.cpDistribution(clOp) : section.cpDistribution(0.5),
    cl: clOp,
    liftCurve: section.liftCurve(Re),
    dragPolar: section.dragPolar(Re),
    op:
      clOp !== null
        ? {
            alphaDeg: ((s.alphaL0 + clOp / s.a0) * 180) / Math.PI,
            cl: clOp,
            cd: section.cd(clOp, Re),
          }
        : null,
    Re,
  };

  // ---- planform outline
  if (ok(v, 'b', 'cr')) out.outline = planformOutline(planform, lambda, v.b, v.cr);

  // ---- span loading & structure
  if (ok(v, 'AR', 'b', 'cr', 'L', 'CL')) {
    const r = ll(ctx, v.AR, lambda);
    const half = v.b / 2;
    const y = r.eta.map((e) => e * half);
    const chord = r.eta.map((e) => v.cr * chordRatio(planform, lambda, e));
    const clLocal = r.clRatio.map((c) => c * v.CL);
    const liftPerSpan = r.loadShape.map((w) => (v.L / 2) * (w / half));
    let moment = y.map(() => NaN),
      stress = y.map(() => NaN),
      deflection = y.map(() => NaN);
    if (ok(v, 'I1', 'Z1')) {
      const beam = cantileverBending(
        v.L,
        v.b,
        v.cr,
        planform,
        lambda,
        r.eta,
        r.loadShape,
        v.I1,
        v.Z1,
        ok(v, 'E') ? v.E : 1,
      );
      moment = beam.moment;
      stress = beam.stress;
      deflection = ok(v, 'E') ? beam.deflection : y.map(() => NaN);
    }
    out.span = { y, chord, clLocal, liftPerSpan, moment, stress, deflection, clmax: s.clmax };
  }

  // ---- speed sweep at constant load
  if (ok(v, 'L', 'S', 'AR', 'rho', 'nu', 'mac', 'kFS')) {
    const n = 80;
    const sw: SweepResult = {
      V: [],
      alpha: [],
      CL: [],
      D: [],
      P: [],
      LD: [],
      cavMargin: ok(v, 'h', 'patm', 'pv', 'kPeak') ? [] : null,
      stalled: [],
      alphaStall: v.alphaStall ?? NaN,
      markers: { V: v.V, Vto: v.Vto, Vcav: Number.isFinite(v.Vcav) ? v.Vcav : undefined },
    };
    for (let i = 0; i <= n; i++) {
      const V = lo + ((hi - lo) * i) / n;
      const q = 0.5 * v.rho * V * V;
      const CL = v.L / (q * v.S);
      const ReV = (V * v.mac) / v.nu;
      ctx.sec = section.at(ReV);
      const r = ll(ctx, v.AR, lambda);
      const alpha = ctx.sec.alphaL0 + CL / (v.kFS * r.CLalpha);
      const CDp = stripProfileDrag(ctx, CL, ReV, v.AR, lambda);
      const CDi = (CL * CL) / (Math.PI * r.e * v.AR);
      const D = q * v.S * (CDp + CDi);
      const CLmax = ctx.sec.clmax / r.clPeakRatio;
      sw.V.push(V);
      sw.CL.push(CL);
      sw.alpha.push(alpha);
      sw.D.push(D);
      sw.P.push(D * V);
      sw.LD.push(v.L / D);
      sw.stalled.push(CL > CLmax);
      if (sw.cavMargin) {
        const sigma = (v.patm + v.rho * G * v.h - v.pv) / q;
        sw.cavMargin.push(sigma + section.cpMin(r.clPeakRatio * CL));
      }
    }
    out.sweep = sw;
  }
  return out;
}
