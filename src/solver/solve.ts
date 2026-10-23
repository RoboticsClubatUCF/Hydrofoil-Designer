/**
 * Design solve: user inputs → everything that follows from them → sensible
 * assumptions where they unlock more → optimised choices for any remaining
 * freedom → checks against the user's requirements.
 *
 * With a secondary foil both foils are in one system. Once the load split is
 * fixed, each foil's free choices only change that foil, and the craft
 * objective (total drag, total mass, the higher take-off speed) is smallest
 * when each foil's own part is, so the foils are fitted one after the other.
 */
import { nelderMead } from '../physics/numeric';
import type { SectionModel, SectionPoint } from '../physics/profile/sectionModel';
import type { PlanformType } from '../physics/wing/planform';
import { SHALLOW_H_OVER_C, VENTILATION_H_OVER_C } from '../physics/hydro/freeSurface';
import { runEngine, findConflicts, type EngineResult } from './engine';
import { buildRelations, PROPERTY_RELATIONS } from './relations';
import { VAR, foilId, foilValues } from './variables';
import type {
  Conflict,
  Ctx,
  DesignInput,
  Derivation,
  Relation,
  RequirementCheck,
  Requirements,
  SolveResult,
  Vals,
} from './types';

const D2R = Math.PI / 180;

interface Assumption {
  id: string;
  /** a fixed value, or one taken from the values found so far */
  value: number | ((v: Vals) => number);
  note: string;
  /** lazy: only keep it if it unlocks another calculation */
  lazy: boolean;
  /** only made when the user entered this variable */
  needsInput?: string;
}

function assumptionsFor(twoFoils: boolean): Assumption[] {
  const list: Assumption[] = [
    {
      id: 'T',
      value: 20,
      lazy: true,
      note: 'Water temperature not given, so 20 °C is assumed. Type a temperature to change it.',
    },
    {
      id: 'patm',
      value: 101325,
      lazy: true,
      note: 'Standard sea-level atmospheric pressure is assumed.',
    },
    twoFoils
      ? {
          id: 'share',
          value: 0.8,
          lazy: true,
          note: 'Load share not given, so the main foil is assumed to carry 80 % of the weight and the secondary foil the other 20 %, as for a main foil with a rear stabiliser. Type the split for your layout.',
        }
      : {
          id: 'share',
          value: 1,
          lazy: true,
          note: 'Load share not given, so this foil is assumed to carry all of the weight.',
        },
    {
      id: 'kFS',
      value: 1,
      lazy: false,
      note: 'Foil depth not given, so the free surface is ignored (deep-water lift). Enter a depth to include it and to check cavitation.',
    },
  ];
  if (twoFoils)
    list.push(
      {
        id: 'h2',
        value: (v) => v.h,
        lazy: true,
        needsInput: 'h',
        note: 'Secondary foil depth not given, so it is assumed to run at the main foil’s depth. Type its own depth to change it.',
      },
      {
        id: 'kFS2',
        value: 1,
        lazy: false,
        note: 'Secondary foil depth not given, so the free surface is ignored for it (deep-water lift). Enter a depth to include it and to check cavitation.',
      },
      {
        id: 'Vto2',
        value: (v) => v.Vto,
        lazy: true,
        needsInput: 'Vto',
        note: 'You entered a take-off speed for the main foil, so the secondary foil is sized to lift off at the same speed. Type its own take-off speed to change it.',
      },
    );
  return list;
}

const DOF_ORDER = ['AR', 'alpha', 'lambda', 'b', 'cr'];

const relationCache = new Map<string, Relation[]>();
function relationsFor(input: DesignInput): Relation[] {
  const planform2 = input.foil2?.planform ?? null;
  const key = `${input.planform}|${planform2}|${input.salinity}`;
  let r = relationCache.get(key);
  if (!r) {
    r = buildRelations(input.planform, input.salinity, planform2);
    relationCache.set(key, r);
  }
  const userProps = new Set(Object.keys(input.values));
  return r.filter(
    (rel) => !(PROPERTY_RELATIONS[rel.id] && userProps.has(PROPERTY_RELATIONS[rel.id])),
  );
}

