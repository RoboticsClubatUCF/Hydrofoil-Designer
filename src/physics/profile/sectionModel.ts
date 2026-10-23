/**
 * One interface to the 2-D section characteristics, whichever data source is used:
 *  - "polar": XFoil polars pasted from airfoiltools.com (interpolated in log Re)
 *  - "estimate": panel method + integral boundary layer, calibrated against XFoil
 * Minimum pressure for cavitation always comes from the panel method at matching cl.
 */
import { clamp, interp } from '../numeric';
import { buildGeometry, type SectionGeometry } from './geometry';
import { alphaForCl, inviscidLiftLine, panelAt, solvePanels, type PanelSolution } from './panel';
import { sectionBoundaryLayer } from './boundaryLayer';
import type { ParsedProfile } from './parse';
import { summarisePolar, type Polar, type PolarSummary } from './polar';

export type SectionMode = 'polar' | 'estimate';

/** Upper-surface turbulent separation reaching this chord fraction marks cl_max (estimate mode). */
export const SEPARATION_CLMAX_X = 0.92;
/** Default ratio of viscous to inviscid lift slope (estimate mode); XFoil 63-412 at Re 0.5–1M gives 0.93–0.95. */
export const DEFAULT_KAPPA = 0.93;

export interface SectionPoint {
  alphaL0: number; // rad
  a0: number; // per rad
  clmax: number;
  alphaStall: number; // rad
  cm0: number;
}

export interface SectionModel {
  mode: SectionMode;
  geometry: SectionGeometry;
  panel: PanelSolution;
  inviscid: { a0: number; alphaL0: number };
  kappa: number;
  reRange: [number, number] | null;
  at(Re: number): SectionPoint;
  cd(cl: number, Re: number): number;
  /** Minimum pressure coefficient at this section cl (inviscid, matched by cl). */
  cpMin(cl: number): number;
  /** Pressure distribution at this cl for plots. */
  cpDistribution(cl: number): { x: number[]; cp: number[]; upper: boolean[] };
  /** cl–α curve for plots (deg). */
  liftCurve(Re: number): { alphaDeg: number[]; cl: number[] };
  dragPolar(Re: number): { cl: number[]; cd: number[] };
  notes: string[];
}

const D2R = Math.PI / 180;
const RE_GRID = [3e4, 5e4, 1e5, 2e5, 3.5e5, 5e5, 7.5e5, 1e6, 1.5e6, 2e6, 3e6, 5e6, 1e7, 2e7];
const CL_GRID = Array.from({ length: 27 }, (_, i) => -0.4 + i * 0.1); // −0.4 … 2.2
/** Highest tabulated cl; above it cpMin needs a direct panel solve. */
export const CL_TABLE_MAX = CL_GRID[CL_GRID.length - 1];

