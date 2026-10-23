/**
 * Every equation linking the design variables. Each relation can be evaluated as a
 * residual (used for numerical and simultaneous solves and for conflict checks)
 * and lists which of its variables it may be solved for, with the rearranged
 * formula used to explain the result.
 *
 * Templates use [varId] placeholders (and [varId^2], [varId^3]) that render either
 * as the symbol or as the substituted value.
 */
import { G } from '../physics/fluid';
import { waterDensity, waterKinematicViscosity, waterVapourPressure } from '../physics/fluid';
import { freeSurfaceFactor } from '../physics/hydro/freeSurface';
import { cavitationInceptionSpeed } from '../physics/hydro/cavitation';
import { cantileverBending } from '../physics/structure/beam';
import { liftingLine, type LiftingLineResult } from '../physics/wing/liftingLine';
import {
  chordRatio,
  chordSquaredRatio,
  macRatio,
  meanChordRatio,
  type PlanformType,
} from '../physics/wing/planform';
import type { Ctx, Relation, Vals } from './types';

const rel = (a: number, b: number) => (a - b) / Math.max(Math.abs(a), Math.abs(b), 1e-300);
const relAbs = (a: number, b: number, scale: number) =>
  (a - b) / Math.max(Math.abs(a), Math.abs(b), scale);

export function effLambda(planform: PlanformType, lambda: number): number {
  return planform === 'rectangular' ? 1 : planform === 'elliptical' ? 0 : lambda;
}

export function ll(ctx: Ctx, AR: number, lambda: number): LiftingLineResult {
  return liftingLine(ctx.planform, AR, effLambda(ctx.planform, lambda), ctx.sec.a0);
}

const stressShapeCache = new Map<string, number>();
/** Peak bending stress ÷ root bending stress for this planform and load shape. */
export function stressShape(ctx: Ctx, AR: number, lambda: number): number {
  const lam = effLambda(ctx.planform, lambda);
  const key = `${ctx.planform}|${AR.toPrecision(5)}|${lam.toPrecision(5)}|${ctx.sec.a0.toPrecision(5)}`;
  const hit = stressShapeCache.get(key);
  if (hit !== undefined) return hit;
  const r = ll(ctx, AR, lambda);
  const beam = cantileverBending(1, 1, 1, ctx.planform, lam, r.eta, r.loadShape, 1, 1, 1);
  const k = beam.stress[0] > 0 ? beam.maxStress / beam.stress[0] : 1;
  if (stressShapeCache.size > 5000) stressShapeCache.clear();
  stressShapeCache.set(key, k);
  return k;
}

/** Profile drag coefficient by strip integration of section cd across the span. */
export function stripProfileDrag(
  ctx: Ctx,
  CL: number,
  Re: number,
  AR: number,
  lambda: number,
): number {
  const r = ll(ctx, AR, lambda);
  const lam = effLambda(ctx.planform, lambda);
  const mR = meanChordRatio(ctx.planform, lam);
  const macR = macRatio(ctx.planform, lam);
  let s = 0;
  let prev = 0;
  for (let j = 0; j < r.eta.length; j++) {
    const cR = chordRatio(ctx.planform, lam, r.eta[j]);
    const clLoc = r.clRatio[j] * CL;
    const reLoc = Math.max(1e4, (Re * cR) / macR);
    const f = cR > 1e-9 ? ctx.section.cd(clLoc, reLoc) * (cR / mR) : 0;
    if (j > 0) s += 0.5 * (f + prev) * (r.eta[j] - r.eta[j - 1]);
    prev = f;
  }
  return s;
}

export function tipDeflection(
  ctx: Ctx,
  L: number,
  b: number,
  cr: number,
  lambda: number,
  E: number,
  AR: number,
  I1: number,
): number {
  const r = ll(ctx, AR, lambda);
  const lam = effLambda(ctx.planform, lambda);
  return cantileverBending(L, b, cr, ctx.planform, lam, r.eta, r.loadShape, I1, 1, E).tipDeflection;
}