function deriv(
  varId: string,
  value: number,
  status: Derivation['status'],
  note: string,
  extra: Partial<Derivation> = {},
): Derivation {
  return { varId, value, status, note, inputs: [], order: 0, ...extra };
}

export interface SolveOptions {
  reHint?: number;
  /** Reynolds-number hint for the secondary foil */
  reHint2?: number;
  /** section of the secondary foil when it has its own profile */
  section2?: SectionModel | null;
  /** skip the optimiser (used in tests) */
  noOptimise?: boolean;
}

interface Foil {
  n: 1 | 2;
  /** variable id on this foil */
  id: (base: string) => string;
  ctx: Ctx;
  section: SectionModel | null;
  planform: PlanformType;
  /** Reynolds number estimate for the take-off section data (iterated like ctx.reEstimate) */
  reTo: number;
}

interface FoilFit {
  foil: Foil;
  dofs: string[];
  x: number[];
  bounds: [number, number, boolean][];
  iterations: number;
}

const NO_SECTION: SectionPoint = {
  alphaL0: 0,
  a0: 2 * Math.PI,
  clmax: 1,
  alphaStall: 0.17,
  cm0: 0,
};

export function solveDesign(
  input: DesignInput,
  section: SectionModel | null,
  opts: SolveOptions = {},
): SolveResult {
  const relations = relationsFor(input);
  const two = input.foil2 ?? null;
  const section2 = two ? (two.sameSection ? section : (opts.section2 ?? null)) : null;
  const makeCtx = (planform: PlanformType, sec: SectionModel | null, reHint?: number): Ctx => ({
    planform,
    section: sec as SectionModel,
    sec: sec ? sec.at(reHint ?? 5e5) : NO_SECTION,
    reEstimate: reHint ?? 5e5,
    salinity: input.salinity,
    material: input.material,
  });
  const ctx = makeCtx(input.planform, section, opts.reHint);
  const foils: Foil[] = [
    { n: 1, id: (b) => b, ctx, section, planform: input.planform, reTo: ctx.reEstimate },
  ];
  if (two) {
    const ctx2 = makeCtx(two.planform, section2, opts.reHint2 ?? opts.reHint);
    ctx.foil2 = ctx2;
    foils.push({
      n: 2,
      id: (b) => foilId(b, 2),
      ctx: ctx2,
      section: section2,
      planform: two.planform,
      reTo: ctx2.reEstimate,
    });
  }

  const userEntries = Object.entries(input.values).filter(
    ([k, v]) => VAR[k]?.input && Number.isFinite(v) && (two !== null || VAR[k].foil !== 2),
  );
  const entered = new Set(userEntries.map(([k]) => k));

  const sectionKnowns = (m: Map<string, Derivation>, f: Foil) => {
    const sec = f.section;
    if (!sec) return;
    const set = (base: string, value: number, note: string) =>
      m.set(f.id(base), deriv(f.id(base), value, 'section', note));
    const g = sec.geometry;
    const srcAt = (re: number) =>
      sec.mode === 'polar'
        ? `Interpolated from the pasted XFoil polars at Re = ${re.toExponential(2)}.`
        : `Estimated with the panel method and boundary-layer march at Re = ${re.toExponential(2)}.`;
    const src = srcAt(f.ctx.reEstimate);
    const geo =
      f.n === 1
        ? `Measured from the pasted profile “${g.name}”.`
        : two?.sameSection
          ? `Measured from the main foil’s profile “${g.name}”, which the secondary foil shares.`
          : `Measured from the secondary foil’s profile “${g.name}”.`;
    set('tc', g.tMax, `${geo} Maximum thickness at x/c = ${g.xTMax.toFixed(3)}.`);
    set('A1', g.area, `${geo} Polygon area of the closed outline at unit chord.`);
    set(
      'Z1',
      g.sectionModulus,
      `${geo} I₁ divided by the largest distance from the neutral axis (${g.zMax.toFixed(4)}c).`,
    );
    set(
      'I1',
      g.ixx,
      `${geo} Second moment of area about the horizontal axis through the centroid.`,
    );
    set('alphaL0', f.ctx.sec.alphaL0, src);
    set(
      'a0',
      f.ctx.sec.a0,
      sec.mode === 'estimate'
        ? `${src} Inviscid slope ${sec.inviscid.a0.toFixed(3)}/rad × viscous factor κ = ${sec.kappa}.`
        : src,
    );
    const sepNote = ' Taken where upper-surface turbulent separation reaches 92 % chord.';
    set('clmax', f.ctx.sec.clmax, sec.mode === 'estimate' ? src + sepNote : src);
    const srcTo = `${srcAt(f.reTo)} Read at the take-off Reynolds number.`;
    set('clmaxTo', sec.at(f.reTo).clmax, sec.mode === 'estimate' ? srcTo + sepNote : srcTo);
    set('cm0', f.ctx.sec.cm0, src);
  };

  const planformKnowns = (m: Map<string, Derivation>, f: Foil) => {
    const set = (base: string, value: number, note: string) =>
      m.set(f.id(base), deriv(f.id(base), value, 'constant', note));
    if (f.planform === 'rectangular') {
      set('lambda', 1, 'Rectangular planform: the tip chord equals the root chord.');
    } else if (f.planform === 'elliptical') {
      const note = 'Elliptical planform: the chord falls to zero at the tips.';
      set('lambda', 0, note);
      set('ct', 0, note);
      set('tTip', 0, note);
    }
  };

  const baseKnowns = (): Map<string, Derivation> => {
    const m = new Map<string, Derivation>();
    for (const [k, v] of userEntries) m.set(k, deriv(k, v, 'input', 'You entered this value.'));
    for (const f of foils) sectionKnowns(m, f);
    if (input.material) {
      const mat = input.material;
      for (const [id, val] of [
        ['E', mat.E],
        ['sy', mat.yieldStrength],
        ['rhoM', mat.density],
      ] as const) {
        if (!m.has(id))
          m.set(
            id,
            deriv(
              id,
              val,
              'material',
              `From the selected material: ${mat.name}.${mat.note ? ' ' + mat.note + '.' : ''}`,
            ),
          );
      }
    }
    for (const f of foils) planformKnowns(m, f);
    return m;
  };

  const solveWith = (extra: Map<string, Derivation>): EngineResult => {
    const k = baseKnowns();
    for (const [id, d] of extra) if (!k.has(id)) k.set(id, d);
    return runEngine(relations, k, ctx);
  };

  const setRe = (f: Foil, re: number) => {
    if (!f.section) return;
    f.ctx.reEstimate = re;
    f.ctx.sec = f.section.at(re);
  };

  let reIterations = 0;
  const iterateRe = (extra: Map<string, Derivation>): EngineResult => {
    let res = solveWith(extra);
    const valid = (x: number) => x > 0 && Number.isFinite(x);
    for (let i = 0; i < 12; i++) {
      let settled = true;
      const next: [Foil, number, number][] = [];
      for (const f of foils) {
        if (!f.section) continue;
        const Re = valid(res.values[f.id('Re')]) ? res.values[f.id('Re')] : f.ctx.reEstimate;
        // without a take-off Re, the take-off max lift follows the cruise estimate
        const ReTo = valid(res.values[f.id('ReTo')]) ? res.values[f.id('ReTo')] : Re;
        if (!(Math.abs(Re - f.ctx.reEstimate) / Re < 1e-3 && Math.abs(ReTo - f.reTo) / ReTo < 1e-3))
          settled = false;
        next.push([f, Re, ReTo]);
      }
      if (settled) break;
      for (const [f, Re, ReTo] of next) {
        setRe(f, Re);
        f.reTo = ReTo;
      }
      reIterations++;
      res = solveWith(extra);
    }
    return res;
  };

  const known = (r: EngineResult, id: string) =>
    r.values[id] !== undefined && (Number.isFinite(r.values[id]) || r.values[id] === Infinity);

  // ---- 1. user inputs
  const extra = new Map<string, Derivation>();
  let res = iterateRe(extra);

  // ---- 2. lazy assumptions
  for (const a of assumptionsFor(two !== null)) {
    if (known(res, a.id)) continue;
    if (userEntries.length === 0) break;
    if (a.needsInput && !entered.has(a.needsInput)) continue;
    const value = typeof a.value === 'function' ? a.value(res.values) : a.value;
    if (!Number.isFinite(value)) continue;
    const d = deriv(a.id, value, 'assumed', a.note);
    if (!a.lazy) {
      // free-surface factor: only when the foil has a section and no depth
      const f = VAR[a.id].foil === 2 ? foils[1] : foils[0];
      if (!f.section || known(res, f.id('h'))) continue;
      extra.set(a.id, d);
      continue;
    }
    const trialExtra = new Map(extra);
    trialExtra.set(a.id, d);
    const trial = solveWith(trialExtra);
    const before = new Set(Object.keys(res.values).filter((k) => known(res, k)));
    const gained = Object.keys(trial.values).filter(
      (k) => known(trial, k) && !before.has(k) && k !== a.id && VAR[k]?.group !== 'water',
    );
    if (gained.length > 0) {
      extra.set(a.id, d);
      res = trial;
    }
  }
  res = iterateRe(extra);

  // ---- 3. degrees of freedom & optimisation
  const missing: string[] = [];
  if (!section) missing.push('Section: paste a profile (.dat) to enable the hydrodynamics.');
  if (!known(res, 'L'))
    missing.push('Load: enter the craft mass or the lift this foil must carry.');
  if (!known(res, 'V') && !known(res, 'Vto'))
    missing.push('Speed: enter the cruise speed (and optionally a take-off speed).');
  if (two && section && !section2)
    missing.push(
      'Secondary foil: paste its section profile, or set it to use the same section as the main foil.',
    );

  const req = input.requirements;
  const canOptimise = known(res, 'V') && !opts.noOptimise;
  const fits: FoilFit[] = [];
  for (const f of foils) {
    const id = f.id;
    if (!(f.section && known(res, id('L')) && (known(res, 'V') || known(res, id('Vto'))))) continue;
    const typical = (dof: string): number => {
      const s = f.ctx.sec;
      switch (VAR[dof].base) {
        case 'AR':
          return Math.min(Math.max(6, req.arMin ?? 0), req.arMax ?? 99);
        case 'alpha':
          return s.alphaL0 + 0.55 / (0.85 * s.a0);
        case 'lambda':
          return 0.5;
        case 'b':
          return 1;
        case 'cr':
          return 0.15;
      }
      return VAR[dof].typical;
    };
    // Values off this foil stay as they are while it is fitted; passing them in
    // as knowns saves solving them again at every step.
    const fixed = new Map<string, Derivation>();
    for (const [k, d] of res.derivations) {
      const def = VAR[k];
      if (def && def.foil !== f.n && def.group !== 'craft' && known(res, k)) fixed.set(k, d);
    }
    for (const [k, d] of extra) fixed.set(k, d);

    let state = res;
    const dofExtra = new Map(fixed);
    const countKnown = (r: EngineResult) => Object.keys(r.values).filter((k) => known(r, k)).length;
    const dofs: string[] = [];
    // Candidates that only unlock results together (e.g. aspect ratio and taper) wait in `pending`.
    let pending: string[] = [];
    for (const base of DOF_ORDER) {
      if (base === 'lambda' && f.planform !== 'tapered') continue;
      const cand = id(base);
      if (known(state, cand)) continue;
      const group = [...pending, cand];
      const trialExtra = new Map(dofExtra);
      for (const g of group) trialExtra.set(g, deriv(g, typical(g), 'assumed', ''));
      const trial = solveWith(trialExtra);
      if (findConflicts(relations, trial.values, ctx).length > 0) continue;
      // a useful set of free choices must unlock something besides themselves
      if (countKnown(trial) <= countKnown(state) + group.length) {
        pending = group;
        continue;
      }
      for (const g of group) {
        dofs.push(g);
        dofExtra.set(g, trialExtra.get(g)!);
      }
      pending = [];
      state = trial;
      if (['S', 'b', 'cr', 'alpha', 'CL'].every((k) => known(state, id(k)))) break;
    }
    if (dofs.length === 0) continue;

    const bounds = (dof: string): [number, number, boolean] => {
      const s = f.ctx.sec;
      switch (VAR[dof].base) {
        case 'AR':
          return [req.arMin ?? 2, req.arMax ?? 15, false];
        case 'alpha':
          return [s.alphaL0 + 0.3 * D2R, s.alphaL0 + (1.1 * s.clmax) / s.a0, false];
        case 'lambda':
          return [0.15, 1, false];
        case 'b':
          return [0.05, req.spanMax ?? 20, true];
        case 'cr':
          return [req.rootChordMin ?? 0.01, req.rootChordMax ?? 2, true];
      }
      return [VAR[dof].range[0], VAR[dof].range[1], VAR[dof].positive];
    };
    const B = dofs.map(bounds);
    const toX = (u: number[]) =>
      u.map((t, i) => {
        const [lo, hi, log] = B[i];
        const s = 1 / (1 + Math.exp(-t));
        return log
          ? Math.exp(Math.log(lo) + s * (Math.log(hi) - Math.log(lo)))
          : lo + s * (hi - lo);
      });
    const toU = (x: number[]) =>
      x.map((t, i) => {
        const [lo, hi, log] = B[i];
        let s = log
          ? (Math.log(t) - Math.log(lo)) / (Math.log(hi) - Math.log(lo))
          : (t - lo) / (hi - lo);
        s = Math.min(0.98, Math.max(0.02, s));
        return Math.log(s / (1 - s));
      });
    const objectiveOf = (v: Vals): number => {
      switch (input.objective) {
        case 'minDrag':
          return v[id('D')];
        case 'minTakeoff':
          return v[id('Vto')];
        case 'minMass':
          return v[id('massFoil')];
      }
    };
    const evalAt = (x: number[]) => {
      const e = new Map(fixed);
      dofs.forEach((d, i) => e.set(d, deriv(d, x[i], 'optimised', '')));
      return solveWith(e);
    };
    let x0 = dofs.map(typical);
    const r0 = evalAt(x0);
    let scale = objectiveOf(r0.values);
    if (!(scale > 0) || !Number.isFinite(scale)) scale = 1;
    const cost = (u: number[]) => {
      const r = evalAt(toX(u));
      const obj = objectiveOf(r.values);
      const pen = penalty(foilValues(r.values, f.n), req);
      if (!Number.isFinite(obj) || !(obj > 0)) return 1e6 + pen * 1e3;
      return obj / scale + 1e3 * pen;
    };
    let iterations = 0;
    if (canOptimise) {
      let best = nelderMead(cost, toU(x0), { step: 0.8, maxIter: 120 * dofs.length });
      iterations += best.iterations;
      // second start from the middle of the box
      const alt = nelderMead(
        cost,
        dofs.map(() => 0),
        { step: 0.8, maxIter: 120 * dofs.length },
      );
      iterations += alt.iterations;
      if (alt.f < best.f) best = alt;
      x0 = toX(best.x);
      // refine once the Reynolds number has settled
      const prelim = iterateRe(
        new Map([...fixed, ...dofs.map((d, i) => [d, deriv(d, x0[i], 'optimised', '')] as const)]),
      );
      if (prelim.values[id('Re')] > 0) {
        const ref = nelderMead(cost, toU(x0), { step: 0.2, maxIter: 60 * dofs.length });
        iterations += ref.iterations;
        if (ref.f <= cost(toU(x0))) x0 = toX(ref.x);
      }
    }
    // final assignment
    dofs.forEach((d, i) =>
      extra.set(
        d,
        deriv(d, x0[i], canOptimise ? 'optimised' : 'assumed', '', {
          method: canOptimise
            ? `Nelder–Mead search over ${dofs.map((x) => VAR[x].label.toLowerCase()).join(', ')} (${iterations} iterations), within ${fmtBounds(d, B[dofs.indexOf(d)])}.`
            : undefined,
        }),
      ),
    );
    res = iterateRe(extra);
    fits.push({ foil: f, dofs, x: x0, bounds: B, iterations });
  }

  let optimisation: SolveResult['optimisation'] = null;
  if (fits.length > 0) {
    const objLabel = {
      minDrag: 'minimum drag at cruise',
      minTakeoff: 'lowest take-off speed',
      minMass: 'lightest foil',
    }[input.objective];
    for (const fit of fits) {
      const checks = requirementChecks(foilValues(res.values, fit.foil.n), req);
      const active = checks.filter((c) => c.active).map((c) => c.label);
      const atBound = fit.dofs.filter((_, i) => {
        const [lo, hi] = fit.bounds[i];
        return (
          Math.abs(fit.x[i] - lo) / Math.abs(hi - lo) < 0.01 ||
          Math.abs(fit.x[i] - hi) / Math.abs(hi - lo) < 0.01
        );
      });
      const boundTxt = atBound.map(
        (d) => `${VAR[d].label.toLowerCase()} at the edge of its allowed range`,
      );
      for (const d of fit.dofs) {
        const dv = res.derivations.get(d);
        if (!dv) continue;
        dv.note = canOptimise
          ? `Not specified, so the optimiser chose it for ${objLabel}. ${
              active.length || boundTxt.length
                ? `Limits shaping this choice: ${[...active, ...boundTxt].join('; ')}.`
                : 'No requirement is limiting this choice.'
            } Type a value to fix it yourself.`
          : 'Not specified, so a typical value is used. Enter a cruise speed to let the optimiser choose it, or type your own value.';
      }
    }
    const violated = designChecks(res.values, req, two !== null).filter((c) => c.ok === false);
    const craftObjective = {
      minDrag: two ? 'Dtot' : 'D',
      minTakeoff: two ? 'VtoCraft' : 'Vto',
      minMass: two ? 'massTot' : 'massFoil',
    }[input.objective];
    optimisation = {
      ran: canOptimise,
      dofs: fits.flatMap((x) => x.dofs),
      objective: input.objective,
      objectiveValue: canOptimise ? (res.values[craftObjective] ?? null) : null,
      iterations: fits.reduce((s, x) => s + x.iterations, 0),
      message: !canOptimise
        ? 'Typical values used for the free choices (no cruise speed to optimise against).'
        : violated.length
          ? `Could not meet every requirement — closest design shown. Not met: ${violated.map((c) => c.label).join('; ')}.`
          : `Optimised for ${objLabel}; all requirements met.`,
    };
  }

  // ---- 4. assemble
  const values = res.values;
  const derivations: Record<string, Derivation> = {};
  for (const [k, d] of res.derivations) derivations[k] = d;
  const conflicts: Conflict[] = findConflicts(relations, values, ctx).map(({ relation }) => {
    const vars = traceInputs(relation.vars, derivations);
    return {
      relationId: relation.id,
      title: relation.title,
      vars,
      message: `“${relation.title}” can’t be satisfied by the values entered for ${vars.map((v) => VAR[v]?.label ?? v).join(', ')}. Clear one of them.`,
    };
  });
  for (const c of conflicts)
    for (const v of c.vars)
      if (derivations[v]) derivations[v] = { ...derivations[v], status: 'conflict' };
  const warnings = buildWarnings(values, foils, res, two?.sameSection ?? false);
  return {
    values,
    derivations,
    conflicts,
    requirements: designChecks(values, input.requirements, two !== null),
    optimisation,
    missing,
    reIterations,
    warnings,
  };
}

