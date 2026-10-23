/**
 * Builds the 3-D flow state for the foils as designed, flown at the speed, load
 * and depth chosen in the 3-D view. The operating point uses exactly the design
 * equations (lifting line, free-surface factor, strip profile drag, panel-method
 * cavitation check); the flow field is the vortex model in vortex.ts plus the
 * section near field in nearField.ts.
 */
import { G as GRAV } from '../physics/fluid';
import { freeSurfaceFactor } from '../physics/hydro/freeSurface';
import { cavitationInceptionSpeed } from '../physics/hydro/cavitation';
import { CL_TABLE_MAX, type SectionModel } from '../physics/profile/sectionModel';
import { liftingLine } from '../physics/wing/liftingLine';
import { chordRatio, macRatio, meanChordRatio } from '../physics/wing/planform';
import { interp } from '../physics/numeric';
import { effLambda, stripProfileDrag } from '../solver/relations';
import type { Ctx } from '../solver/types';
import { panelAlphaForCl, type NearFieldSection } from './nearField';
import type { FlowFoil, FlowFoilRequest, FlowRequest, FlowState, FoilOp } from './types';
import { SEG_STRIDE, addSegmentVelocity, foilVortexSegments, withImages } from './vortex';

export const N_STATION = 48;

const fin = (x: number | undefined, d: number) => (x !== undefined && Number.isFinite(x) ? x : d);

export interface FoilGeometry {
  b: number;
  cr: number;
  lambda: number;
  S: number;
  AR: number;
  mac: number;
}

/** Span, chords, area, aspect ratio and MAC from the design values (or null if not yet sized). */
export function foilGeometry(
  req: Pick<FlowFoilRequest, 'planform' | 'values'>,
): FoilGeometry | null {
  const v = req.values;
  if (!(v.b > 0 && v.cr > 0)) return null;
  const lambda = effLambda(req.planform, fin(v.lambda, 1));
  const S = fin(v.S, v.b * v.cr * meanChordRatio(req.planform, lambda));
  const AR = fin(v.AR, (v.b * v.b) / S);
  const mac = fin(v.mac, v.cr * macRatio(req.planform, lambda));
  return { b: v.b, cr: v.cr, lambda, S, AR, mac };
}

export function waterOf(v: Record<string, number>) {
  return {
    rho: fin(v.rho, 998.21),
    nu: fin(v.nu, 1.0034e-6),
    patm: fin(v.patm, 101325),
    pv: fin(v.pv, 2339),
  };
}

/** The design equations evaluated at speed V, required lift Lreq and depth h. */
export function operate(
  section: SectionModel,
  req: Pick<FlowFoilRequest, 'planform' | 'values'>,
  geo: FoilGeometry,
  V: number,
  Lreq: number,
  h: number,
): FoilOp {
  const { rho, nu, patm, pv } = waterOf(req.values);
  const { S, AR, mac, lambda } = geo;
  const q = 0.5 * rho * V * V;
  const Re = (V * mac) / nu;
  const sec = section.at(Re);
  const r = liftingLine(req.planform, AR, lambda, sec.a0);
  const hc = h / mac;
  const kFS = freeSurfaceFactor(hc);
  const CLreq = Lreq / (q * S);
  const CLmax = sec.clmax / r.clPeakRatio;
  const stalled = CLreq > CLmax;
  const CL = stalled ? CLmax : CLreq;
  const CLa = r.CLalpha;
  const alpha = sec.alphaL0 + CL / (kFS * CLa);
  const alphaStall = sec.alphaL0 + CLmax / (kFS * CLa);
  const ctx: Ctx = {
    planform: req.planform,
    section,
    sec,
    reEstimate: Re,
    salinity: 0,
    material: null,
  };
  const CDp = stripProfileDrag(ctx, CL, Re, AR, lambda);
  const CDi = (CL * CL) / (Math.PI * r.e * AR);
  const D = q * S * (CDp + CDi);
  const L = q * S * CL;
  const sigma = (patm + rho * GRAV * h - pv) / q;
  const cpMin = section.cpMin(r.clPeakRatio * CL);
  // cavitation inception at this load and depth, as in the design equations (null: none below 80 m/s)
  const vLo = Math.max(0.5, Math.sqrt((r.clPeakRatio * Lreq) / (0.5 * rho * S * CL_TABLE_MAX)));
  const Vcav =
    vLo < 80
      ? cavitationInceptionSpeed(
          patm,
          rho,
          GRAV,
          h,
          pv,
          (Vx) => section.cpMin((r.clPeakRatio * Lreq) / (0.5 * rho * Vx * Vx * S)),
          vLo,
          80,
        )
      : null;
  return {
    V,
    Lreq,
    L,
    q,
    Re,
    h,
    hc,
    kFS,
    alphaL0: sec.alphaL0,
    a0: sec.a0,
    CLa,
    e: r.e,
    kPeak: r.clPeakRatio,
    CLreq,
    CL,
    CLmax,
    stalled,
    alpha,
    alphaStall,
    stallMargin: alphaStall - alpha,
    CDp,
    CDi,
    D,
    P: D * V,
    LD: L / D,
    sigma,
    cpMin,
    cavMargin: sigma + cpMin,
    Vcav,
    otherAngle: 0,
    angleGap: 0,
  };
}