export function buildRelations(planform: PlanformType, salinity: number): Relation[] {
  const salTxt = `S_{w}=${salinity}\\,\\text{g/kg}`;
  const R: Relation[] = [
    // ---------------- water ----------------
    {
      id: 'rhoT',
      title: 'Water density',
      vars: ['rho', 'T'],
      equation: `[rho] = \\rho_{water}([T],\\ ${salTxt})`,
      residual: (v) => rel(v.rho, waterDensity(v.T, salinity)),
      solveFor: {
        rho: { rhs: `\\rho_{water}([T],\\ ${salTxt})`, calc: (v) => waterDensity(v.T, salinity) },
      },
      explain: 'Pure water: Kell (1975). Salinity correction: Sharqawy, Lienhard & Zubair (2010).',
    },
    {
      id: 'nuT',
      title: 'Kinematic viscosity',
      vars: ['nu', 'T'],
      equation: `[nu] = \\mu([T],\\ ${salTxt}) \\,/\\, \\rho`,
      residual: (v) => rel(v.nu, waterKinematicViscosity(v.T, salinity)),
      solveFor: {
        nu: {
          rhs: `\\mu([T],\\ ${salTxt}) \\,/\\, \\rho`,
          calc: (v) => waterKinematicViscosity(v.T, salinity),
        },
      },
      explain: 'Dynamic viscosity correlation of Sharqawy et al. (2010), divided by density.',
    },
    {
      id: 'pvT',
      title: 'Vapour pressure',
      vars: ['pv', 'T'],
      equation: `[pv] = p_{sat}([T],\\ ${salTxt})`,
      residual: (v) => rel(v.pv, waterVapourPressure(v.T, salinity)),
      solveFor: {
        pv: { rhs: `p_{sat}([T],\\ ${salTxt})`, calc: (v) => waterVapourPressure(v.T, salinity) },
      },
      explain:
        'Buck (1996) equation over liquid water, with the Sharqawy (2010) salinity correction.',
    },
    // ---------------- load & speed ----------------
    {
      id: 'weight',
      title: 'Lift from weight',
      vars: ['L', 'share', 'm'],
      equation: '[L] = [share]\\cdot[m]\\cdot[g]',
      residual: (v) => rel(v.L, v.share * v.m * G),
      solveFor: {
        L: { rhs: '[share]\\cdot[m]\\cdot[g]', calc: (v) => v.share * v.m * G },
        m: { rhs: '\\dfrac{[L]}{[share]\\cdot[g]}', calc: (v) => v.L / (v.share * G) },
        share: { rhs: '\\dfrac{[L]}{[m]\\cdot[g]}', calc: (v) => v.L / (v.m * G) },
      },
      explain: 'In steady foiling the foil supports its share of the weight.',
    },
    {
      id: 'dynp',
      title: 'Dynamic pressure',
      vars: ['q', 'rho', 'V'],
      equation: '[q] = \\tfrac{1}{2}\\cdot[rho]\\cdot[V^2]',
      residual: (v) => rel(v.q, 0.5 * v.rho * v.V * v.V),
      solveFor: {
        q: { rhs: '\\tfrac{1}{2}\\cdot[rho]\\cdot[V^2]', calc: (v) => 0.5 * v.rho * v.V * v.V },
        V: { rhs: '\\sqrt{\\dfrac{2\\cdot[q]}{[rho]}}', calc: (v) => Math.sqrt((2 * v.q) / v.rho) },
        rho: { rhs: '\\dfrac{2\\cdot[q]}{[V^2]}', calc: (v) => (2 * v.q) / (v.V * v.V) },
      },
    },
    {
      id: 'lift',
      title: 'Lift equation',
      vars: ['L', 'q', 'S', 'CL'],
      equation: '[L] = [q]\\cdot[S]\\cdot[CL]',
      residual: (v) => rel(v.L, v.q * v.S * v.CL),
      solveFor: {
        L: { rhs: '[q]\\cdot[S]\\cdot[CL]', calc: (v) => v.q * v.S * v.CL },
        q: { rhs: '\\dfrac{[L]}{[S]\\cdot[CL]}', calc: (v) => v.L / (v.S * v.CL) },
        S: { rhs: '\\dfrac{[L]}{[q]\\cdot[CL]}', calc: (v) => v.L / (v.q * v.CL) },
        CL: { rhs: '\\dfrac{[L]}{[q]\\cdot[S]}', calc: (v) => v.L / (v.q * v.S) },
      },
    },
    {
      id: 'takeoff',
      title: 'Take-off speed (lift at maximum CL)',
      vars: ['L', 'rho', 'Vto', 'S', 'CLmax'],
      equation: '[L] = \\tfrac{1}{2}\\cdot[rho]\\cdot[Vto^2]\\cdot[S]\\cdot[CLmax]',
      residual: (v) => rel(v.L, 0.5 * v.rho * v.Vto * v.Vto * v.S * v.CLmax),
      solveFor: {
        Vto: {
          rhs: '\\sqrt{\\dfrac{2\\cdot[L]}{[rho]\\cdot[S]\\cdot[CLmax]}}',
          calc: (v) => Math.sqrt((2 * v.L) / (v.rho * v.S * v.CLmax)),
        },
        S: {
          rhs: '\\dfrac{2\\cdot[L]}{[rho]\\cdot[Vto^2]\\cdot[CLmax]}',
          calc: (v) => (2 * v.L) / (v.rho * v.Vto * v.Vto * v.CLmax),
        },
        L: {
          rhs: '\\tfrac{1}{2}\\cdot[rho]\\cdot[Vto^2]\\cdot[S]\\cdot[CLmax]',
          calc: (v) => 0.5 * v.rho * v.Vto * v.Vto * v.S * v.CLmax,
        },
        CLmax: {
          rhs: '\\dfrac{2\\cdot[L]}{[rho]\\cdot[Vto^2]\\cdot[S]}',
          calc: (v) => (2 * v.L) / (v.rho * v.Vto * v.Vto * v.S),
        },
      },
      explain: 'At take-off the foil carries the full load at its maximum lift coefficient.',
    },
    // ---------------- planform ----------------
    {
      id: 'area',
      title: 'Planform area',
      vars: ['S', 'b', 'cbar'],
      equation: '[S] = [b]\\cdot[cbar]',
      residual: (v) => rel(v.S, v.b * v.cbar),
      solveFor: {
        S: { rhs: '[b]\\cdot[cbar]', calc: (v) => v.b * v.cbar },
        b: { rhs: '\\dfrac{[S]}{[cbar]}', calc: (v) => v.S / v.cbar },
        cbar: { rhs: '\\dfrac{[S]}{[b]}', calc: (v) => v.S / v.b },
      },
    },
    {
      id: 'aspect',
      title: 'Aspect ratio',
      vars: ['AR', 'b', 'S'],
      equation: '[AR] = \\dfrac{[b^2]}{[S]}',
      residual: (v) => rel(v.AR, (v.b * v.b) / v.S),
      solveFor: {
        AR: { rhs: '\\dfrac{[b^2]}{[S]}', calc: (v) => (v.b * v.b) / v.S },
        b: { rhs: '\\sqrt{[AR]\\cdot[S]}', calc: (v) => Math.sqrt(v.AR * v.S) },
        S: { rhs: '\\dfrac{[b^2]}{[AR]}', calc: (v) => (v.b * v.b) / v.AR },
      },
    },
    {
      id: 'reynolds',
      title: 'Reynolds number',
      vars: ['Re', 'V', 'mac', 'nu'],
      equation: '[Re] = \\dfrac{[V]\\cdot[mac]}{[nu]}',
      residual: (v) => rel(v.Re, (v.V * v.mac) / v.nu),
      solveFor: {
        Re: { rhs: '\\dfrac{[V]\\cdot[mac]}{[nu]}', calc: (v) => (v.V * v.mac) / v.nu },
        mac: { rhs: '\\dfrac{[Re]\\cdot[nu]}{[V]}', calc: (v) => (v.Re * v.nu) / v.V },
        V: { rhs: '\\dfrac{[Re]\\cdot[nu]}{[mac]}', calc: (v) => (v.Re * v.nu) / v.mac },
      },
    },
    {
      id: 'tRoot',
      title: 'Root thickness',
      vars: ['tRoot', 'tc', 'cr'],
      equation: '[tRoot] = [tc]\\cdot[cr]',
      residual: (v) => rel(v.tRoot, v.tc * v.cr),
      solveFor: {
        tRoot: { rhs: '[tc]\\cdot[cr]', calc: (v) => v.tc * v.cr },
        cr: { rhs: '\\dfrac{[tRoot]}{[tc]}', calc: (v) => v.tRoot / v.tc },
      },
    },
    // ---------------- finite foil (lifting line) ----------------
    {
      id: 'llSlope',
      title: 'Foil lift slope (lifting line)',
      vars: ['CLa', 'AR', 'lambda', 'a0'],
      equation: '[CLa] = \\pi\\cdot[AR]\\cdot A_1([AR],\\,[lambda],\\,[a0])',
      residual: (v, c) => rel(v.CLa, ll(c, v.AR, v.lambda).CLalpha),
      solveFor: {
        CLa: {
          rhs: '\\pi\\cdot[AR]\\cdot A_1([AR],\\,[lambda],\\,[a0])',
          calc: (v, c) => ll(c, v.AR, v.lambda).CLalpha,
        },
        AR: { rhs: 'f^{-1}_{LL}([CLa])' },
      },
      explain:
        'Prandtl lifting-line theory solved with a 24-term Glauert series; A₁ is the first Fourier coefficient of the spanwise circulation. For an elliptical foil this equals a₀ / (1 + a₀/(π·AR)).',
    },
    {
      id: 'llE',
      title: 'Span efficiency (lifting line)',
      vars: ['e', 'AR', 'lambda', 'a0'],
      equation:
        '[e] = \\dfrac{1}{1+\\delta([AR],\\,[lambda],\\,[a0])},\\quad \\delta=\\sum_{n\\ge3} n\\,(A_n/A_1)^2',
      residual: (v, c) => rel(v.e, ll(c, v.AR, v.lambda).e),
      solveFor: {
        e: {
          rhs: '\\dfrac{1}{1+\\delta([AR],\\,[lambda],\\,[a0])}',
          calc: (v, c) => ll(c, v.AR, v.lambda).e,
        },
        AR: { rhs: 'f^{-1}_{LL}([e])' },
      },
      explain: 'From the same lifting-line solution; δ measures departure from elliptical loading.',
    },
    {
      id: 'llPeak',
      title: 'Peak local lift ratio (lifting line)',
      vars: ['kPeak', 'AR', 'lambda', 'a0'],
      equation: '[kPeak] = \\max_y \\dfrac{c_l(y)}{C_L}',
      residual: (v, c) => rel(v.kPeak, ll(c, v.AR, v.lambda).clPeakRatio),
      solveFor: {
        kPeak: {
          rhs: '\\max_y \\dfrac{c_l(y)}{C_L}\\Big|_{[AR],\\,[lambda]}',
          calc: (v, c) => ll(c, v.AR, v.lambda).clPeakRatio,
        },
        AR: { rhs: 'f^{-1}_{LL}([kPeak])' },
      },
      explain:
        'Local section lift along the span from the lifting-line circulation, c_l(y) = 2Γ(y)/(V·c(y)).',
    },
    {
      id: 'llCentroid',
      title: 'Load centroid (lifting line)',
      vars: ['etaBar', 'AR', 'lambda', 'a0'],
      equation:
        '[etaBar] = \\dfrac{\\int_0^1 \\Gamma\\,\\eta\\,d\\eta}{\\int_0^1 \\Gamma\\,d\\eta}',
      residual: (v, c) => rel(v.etaBar, ll(c, v.AR, v.lambda).loadCentroid),
      solveFor: {
        etaBar: {
          rhs: '\\dfrac{\\int_0^1 \\Gamma\\,\\eta\\,d\\eta}{\\int_0^1 \\Gamma\\,d\\eta}\\Big|_{[AR],\\,[lambda]}',
          calc: (v, c) => ll(c, v.AR, v.lambda).loadCentroid,
        },
        AR: { rhs: 'f^{-1}_{LL}([etaBar])' },
      },
      explain:
        'Where each half-span’s lift acts, as a fraction of the semi-span (elliptical loading gives 4/(3π) ≈ 0.424).',
    },
    {
      id: 'kSigma',
      title: 'Stress location factor',
      vars: ['kSigma', 'AR', 'lambda', 'a0'],
      equation: '[kSigma] = \\max_y \\dfrac{M(y)/c(y)^3}{M_r/c_r^3}',
      residual: (v, c) => rel(v.kSigma, stressShape(c, v.AR, v.lambda)),
      solveFor: {
        kSigma: {
          rhs: '\\max_y \\dfrac{M(y)/c(y)^3}{M_r/c_r^3}',
          calc: (v, c) => stressShape(c, v.AR, v.lambda),
        },
      },
      explain:
        'Bending moment from the lifting-line load, divided by section modulus (∝ c³). Equals 1 when the root is the most stressed point.',
    },
    {
      id: 'liftCurve',
      title: 'Lift curve',
      vars: ['CL', 'kFS', 'CLa', 'alpha', 'alphaL0'],
      equation: '[CL] = [kFS]\\cdot[CLa]\\cdot([alpha]-[alphaL0])',
      residual: (v) => relAbs(v.CL, v.kFS * v.CLa * (v.alpha - v.alphaL0), 1e-3),
      solveFor: {
        CL: {
          rhs: '[kFS]\\cdot[CLa]\\cdot([alpha]-[alphaL0])',
          calc: (v) => v.kFS * v.CLa * (v.alpha - v.alphaL0),
        },
        alpha: {
          rhs: '[alphaL0]+\\dfrac{[CL]}{[kFS]\\cdot[CLa]}',
          calc: (v) => v.alphaL0 + v.CL / (v.kFS * v.CLa),
        },
        CLa: {
          rhs: '\\dfrac{[CL]}{[kFS]\\cdot([alpha]-[alphaL0])}',
          calc: (v) => v.CL / (v.kFS * (v.alpha - v.alphaL0)),
        },
      },
      explain: 'Linear lift curve of the finite foil, reduced by the free-surface factor.',
    },
    {
      id: 'induced',
      title: 'Induced drag',
      vars: ['CDi', 'CL', 'e', 'AR'],
      equation: '[CDi] = \\dfrac{[CL^2]}{[pi]\\cdot[e]\\cdot[AR]}',
      residual: (v) => relAbs(v.CDi, (v.CL * v.CL) / (Math.PI * v.e * v.AR), 1e-6),
      solveFor: {
        CDi: {
          rhs: '\\dfrac{[CL^2]}{[pi]\\cdot[e]\\cdot[AR]}',
          calc: (v) => (v.CL * v.CL) / (Math.PI * v.e * v.AR),
        },
        AR: {
          rhs: '\\dfrac{[CL^2]}{[pi]\\cdot[e]\\cdot[CDi]}',
          calc: (v) => (v.CL * v.CL) / (Math.PI * v.e * v.CDi),
        },
      },
    },
    {
      id: 'profile',
      title: 'Profile drag (strip integration)',
      vars: ['CDp', 'CL', 'Re', 'AR', 'lambda', 'a0'],
      equation:
        '[CDp] = \\dfrac{1}{S}\\int_{-b/2}^{b/2} c_d\\big(c_l(y),\\,Re(y)\\big)\\,c(y)\\,dy',
      residual: (v, c) => rel(v.CDp, stripProfileDrag(c, v.CL, v.Re, v.AR, v.lambda)),
      solveFor: {
        CDp: {
          rhs: '\\dfrac{1}{S}\\int c_d\\big(c_l(y),Re(y)\\big)\\,c(y)\\,dy\\ \\Big|_{[CL],\\ [Re]}',
          calc: (v, c) => stripProfileDrag(c, v.CL, v.Re, v.AR, v.lambda),
        },
      },
      explain:
        'Section drag looked up at the local lift coefficient and local Reynolds number of 101 spanwise strips (from the lifting-line loading), area-weighted.',
    },
    {
      id: 'totalCD',
      title: 'Total drag coefficient',
      vars: ['CD', 'CDp', 'CDi'],
      equation: '[CD] = [CDp]+[CDi]',
      residual: (v) => rel(v.CD, v.CDp + v.CDi),
      solveFor: {
        CD: { rhs: '[CDp]+[CDi]', calc: (v) => v.CDp + v.CDi },
        CDp: { rhs: '[CD]-[CDi]', calc: (v) => v.CD - v.CDi },
        CDi: { rhs: '[CD]-[CDp]', calc: (v) => v.CD - v.CDp },
      },
    },
    {
      id: 'drag',
      title: 'Drag',
      vars: ['D', 'q', 'S', 'CD'],
      equation: '[D] = [q]\\cdot[S]\\cdot[CD]',
      residual: (v) => rel(v.D, v.q * v.S * v.CD),
      solveFor: {
        D: { rhs: '[q]\\cdot[S]\\cdot[CD]', calc: (v) => v.q * v.S * v.CD },
        CD: { rhs: '\\dfrac{[D]}{[q]\\cdot[S]}', calc: (v) => v.D / (v.q * v.S) },
      },
    },
    {
      id: 'ld',
      title: 'Lift-to-drag ratio',
      vars: ['LD', 'L', 'D'],
      equation: '[LD] = \\dfrac{[L]}{[D]}',
      residual: (v) => rel(v.LD, v.L / v.D),
      solveFor: { LD: { rhs: '\\dfrac{[L]}{[D]}', calc: (v) => v.L / v.D } },
    },
    {
      id: 'power',
      title: 'Power',
      vars: ['P', 'D', 'V'],
      equation: '[P] = [D]\\cdot[V]',
      residual: (v) => rel(v.P, v.D * v.V),
      solveFor: {
        P: { rhs: '[D]\\cdot[V]', calc: (v) => v.D * v.V },
        D: { rhs: '\\dfrac{[P]}{[V]}', calc: (v) => v.P / v.V },
      },
    },
    {
      id: 'clmaxFoil',
      title: 'Foil maximum lift (critical section)',
      vars: ['CLmax', 'clmax', 'kPeak'],
      equation: '[CLmax] = \\dfrac{[clmax]}{[kPeak]}',
      residual: (v) => rel(v.CLmax, v.clmax / v.kPeak),
      solveFor: {
        CLmax: { rhs: '\\dfrac{[clmax]}{[kPeak]}', calc: (v) => v.clmax / v.kPeak },
        kPeak: { rhs: '\\dfrac{[clmax]}{[CLmax]}', calc: (v) => v.clmax / v.CLmax },
      },
      explain:
        'The foil reaches maximum lift when its most-loaded station reaches the section’s maximum lift coefficient.',
    },
    {
      id: 'stallAngle',
      title: 'Stall angle',
      vars: ['alphaStall', 'alphaL0', 'CLmax', 'kFS', 'CLa'],
      equation: '[alphaStall] = [alphaL0]+\\dfrac{[CLmax]}{[kFS]\\cdot[CLa]}',
      residual: (v) => relAbs(v.alphaStall, v.alphaL0 + v.CLmax / (v.kFS * v.CLa), 1e-4),
      solveFor: {
        alphaStall: {
          rhs: '[alphaL0]+\\dfrac{[CLmax]}{[kFS]\\cdot[CLa]}',
          calc: (v) => v.alphaL0 + v.CLmax / (v.kFS * v.CLa),
        },
      },
      explain:
        'Linear extrapolation of the lift curve to C_L,max. Real foils round off near stall, so this is on the safe side.',
    },
    {
      id: 'stallMargin',
      title: 'Stall margin',
      vars: ['stallMargin', 'alphaStall', 'alpha'],
      equation: '[stallMargin] = [alphaStall]-[alpha]',
      residual: (v) => relAbs(v.stallMargin, v.alphaStall - v.alpha, 1e-4),
      solveFor: {
        stallMargin: { rhs: '[alphaStall]-[alpha]', calc: (v) => v.alphaStall - v.alpha },
        alpha: { rhs: '[alphaStall]-[stallMargin]', calc: (v) => v.alphaStall - v.stallMargin },
      },
    },
    // ---------------- free surface & cavitation ----------------
    {
      id: 'depthRatio',
      title: 'Depth ÷ chord',
      vars: ['hc', 'h', 'mac'],
      equation: '[hc] = \\dfrac{[h]}{[mac]}',
      residual: (v) => relAbs(v.hc, v.h / v.mac, 1e-6),
      solveFor: { hc: { rhs: '\\dfrac{[h]}{[mac]}', calc: (v) => v.h / v.mac } },
    },
    {
      id: 'freeSurface',
      title: 'Free-surface lift factor',
      vars: ['kFS', 'hc'],
      equation: '[kFS] = \\dfrac{16\\cdot[hc^2]+1}{16\\cdot[hc^2]+2}',
      residual: (v) => rel(v.kFS, freeSurfaceFactor(v.hc)),
      solveFor: {
        kFS: {
          rhs: '\\dfrac{16\\cdot[hc^2]+1}{16\\cdot[hc^2]+2}',
          calc: (v) => freeSurfaceFactor(v.hc),
        },
      },
      explain:
        'High-Froude-number image-vortex approximation for a foil near the surface (Hoerner & Borst, Fluid-Dynamic Lift).',
    },
    {
      id: 'cavNumber',
      title: 'Cavitation number',
      vars: ['sigma', 'patm', 'rho', 'h', 'pv', 'q'],
      equation: '[sigma] = \\dfrac{[patm]+[rho]\\cdot[g]\\cdot[h]-[pv]}{[q]}',
      residual: (v) => rel(v.sigma, (v.patm + v.rho * G * v.h - v.pv) / v.q),
      solveFor: {
        sigma: {
          rhs: '\\dfrac{[patm]+[rho]\\cdot[g]\\cdot[h]-[pv]}{[q]}',
          calc: (v) => (v.patm + v.rho * G * v.h - v.pv) / v.q,
        },
      },
    },
    {
      id: 'clPeak',
      title: 'Peak local section lift',
      vars: ['clPeak', 'kPeak', 'CL'],
      equation: '[clPeak] = [kPeak]\\cdot[CL]',
      residual: (v) => relAbs(v.clPeak, v.kPeak * v.CL, 1e-4),
      solveFor: { clPeak: { rhs: '[kPeak]\\cdot[CL]', calc: (v) => v.kPeak * v.CL } },
    },
    {
      id: 'cpMin',
      title: 'Minimum pressure coefficient',
      vars: ['cpMin', 'clPeak', 'a0'],
      equation: '[cpMin] = \\min_x C_p(x)\\ \\text{at}\\ c_l=[clPeak]',
      residual: (v, c) => relAbs(v.cpMin, c.section.cpMin(v.clPeak), 1e-4),
      solveFor: {
        cpMin: {
          rhs: '\\min_x C_p(x)\\ \\text{at}\\ c_l=[clPeak]',
          calc: (v, c) => c.section.cpMin(v.clPeak),
        },
      },
      explain:
        'Panel-method pressure distribution of the section at the angle that gives this cl (inviscid, so slightly conservative).',
    },
    {
      id: 'cavMargin',
      title: 'Cavitation margin',
      vars: ['cavMargin', 'sigma', 'cpMin'],
      equation: '[cavMargin] = [sigma]+[cpMin]',
      residual: (v) => relAbs(v.cavMargin, v.sigma + v.cpMin, 1e-4),
      solveFor: { cavMargin: { rhs: '[sigma]+[cpMin]', calc: (v) => v.sigma + v.cpMin } },
      explain:
        'Cavitation starts where −C_p,min exceeds σ. A positive margin means none is predicted.',
    },
    {
      id: 'vcav',
      title: 'Cavitation inception speed',
      vars: ['Vcav', 'L', 'S', 'rho', 'h', 'pv', 'patm', 'kPeak', 'a0'],
      equation:
        '\\sigma([Vcav]) + C_{p,min}\\!\\Big([kPeak]\\cdot\\dfrac{[L]}{\\tfrac12[rho]\\,[Vcav^2]\\,[S]}\\Big) = 0',
      residual: (v, c) => {
        const x = vcav(v, c);
        if (!Number.isFinite(x) && !Number.isFinite(v.Vcav)) return 0;
        return rel(v.Vcav, x);
      },
      solveFor: {
        Vcav: {
          rhs: '\\text{root of } \\sigma(V)+C_{p,min}\\big(c_{l,peak}(V)\\big)=0',
          calc: (v, c) => vcav(v, c),
        },
      },
      explain:
        'Speed is swept upward at constant lift; cl falls as 1/V², σ falls faster, and inception is where they meet (Brent root-finding).',
    },
    // ---------------- structure ----------------
    {
      id: 'rootMoment',
      title: 'Root bending moment',
      vars: ['Mroot', 'L', 'b', 'etaBar'],
      equation: '[Mroot] = \\dfrac{[L]}{2}\\cdot\\dfrac{[b]}{2}\\cdot[etaBar]',
      residual: (v) => rel(v.Mroot, (v.L / 2) * (v.b / 2) * v.etaBar),
      solveFor: {
        Mroot: {
          rhs: '\\dfrac{[L]}{2}\\cdot\\dfrac{[b]}{2}\\cdot[etaBar]',
          calc: (v) => (v.L / 2) * (v.b / 2) * v.etaBar,
        },
        b: {
          rhs: '\\dfrac{4\\cdot[Mroot]}{[L]\\cdot[etaBar]}',
          calc: (v) => (4 * v.Mroot) / (v.L * v.etaBar),
        },
        L: {
          rhs: '\\dfrac{4\\cdot[Mroot]}{[b]\\cdot[etaBar]}',
          calc: (v) => (4 * v.Mroot) / (v.b * v.etaBar),
        },
      },
      explain:
        'Each half-span is a cantilever from the centre strut carrying half the lift at its load centroid.',
    },
    {
      id: 'stress',
      title: 'Peak bending stress',
      vars: ['sigmaMax', 'kSigma', 'Mroot', 'Z1', 'cr'],
      equation: '[sigmaMax] = [kSigma]\\cdot\\dfrac{[Mroot]}{[Z1]\\cdot[cr^3]}',
      residual: (v) => rel(v.sigmaMax, (v.kSigma * v.Mroot) / (v.Z1 * v.cr ** 3)),
      solveFor: {
        sigmaMax: {
          rhs: '[kSigma]\\cdot\\dfrac{[Mroot]}{[Z1]\\cdot[cr^3]}',
          calc: (v) => (v.kSigma * v.Mroot) / (v.Z1 * v.cr ** 3),
        },
        cr: {
          rhs: '\\sqrt[3]{\\dfrac{[kSigma]\\cdot[Mroot]}{[Z1]\\cdot[sigmaMax]}}',
          calc: (v) => Math.cbrt((v.kSigma * v.Mroot) / (v.Z1 * v.sigmaMax)),
        },
        Mroot: {
          rhs: '\\dfrac{[sigmaMax]\\cdot[Z1]\\cdot[cr^3]}{[kSigma]}',
          calc: (v) => (v.sigmaMax * v.Z1 * v.cr ** 3) / v.kSigma,
        },
      },
      explain: 'Solid section: section modulus Z = Z₁·c³ from the actual profile shape.',
    },
    {
      id: 'safety',
      title: 'Safety factor',
      vars: ['SF', 'sy', 'sigmaMax'],
      equation: '[SF] = \\dfrac{[sy]}{[sigmaMax]}',
      residual: (v) => rel(v.SF, v.sy / v.sigmaMax),
      solveFor: {
        SF: { rhs: '\\dfrac{[sy]}{[sigmaMax]}', calc: (v) => v.sy / v.sigmaMax },
        sigmaMax: { rhs: '\\dfrac{[sy]}{[SF]}', calc: (v) => v.sy / v.SF },
        sy: { rhs: '[SF]\\cdot[sigmaMax]', calc: (v) => v.SF * v.sigmaMax },
      },
    },
    {
      id: 'deflection',
      title: 'Tip deflection',
      vars: ['deflTip', 'L', 'b', 'cr', 'lambda', 'E', 'AR', 'I1', 'a0'],
      equation:
        '[deflTip] = \\int_0^{b/2}\\!\\int_0^{y}\\dfrac{M(s)}{[E]\\cdot[I1]\\cdot c(s)^4}\\,ds\\,dy',
      residual: (v, c) =>
        relAbs(v.deflTip, tipDeflection(c, v.L, v.b, v.cr, v.lambda, v.E, v.AR, v.I1), 1e-9),
      solveFor: {
        deflTip: {
          rhs: '\\iint \\dfrac{M}{[E]\\cdot[I1]\\cdot c^4}\\Big|_{[L],\\,[b],\\,[cr]}',
          calc: (v, c) => tipDeflection(c, v.L, v.b, v.cr, v.lambda, v.E, v.AR, v.I1),
        },
      },
      explain:
        'Euler–Bernoulli beam: curvature M/(EI) integrated twice from the clamped root; I = I₁·c⁴ varies along a tapered span.',
    },
    {
      id: 'deflRatio',
      title: 'Relative tip deflection',
      vars: ['deflRatio', 'deflTip', 'b'],
      equation: '[deflRatio] = \\dfrac{[deflTip]}{[b]/2}',
      residual: (v) => relAbs(v.deflRatio, v.deflTip / (v.b / 2), 1e-9),
      solveFor: {
        deflRatio: { rhs: '\\dfrac{[deflTip]}{[b]/2}', calc: (v) => v.deflTip / (v.b / 2) },
      },
    },
  ];

  // planform-specific chord relations
  const k2 = chordSquaredRatio(planform, 0.5);
  if (planform === 'rectangular') {
    R.push(
      {
        id: 'meanChord',
        title: 'Mean chord (rectangular)',
        vars: ['cbar', 'cr'],
        equation: '[cbar] = [cr]',
        residual: (v) => rel(v.cbar, v.cr),
        solveFor: {
          cbar: { rhs: '[cr]', calc: (v) => v.cr },
          cr: { rhs: '[cbar]', calc: (v) => v.cbar },
        },
      },
      {
        id: 'macChord',
        title: 'Mean aerodynamic chord (rectangular)',
        vars: ['mac', 'cr'],
        equation: '[mac] = [cr]',
        residual: (v) => rel(v.mac, v.cr),
        solveFor: {
          mac: { rhs: '[cr]', calc: (v) => v.cr },
          cr: { rhs: '[mac]', calc: (v) => v.mac },
        },
      },
      {
        id: 'tipChord',
        title: 'Tip chord (rectangular)',
        vars: ['ct', 'cr'],
        equation: '[ct] = [cr]',
        residual: (v) => rel(v.ct, v.cr),
        solveFor: {
          ct: { rhs: '[cr]', calc: (v) => v.cr },
          cr: { rhs: '[ct]', calc: (v) => v.ct },
        },
      },
    );
  } else if (planform === 'tapered') {
    R.push(
      {
        id: 'meanChord',
        title: 'Mean chord (tapered)',
        vars: ['cbar', 'cr', 'lambda'],
        equation: '[cbar] = [cr]\\cdot\\dfrac{1+[lambda]}{2}',
        residual: (v) => rel(v.cbar, (v.cr * (1 + v.lambda)) / 2),
        solveFor: {
          cbar: {
            rhs: '[cr]\\cdot\\dfrac{1+[lambda]}{2}',
            calc: (v) => (v.cr * (1 + v.lambda)) / 2,
          },
          cr: {
            rhs: '\\dfrac{2\\cdot[cbar]}{1+[lambda]}',
            calc: (v) => (2 * v.cbar) / (1 + v.lambda),
          },
          lambda: { rhs: '\\dfrac{2\\cdot[cbar]}{[cr]}-1', calc: (v) => (2 * v.cbar) / v.cr - 1 },
        },
      },
      {
        id: 'macChord',
        title: 'Mean aerodynamic chord (tapered)',
        vars: ['mac', 'cr', 'lambda'],
        equation: '[mac] = \\dfrac{2}{3}\\cdot[cr]\\cdot\\dfrac{1+[lambda]+[lambda^2]}{1+[lambda]}',
        residual: (v) => rel(v.mac, v.cr * macRatio('tapered', v.lambda)),
        solveFor: {
          mac: {
            rhs: '\\dfrac{2}{3}\\cdot[cr]\\cdot\\dfrac{1+[lambda]+[lambda^2]}{1+[lambda]}',
            calc: (v) => v.cr * macRatio('tapered', v.lambda),
          },
          cr: {
            rhs: '\\dfrac{[mac]}{\\tfrac{2}{3}\\cdot\\tfrac{1+[lambda]+[lambda^2]}{1+[lambda]}}',
            calc: (v) => v.mac / macRatio('tapered', v.lambda),
          },
          lambda: { rhs: 'f^{-1}([mac]/[cr])' },
        },
      },
      {
        id: 'tipChord',
        title: 'Tip chord',
        vars: ['ct', 'lambda', 'cr'],
        equation: '[ct] = [lambda]\\cdot[cr]',
        residual: (v) => rel(v.ct, v.lambda * v.cr),
        solveFor: {
          ct: { rhs: '[lambda]\\cdot[cr]', calc: (v) => v.lambda * v.cr },
          lambda: { rhs: '\\dfrac{[ct]}{[cr]}', calc: (v) => v.ct / v.cr },
          cr: { rhs: '\\dfrac{[ct]}{[lambda]}', calc: (v) => v.ct / v.lambda },
        },
      },
    );
  } else {
    R.push(
      {
        id: 'meanChord',
        title: 'Mean chord (elliptical)',
        vars: ['cbar', 'cr'],
        equation: '[cbar] = \\dfrac{[pi]}{4}\\cdot[cr]',
        residual: (v) => rel(v.cbar, (Math.PI / 4) * v.cr),
        solveFor: {
          cbar: { rhs: '\\dfrac{[pi]}{4}\\cdot[cr]', calc: (v) => (Math.PI / 4) * v.cr },
          cr: { rhs: '\\dfrac{4\\cdot[cbar]}{[pi]}', calc: (v) => (4 * v.cbar) / Math.PI },
        },
      },
      {
        id: 'macChord',
        title: 'Mean aerodynamic chord (elliptical)',
        vars: ['mac', 'cr'],
        equation: '[mac] = \\dfrac{8}{3\\cdot[pi]}\\cdot[cr]',
        residual: (v) => rel(v.mac, (8 / (3 * Math.PI)) * v.cr),
        solveFor: {
          mac: {
            rhs: '\\dfrac{8}{3\\cdot[pi]}\\cdot[cr]',
            calc: (v) => (8 / (3 * Math.PI)) * v.cr,
          },
          cr: {
            rhs: '\\dfrac{3\\cdot[pi]}{8}\\cdot[mac]',
            calc: (v) => ((3 * Math.PI) / 8) * v.mac,
          },
        },
      },
    );
  }
  if (planform !== 'elliptical') {
    R.push({
      id: 'tTip',
      title: 'Tip thickness',
      vars: ['tTip', 'tc', 'ct'],
      equation: '[tTip] = [tc]\\cdot[ct]',
      residual: (v) => rel(v.tTip, v.tc * v.ct),
      solveFor: {
        tTip: { rhs: '[tc]\\cdot[ct]', calc: (v) => v.tc * v.ct },
        ct: { rhs: '\\dfrac{[tTip]}{[tc]}', calc: (v) => v.tTip / v.tc },
      },
    });
  }
  const k2Txt =
    planform === 'rectangular'
      ? '1'
      : planform === 'elliptical'
        ? '\\tfrac{2}{3}'
        : '\\tfrac{1+[lambda]+[lambda^2]}{3}';
  R.push({
    id: 'mass',
    title: 'Foil mass (solid)',
    vars:
      planform === 'tapered'
        ? ['massFoil', 'rhoM', 'A1', 'b', 'cr', 'lambda']
        : ['massFoil', 'rhoM', 'A1', 'b', 'cr'],
    equation: `[massFoil] = [rhoM]\\cdot[A1]\\cdot${k2Txt}\\cdot[b]\\cdot[cr^2]`,
    residual: (v) =>
      rel(v.massFoil, v.rhoM * v.A1 * kk2(planform, v.lambda, k2) * v.b * v.cr * v.cr),
    solveFor: {
      massFoil: {
        rhs: `[rhoM]\\cdot[A1]\\cdot${k2Txt}\\cdot[b]\\cdot[cr^2]`,
        calc: (v) => v.rhoM * v.A1 * kk2(planform, v.lambda, k2) * v.b * v.cr * v.cr,
      },
    },
    explain: 'Volume = ∫ A₁·c(y)² dy over the span, times material density (no strut or fittings).',
  });
  return R;
}

function kk2(planform: PlanformType, lambda: number, fallback: number): number {
  return planform === 'tapered' ? chordSquaredRatio('tapered', lambda) : fallback;
}

/** Cavitation inception speed at constant lift; Infinity if none below 80 m/s. */
function vcav(v: Vals, c: Ctx): number {
  if (!(v.L > 0 && v.S > 0 && v.rho > 0)) return NaN;
  const r = cavitationInceptionSpeed(v.patm, v.rho, G, v.h, v.pv, (V) =>
    c.section.cpMin((v.kPeak * v.L) / (0.5 * v.rho * V * V * v.S)),
  );
  return r === null ? Infinity : r;
}

/** Relations that only compute a property from a correlation; skipped when the user types the property. */
export const PROPERTY_RELATIONS: Record<string, string> = { rhoT: 'rho', nuT: 'nu', pvT: 'pv' };