function fmtBounds(id: string, [lo, hi]: [number, number, boolean]): string {
  const q = VAR[id].quantity;
  const f = (v: number) =>
    q === 'angle'
      ? `${(v / D2R).toFixed(1)}°`
      : q === 'length'
        ? `${v.toPrecision(3)} m`
        : v.toPrecision(3);
  return `${f(lo)} – ${f(hi)}`;
}

function traceInputs(start: string[], d: Record<string, Derivation>): string[] {
  const out = new Set<string>();
  const seen = new Set<string>();
  const stack = [...start];
  while (stack.length) {
    const v = stack.pop()!;
    if (seen.has(v)) continue;
    seen.add(v);
    const dv = d[v];
    if (!dv) continue;
    if (dv.status === 'input') out.add(v);
    else stack.push(...dv.inputs);
  }
  return [...out];
}

const has = (v: Vals, k: string) => v[k] !== undefined && Number.isFinite(v[k]);

/** Sum of squared normalised requirement violations. */
export function penalty(v: Vals, req: Requirements): number {
  let p = 0;
  const add = (x: number) => {
    if (x > 0) p += x * x;
  };
  if (req.spanMax !== null && has(v, 'b')) add(v.b / req.spanMax - 1);
  if (req.rootChordMax !== null && has(v, 'cr')) add(v.cr / req.rootChordMax - 1);
  if (req.rootChordMin !== null && has(v, 'cr')) add(1 - v.cr / req.rootChordMin);
  if (req.thicknessMin !== null && has(v, 'tRoot')) add(1 - v.tRoot / req.thicknessMin);
  if (req.sfMin !== null && has(v, 'SF')) add(1 - v.SF / req.sfMin);
  if (req.takeoffMax !== null && has(v, 'Vto')) add(v.Vto / req.takeoffMax - 1);
  if (req.stallMarginMin !== null && has(v, 'stallMargin'))
    add((req.stallMarginMin - v.stallMargin) / (3 * D2R));
  if (req.noCavitation && has(v, 'cavMargin'))
    add(-v.cavMargin / Math.max(0.2, Math.abs(v.sigma ?? 1)));
  if (req.arMax !== null && has(v, 'AR')) add(v.AR / req.arMax - 1);
  if (req.arMin !== null && has(v, 'AR')) add(1 - v.AR / req.arMin);
  if (req.deflectionMax !== null && has(v, 'deflRatio')) add(v.deflRatio / req.deflectionMax - 1);
  if (has(v, 'CL') && v.CL <= 0) add(1 - v.CL);
  return p;
}