export interface FlowSection {
  model: SectionModel;
  near: NearFieldSection;
}

interface Prepared {
  req: FlowFoilRequest;
  sec: FlowSection;
  geo: FoilGeometry;
  op: FoilOp;
  chordAt: (eta: number) => number;
  clAt: (eta: number) => number;
  gammaAt: (eta: number) => number;
  pitch: number;
  segs: number[];
  wake: ReturnType<typeof foilVortexSegments>['wake'];
}

export function buildFlow(
  request: FlowRequest,
  sectionFor: (slot: 1 | 2) => FlowSection | null,
): FlowState {
  const V = request.V;
  const water = waterOf(request.foils[0]?.values ?? {});
  const prepared: Prepared[] = [];
  for (const req of request.foils) {
    const sec = sectionFor(req.slot);
    const geo = foilGeometry(req);
    if (!sec || !geo || !(req.values.L > 0)) continue;
    const op = operate(sec.model, req, geo, V, req.values.L * request.loadFactor, req.h);
    const r = liftingLine(req.planform, geo.AR, geo.lambda, op.a0);
    const chordAt = (eta: number) => geo.cr * chordRatio(req.planform, geo.lambda, eta);
    const clAt = (eta: number) => interp(eta, r.eta, r.clRatio) * op.CL;
    const gammaAt = (eta: number) => 0.5 * V * chordAt(eta) * clAt(eta);
    prepared.push({
      req,
      sec,
      geo,
      op,
      chordAt,
      clAt,
      gammaAt,
      pitch: op.alpha,
      segs: [],
      wake: null as never,
    });
  }
  if (!prepared.length) throw new Error('Nothing to simulate yet');

  const build = (p: Prepared) => {
    const out = foilVortexSegments(
      {
        x0: p.req.x0,
        z0: -p.req.h,
        b: p.geo.b,
        pitch: p.pitch,
        V,
        chordAt: p.chordAt,
        gammaAt: p.gammaAt,
        nSpan: request.nSpan,
      },
      p.op.CL,
      p.geo.AR,
    );
    p.segs = withImages(out.segs);
    p.wake = out.wake;
  };
  prepared.forEach(build);

  // Each foil flies at its design angle to the flow it meets: trim out the other foil's induced angle.
  if (prepared.length > 1) {
    for (const p of prepared) {
      const others = prepared.filter((o) => o !== p).flatMap((o) => o.segs);
      let wSum = 0,
        gSum = 0;
      const u = [0, 0, 0];
      for (let j = 0; j < 24; j++) {
        const eta = (j + 0.5) / 24;
        const g = p.gammaAt(eta);
        for (const side of [1, -1]) {
          u[0] = u[1] = u[2] = 0;
          addSegmentVelocity(
            others,
            others.length / SEG_STRIDE,
            p.req.x0,
            (side * eta * p.geo.b) / 2,
            -p.req.h,
            u,
          );
          wSum += g * u[2];
          gSum += g;
        }
      }
      p.op.otherAngle = gSum > 0 ? wSum / gSum / V : 0;
      p.pitch = p.op.alpha - p.op.otherAngle;
    }
    prepared.forEach(build);
  }

  const all = prepared.flatMap((p) => p.segs);
  const nSeg = all.length / SEG_STRIDE;
  const M = N_STATION;
  const foils: FlowFoil[] = prepared.map((p) => {
    const near = p.sec.near;
    const st = new Float32Array(4 * M);
    const stCl = new Float32Array(M);
    const stGamma = new Float32Array(M);
    const geom = p.sec.model.geometry;
    const nMesh = geom.nodes.length;
    const cp = new Float32Array(M * nMesh);
    const cP = Math.cos(p.pitch),
      sP = Math.sin(p.pitch);
    const u = [0, 0, 0];
    let gap = 0;
    for (let j = 0; j < M; j++) {
      const eta = j / (M - 1);
      const cTrue = p.chordAt(eta);
      const c = Math.max(cTrue, 0.02 * p.geo.cr);
      const y = (eta * p.geo.b) / 2;
      u[0] = V;
      u[1] = 0;
      u[2] = 0;
      addSegmentVelocity(all, nSeg, p.req.x0, y, -p.req.h, u);
      const Vc = u[0] * cP - u[2] * sP;
      const Vn = u[0] * sP + u[2] * cP;
      const Uloc = Math.hypot(Vc, Vn);
      const aLoc = Math.atan2(Vn, Vc);
      const cl = p.clAt(eta);
      const gam = 0.5 * V * cTrue * cl;
      const clP = (2 * gam) / (Uloc * c);
      const aP = panelAlphaForCl(near, clP);
      const a0 = Uloc * Math.cos(aP),
        a90 = Uloc * Math.sin(aP);
      st[4 * j] = c;
      st[4 * j + 1] = a0;
      st[4 * j + 2] = a90;
      st[4 * j + 3] = a0 * near.gam0 + a90 * near.gam90;
      stCl[j] = cl;
      stGamma[j] = gam;
      if (eta < 0.95) gap = Math.max(gap, Math.abs(aLoc - aP));
      // surface pressure at this station, referred to the free-stream speed
      const d = p.sec.model.cpDistribution(clP);
      const ratio = (Uloc / V) ** 2;
      for (let k = 0; k < nMesh; k++) cp[j * nMesh + k] = 1 - ratio * (1 - d.cp[k]);
    }
    p.op.angleGap = gap;
    const meshNodes = new Float32Array(2 * nMesh);
    geom.nodes.forEach((q, k) => {
      meshNodes[2 * k] = q.x;
      meshNodes[2 * k + 1] = q.y;
    });
    const nn = near.n;
    const nodes = new Float32Array(2 * nn);
    nodes.set(near.nodes);
    return {
      name: p.req.name,
      planform: p.req.planform,
      lambda: p.geo.lambda,
      b: p.geo.b,
      cr: p.geo.cr,
      S: p.geo.S,
      AR: p.geo.AR,
      mac: p.geo.mac,
      x0: p.req.x0,
      z0: -p.req.h,
      pitch: p.pitch,
      op: p.op,
      nodes,
      g0: Float32Array.from(near.g0),
      g90: Float32Array.from(near.g90),
      profU: Float32Array.from(near.profU),
      profL: Float32Array.from(near.profL),
      area1: near.area,
      xCentroid: near.xCentroid,
      st,
      stCl,
      stGamma,
      meshNodes,
      cp,
      wake: p.wake,
    };
  });

  const lref = Math.max(
    ...foils.map((f) => f.b),
    ...foils.map((f) => Math.abs(f.x0) + 4 * f.cr),
    4 * foils[0].cr,
  );
  return {
    V,
    ...water,
    nStation: M,
    segs: Float32Array.from(all),
    nSeg,
    foils,
    lref,
  };
}