export function buildSectionModel(
  profile: ParsedProfile,
  polars: Polar[],
  kappa = DEFAULT_KAPPA,
): SectionModel {
  const geometry = buildGeometry(profile, 200);
  const panel = solvePanels(geometry.nodes);
  const inviscid = inviscidLiftLine(panel);

  const cpCache = new Map<number, ReturnType<typeof panelAt>>();
  const panelAtCl = (cl: number) => {
    const key = Math.round(cl * 1000) / 1000;
    let r = cpCache.get(key);
    if (!r) {
      r = panelAt(panel, alphaForCl(panel, key));
      if (cpCache.size > 400) cpCache.clear();
      cpCache.set(key, r);
    }
    return r;
  };
  const cpMinTable = CL_GRID.map((cl) => panelAtCl(cl).cpMin);
  const cpMin = (cl: number) => {
    if (cl < CL_GRID[0] || cl > CL_GRID[CL_GRID.length - 1]) return panelAtCl(cl).cpMin;
    return interp(cl, CL_GRID, cpMinTable);
  };
  const cpDistribution = (cl: number) => {
    const r = panelAtCl(cl);
    const n = r.cp.length;
    let iLE = 0;
    for (let k = 1; k < n; k++) if (panel.nodes[k].x < panel.nodes[iLE].x) iLE = k;
    return {
      x: panel.nodes.map((p) => p.x),
      cp: r.cp,
      upper: panel.nodes.map((_, k) => k <= iLE),
    };
  };

  if (polars.length > 0) {
    const sums: PolarSummary[] = polars.map(summarisePolar).sort((a, b) => a.Re - b.Re);
    const reRange: [number, number] = [sums[0].Re, sums[sums.length - 1].Re];
    const bracket = (Re: number) => {
      if (sums.length === 1 || Re <= sums[0].Re) return { a: sums[0], b: sums[0], w: 0 };
      if (Re >= sums[sums.length - 1].Re)
        return { a: sums[sums.length - 1], b: sums[sums.length - 1], w: 0 };
      let i = 0;
      while (sums[i + 1].Re < Re) i++;
      const a = sums[i],
        b = sums[i + 1];
      return { a, b, w: Math.log(Re / a.Re) / Math.log(b.Re / a.Re) };
    };
    const lerp = (x: number, y: number, w: number) => x + (y - x) * w;
    const cdOne = (s: PolarSummary, cl: number) => interp(cl, s.branchCl, s.branchCd);
    return {
      mode: 'polar',
      geometry,
      panel,
      inviscid,
      kappa: 1,
      reRange,
      at(Re) {
        const { a, b, w } = bracket(Re);
        return {
          alphaL0: lerp(a.alphaL0, b.alphaL0, w),
          a0: lerp(a.a0, b.a0, w),
          clmax: lerp(a.clmax, b.clmax, w),
          alphaStall: lerp(a.alphaStall, b.alphaStall, w),
          cm0: lerp(a.cm0, b.cm0, w),
        };
      },
      cd(cl, Re) {
        const { a, b, w } = bracket(Re);
        let cd = Math.exp(lerp(Math.log(cdOne(a, cl)), Math.log(cdOne(b, cl)), w));
        // outside the pasted Re range: scale with a turbulent-like Re^−0.2 trend
        if (Re < reRange[0]) cd *= Math.pow(Re / reRange[0], -0.2);
        if (Re > reRange[1]) cd *= Math.pow(Re / reRange[1], -0.2);
        return cd;
      },
      cpMin,
      cpDistribution,
      liftCurve(Re) {
        const { a, b, w } = bracket(Re);
        const pa = polars.find((p) => p.Re === a.Re)!;
        const pb = polars.find((p) => p.Re === b.Re)!;
        const lo = Math.max(pa.rows[0].alpha, pb.rows[0].alpha);
        const hi = Math.min(pa.rows[pa.rows.length - 1].alpha, pb.rows[pb.rows.length - 1].alpha);
        const alphaDeg: number[] = [],
          cl: number[] = [];
        for (let x = lo; x <= hi + 1e-9; x += 0.25) {
          const ca = interp(
            x,
            pa.rows.map((r) => r.alpha),
            pa.rows.map((r) => r.cl),
          );
          const cb = interp(
            x,
            pb.rows.map((r) => r.alpha),
            pb.rows.map((r) => r.cl),
          );
          alphaDeg.push(x);
          cl.push(lerp(ca, cb, w));
        }
        return { alphaDeg, cl };
      },
      dragPolar(Re) {
        const { a } = bracket(Re);
        const cls = a.branchCl;
        return { cl: cls, cd: cls.map((c) => this.cd(c, Re)) };
      },
      notes: [
        `Using ${sums.length} pasted polar${sums.length > 1 ? 's' : ''} (Re ${reRange[0].toExponential(1)} – ${reRange[1].toExponential(1)}), interpolated in log Re.`,
      ],
    };
  }

  // ---------- estimate mode ----------
  // Drag and separation tables on (cl, Re), matched by cl.
  const cdTable: number[][] = []; // [re][cl]
  const sepTable: number[][] = [];
  for (const Re of RE_GRID) {
    const cdRow: number[] = [],
      sepRow: number[] = [];
    for (const cl of CL_GRID) {
      const r = panelAtCl(cl);
      const bl = sectionBoundaryLayer(panel, r, Re);
      cdRow.push(bl.cd);
      sepRow.push(bl.upper.xSeparation ?? 1);
    }
    cdTable.push(cdRow);
    sepTable.push(sepRow);
  }
  const logRe = RE_GRID.map(Math.log);
  const clmaxRow = sepTable.map((row) => {
    for (let i = 1; i < row.length; i++) {
      if (CL_GRID[i] > 0 && row[i] < SEPARATION_CLMAX_X && row[i - 1] >= SEPARATION_CLMAX_X) {
        const t = (row[i - 1] - SEPARATION_CLMAX_X) / (row[i - 1] - row[i]);
        return CL_GRID[i - 1] + t * (CL_GRID[i] - CL_GRID[i - 1]);
      }
    }
    return CL_GRID[CL_GRID.length - 1];
  });
  const a0 = kappa * inviscid.a0;
  const alphaL0 = inviscid.alphaL0;
  const cdAt = (cl: number, Re: number) => {
    const lr = clamp(Math.log(Re), logRe[0], logRe[logRe.length - 1]);
    let j = 0;
    while (j < logRe.length - 2 && logRe[j + 1] < lr) j++;
    const w = (lr - logRe[j]) / (logRe[j + 1] - logRe[j]);
    const c0 = Math.log(interp(cl, CL_GRID, cdTable[j]));
    const c1 = Math.log(interp(cl, CL_GRID, cdTable[j + 1]));
    return Math.exp(c0 + (c1 - c0) * w);
  };
  const clmaxAt = (Re: number) => interp(Math.log(Re), logRe, clmaxRow);
  return {
    mode: 'estimate',
    geometry,
    panel,
    inviscid,
    kappa,
    reRange: null,
    at(Re) {
      const clmax = clmaxAt(Re);
      return {
        alphaL0,
        a0,
        clmax,
        alphaStall: alphaL0 + clmax / a0,
        cm0: kappa * panelAt(panel, alphaL0).cm,
      };
    },
    cd: cdAt,
    cpMin,
    cpDistribution,
    liftCurve(Re) {
      const clmax = clmaxAt(Re);
      const alphaDeg: number[] = [],
        cl: number[] = [];
      const aS = (alphaL0 + clmax / a0) / D2R;
      for (let x = -10; x <= aS + 4; x += 0.25) {
        alphaDeg.push(x);
        const lin = a0 * (x * D2R - alphaL0);
        // beyond the estimated stall, show a gentle post-stall drop (illustrative only)
        cl.push(x <= aS ? lin : clmax - 0.04 * (x - aS) * clmax);
      }
      return { alphaDeg, cl };
    },
    dragPolar(Re) {
      const clmax = clmaxAt(Re);
      const cls = CL_GRID.filter((c) => c <= clmax + 1e-9);
      return { cl: cls, cd: cls.map((c) => cdAt(c, Re)) };
    },
    notes: [
      'No polar pasted: lift slope, drag and max lift are estimated with a panel method and boundary-layer march. Paste airfoiltools polars for better accuracy.',
    ],
  };
}