/** Requirement checks for one foil, using main-foil variable ids. */
export function requirementChecks(v: Vals, req: Requirements): RequirementCheck[] {
  const out: RequirementCheck[] = [];
  const push = (
    id: keyof Requirements,
    label: string,
    varId: string,
    kind: 'min' | 'max',
    limit: number | null,
  ) => {
    if (limit === null) return;
    const actual = has(v, varId) ? v[varId] : null;
    let ok: boolean | null = null;
    let active = false;
    if (actual !== null) {
      const rel = kind === 'max' ? actual / limit - 1 : 1 - actual / limit;
      const relAngle =
        kind === 'min' && varId === 'stallMargin' ? (limit - actual) / (1 * D2R) : rel;
      ok = relAngle <= 1e-3;
      active = relAngle > -0.02;
    }
    out.push({ id, label, varId, kind, limit, actual, ok, active, foil: 1 });
  };
  push('spanMax', 'Span ≤ limit', 'b', 'max', req.spanMax);
  push('rootChordMax', 'Root chord ≤ limit', 'cr', 'max', req.rootChordMax);
  push('rootChordMin', 'Root chord ≥ limit', 'cr', 'min', req.rootChordMin);
  push('thicknessMin', 'Root thickness ≥ limit', 'tRoot', 'min', req.thicknessMin);
  push('sfMin', 'Safety factor ≥ limit', 'SF', 'min', req.sfMin);
  push('takeoffMax', 'Take-off speed ≤ limit', 'Vto', 'max', req.takeoffMax);
  push('stallMarginMin', 'Stall margin ≥ limit', 'stallMargin', 'min', req.stallMarginMin);
  push('arMin', 'Aspect ratio ≥ limit', 'AR', 'min', req.arMin);
  push('arMax', 'Aspect ratio ≤ limit', 'AR', 'max', req.arMax);
  push('deflectionMax', 'Tip deflection ≤ limit', 'deflRatio', 'max', req.deflectionMax);
  if (req.noCavitation) {
    const actual = has(v, 'cavMargin') ? v.cavMargin : null;
    out.push({
      id: 'noCavitation',
      label: 'No cavitation at cruise',
      varId: 'cavMargin',
      kind: 'nonneg',
      limit: 0,
      actual,
      ok: actual === null ? null : actual >= -1e-6,
      active: actual !== null && actual < 0.05 * Math.max(1, Math.abs(v.sigma ?? 1)),
      foil: 1,
    });
  }
  return out;
}

/** Requirement checks for the design: every requirement applies to each foil. */
export function designChecks(v: Vals, req: Requirements, twoFoils: boolean): RequirementCheck[] {
  const main = requirementChecks(v, req);
  if (!twoFoils) return main;
  const second = requirementChecks(foilValues(v, 2), req).map((c) => ({
    ...c,
    label: `${c.label} (secondary)`,
    varId: foilId(c.varId, 2),
    foil: 2 as const,
  }));
  return [...main, ...second];
}

function buildWarnings(v: Vals, foils: Foil[], res: EngineResult, sameSection: boolean): string[] {
  const w: string[] = [];
  for (const f of res.failed) {
    w.push(
      `Couldn’t calculate ${f.vars.map((x) => VAR[x]?.label.toLowerCase() ?? x).join(', ')}: ${f.reason}.`,
    );
  }
  for (const f of foils) {
    const prefix = f.n === 2 ? 'Secondary foil: ' : '';
    const own = foilWarnings(foilValues(v, f.n), f.section, f.n === 2 && sameSection);
    for (const t of own) w.push(prefix + t);
  }
  return w;
}

function foilWarnings(v: Vals, section: SectionModel | null, sameSection: boolean): string[] {
  const w: string[] = [];
  if (has(v, 'Re')) {
    if (v.Re < 1e5)
      w.push(
        `Reynolds number is very low (${v.Re.toExponential(1)}): laminar separation is likely and drag/max-lift predictions are rough.`,
      );
    else if (v.Re < 2e5)
      w.push(
        `Reynolds number is low (${v.Re.toExponential(1)}): expect laminar separation bubbles; drag may be higher than predicted.`,
      );
    if (section?.reRange && (v.Re < section.reRange[0] * 0.95 || v.Re > section.reRange[1] * 1.05))
      w.push(
        `Reynolds number ${v.Re.toExponential(2)} is outside the pasted polars (${section.reRange[0].toExponential(1)}–${section.reRange[1].toExponential(1)}); values are extrapolated. Paste a polar closer to this Re.`,
      );
  }
  if (has(v, 'AR') && v.AR < 3)
    w.push(
      'Aspect ratio below 3: lifting-line theory overestimates lift slope for such stubby foils.',
    );
  if (has(v, 'hc')) {
    if (v.hc < VENTILATION_H_OVER_C)
      w.push(
        'Foil is within half a chord of the surface: high risk of ventilation (air drawn down onto the foil) and large lift loss.',
      );
    else if (v.hc < SHALLOW_H_OVER_C)
      w.push(
        'Foil is within one chord of the surface: free-surface lift loss is included but the estimate is approximate.',
      );
  }
  if (has(v, 'stallMargin') && v.stallMargin < 0)
    w.push(
      'Cruise angle is beyond the estimated stall angle — the foil cannot carry this load at this speed.',
    );
  if (has(v, 'cavMargin') && v.cavMargin < 0)
    w.push('Cavitation is predicted at cruise: the suction peak drops below vapour pressure.');
  if (has(v, 'SF') && v.SF < 1)
    w.push('Peak bending stress exceeds the material strength (safety factor below 1).');
  if (has(v, 'deflRatio') && v.deflRatio > 0.05)
    w.push(
      'Tip deflection exceeds 5 % of the semi-span — the foil is very flexible; consider a stiffer material or larger chord.',
    );
  if (has(v, 'CL') && v.CL < 0)
    w.push('Negative lift coefficient: check the load and speed inputs.');
  if (section?.mode === 'estimate' && !sameSection)
    w.push(
      'Section data is estimated (no polar pasted). Paste airfoiltools.com polars for more accurate drag and max lift.',
    );
  return w;
}
