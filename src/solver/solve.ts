/**
 * Design solve: user inputs → everything that follows from them → sensible
 * assumptions where they unlock more → optimised choices for any remaining
 * freedom → checks against the user's requirements.
 */
import { nelderMead } from '../physics/numeric';
import type { SectionModel } from '../physics/profile/sectionModel';
import { SHALLOW_H_OVER_C, VENTILATION_H_OVER_C } from '../physics/hydro/freeSurface';
import { runEngine, findConflicts, type EngineResult } from './engine';
import { buildRelations, PROPERTY_RELATIONS } from './relations';
import { VAR } from './variables';
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
  value: number;
  note: string;
  /** lazy: only keep it if it unlocks another calculation */
  lazy: boolean;
}

const ASSUMPTIONS: Assumption[] = [
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
  {
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

const DOF_ORDER = ['AR', 'alpha', 'lambda', 'b', 'cr'];

const relationCache = new Map<string, Relation[]>();
function relationsFor(input: DesignInput): Relation[] {
  const key = `${input.planform}|${input.salinity}`;
  let r = relationCache.get(key);
  if (!r) {
    r = buildRelations(input.planform, input.salinity);
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
  /** skip the optimiser (used in tests) */
  noOptimise?: boolean;
}

export function solveDesign(
  input: DesignInput,
  section: SectionModel | null,
  opts: SolveOptions = {},
): SolveResult {
  const relations = relationsFor(input);
  const ctx: Ctx = {
    planform: input.planform,
    section: section as SectionModel,
    sec: section
      ? section.at(opts.reHint ?? 5e5)
      : { alphaL0: 0, a0: 2 * Math.PI, clmax: 1, alphaStall: 0.17, cm0: 0 },
    reEstimate: opts.reHint ?? 5e5,
    salinity: input.salinity,
    material: input.material,
  };

  const userEntries = Object.entries(input.values).filter(
    ([k, v]) => VAR[k]?.input && Number.isFinite(v),
  );
  const baseKnowns = (): Map<string, Derivation> => {
    const m = new Map<string, Derivation>();
    for (const [k, v] of userEntries) m.set(k, deriv(k, v, 'input', 'You entered this value.'));
    if (section) {
      const g = section.geometry;
      const src =
        section.mode === 'polar'
          ? `Interpolated from the pasted XFoil polars at Re = ${ctx.reEstimate.toExponential(2)}.`
          : `Estimated with the panel method and boundary-layer march at Re = ${ctx.reEstimate.toExponential(2)}.`;
      const geo = `Measured from the pasted profile “${g.name}”.`;
      m.set(
        'tc',
        deriv('tc', g.tMax, 'section', `${geo} Maximum thickness at x/c = ${g.xTMax.toFixed(3)}.`),
      );
      m.set(
        'A1',
        deriv('A1', g.area, 'section', `${geo} Polygon area of the closed outline at unit chord.`),
      );
      m.set(
        'Z1',
        deriv(
          'Z1',
          g.sectionModulus,
          'section',
          `${geo} I₁ divided by the largest distance from the neutral axis (${g.zMax.toFixed(4)}c).`,
        ),
      );
      m.set(
        'I1',
        deriv(
          'I1',
          g.ixx,
          'section',
          `${geo} Second moment of area about the horizontal axis through the centroid.`,
        ),
      );
      m.set('alphaL0', deriv('alphaL0', ctx.sec.alphaL0, 'section', src));
      m.set(
        'a0',
        deriv(
          'a0',
          ctx.sec.a0,
          'section',
          section.mode === 'estimate'
            ? `${src} Inviscid slope ${section.inviscid.a0.toFixed(3)}/rad × viscous factor κ = ${section.kappa}.`
            : src,
        ),
      );
      m.set(
        'clmax',
        deriv(
          'clmax',
          ctx.sec.clmax,
          'section',
          section.mode === 'estimate'
            ? `${src} Taken where upper-surface turbulent separation reaches 92 % chord.`
            : src,
        ),
      );
      m.set('cm0', deriv('cm0', ctx.sec.cm0, 'section', src));
    }
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
    if (input.planform === 'rectangular') {
      m.set(
        'lambda',
        deriv(
          'lambda',
          1,
          'constant',
          'Rectangular planform: the tip chord equals the root chord.',
        ),
      );
    } else if (input.planform === 'elliptical') {
      m.set(
        'lambda',
        deriv('lambda', 0, 'constant', 'Elliptical planform: the chord falls to zero at the tips.'),
      );
      m.set(
        'ct',
        deriv('ct', 0, 'constant', 'Elliptical planform: the chord falls to zero at the tips.'),
      );
      m.set(
        'tTip',
        deriv('tTip', 0, 'constant', 'Elliptical planform: the chord falls to zero at the tips.'),
      );
    }
    return m;
  };

  const solveWith = (extra: Map<string, Derivation>): EngineResult => {
    const k = baseKnowns();
    for (const [id, d] of extra) if (!k.has(id)) k.set(id, d);
    return runEngine(relations, k, ctx);
  };

  const setRe = (re: number) => {
    if (!section) return;
    ctx.reEstimate = re;
    ctx.sec = section.at(re);
  };

  let reIterations = 0;
  const iterateRe = (extra: Map<string, Derivation>): EngineResult => {
    let res = solveWith(extra);
    if (!section) return res;
    for (let i = 0; i < 12; i++) {
      const Re = res.values.Re;
      if (!(Re > 0) || !Number.isFinite(Re)) break;
      if (Math.abs(Re - ctx.reEstimate) / Re < 1e-3) break;
      setRe(Re);
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
  for (const a of ASSUMPTIONS) {
    if (known(res, a.id)) continue;
    if (userEntries.length === 0) break;
    const trialExtra = new Map(extra);
    trialExtra.set(a.id, deriv(a.id, a.value, 'assumed', a.note));
    if (!a.lazy) {
      if (a.id === 'kFS' && (!section || known(res, 'h'))) continue;
      extra.set(a.id, trialExtra.get(a.id)!);
      continue;
    }
    const trial = solveWith(trialExtra);
    const before = new Set(Object.keys(res.values).filter((k) => known(res, k)));
    const gained = Object.keys(trial.values).filter(
      (k) => known(trial, k) && !before.has(k) && k !== a.id && VAR[k]?.group !== 'water',
    );
    if (gained.length > 0) {
      extra.set(a.id, trialExtra.get(a.id)!);
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

  let optimisation: SolveResult['optimisation'] = null;
  const canSize = section && known(res, 'L') && (known(res, 'V') || known(res, 'Vto'));
  const dofs: string[] = [];
  if (canSize) {
    const typical = (id: string): number => {
      const req = input.requirements;
      switch (id) {
        case 'AR':
          return Math.min(Math.max(6, req.arMin ?? 0), req.arMax ?? 99);
        case 'alpha':
          return ctx.sec.alphaL0 + 0.55 / (0.85 * ctx.sec.a0);
        case 'lambda':
          return 0.5;
        case 'b':
          return 1;
        case 'cr':
          return 0.15;
      }
      return VAR[id].typical;
    };
    let state = res;
    const dofExtra = new Map(extra);
    const countKnown = (r: EngineResult) => Object.keys(r.values).filter((k) => known(r, k)).length;
    // Candidates that only unlock results together (e.g. aspect ratio and taper) wait in `pending`.
    let pending: string[] = [];
    for (const cand of DOF_ORDER) {
      if (cand === 'lambda' && input.planform !== 'tapered') continue;
      if (known(state, cand)) continue;
      const group = [...pending, cand];
      const trialExtra = new Map(dofExtra);
      for (const id of group) trialExtra.set(id, deriv(id, typical(id), 'assumed', ''));
      const trial = solveWith(trialExtra);
      if (findConflicts(relations, trial.values, ctx).length > 0) continue;
      // a useful set of free choices must unlock something besides themselves
      if (countKnown(trial) <= countKnown(state) + group.length) {
        pending = group;
        continue;
      }
      for (const id of group) {
        dofs.push(id);
        dofExtra.set(id, trialExtra.get(id)!);
      }
      pending = [];
      state = trial;
      if (['S', 'b', 'cr', 'alpha', 'CL'].every((k) => known(state, k))) break;
    }

    if (dofs.length > 0) {
      const canOptimise = known(res, 'V') && !opts.noOptimise;
      const req = input.requirements;
      const bounds = (id: string): [number, number, boolean] => {
        switch (id) {
          case 'AR':
            return [req.arMin ?? 2, req.arMax ?? 15, false];
          case 'alpha':
            return [
              ctx.sec.alphaL0 + 0.3 * D2R,
              ctx.sec.alphaL0 + (1.1 * ctx.sec.clmax) / ctx.sec.a0,
              false,
            ];
          case 'lambda':
            return [0.15, 1, false];
          case 'b':
            return [0.05, req.spanMax ?? 20, true];
          case 'cr':
            return [req.rootChordMin ?? 0.01, req.rootChordMax ?? 2, true];
        }
        return [VAR[id].range[0], VAR[id].range[1], VAR[id].positive];
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
            return v.D;
          case 'minTakeoff':
            return v.Vto;
          case 'minMass':
            return v.massFoil;
        }
      };
      const evalAt = (x: number[]) => {
        const e = new Map(extra);
        dofs.forEach((id, i) => e.set(id, deriv(id, x[i], 'optimised', '')));
        return solveWith(e);
      };
      let x0 = dofs.map(typical);
      const r0 = evalAt(x0);
      let scale = objectiveOf(r0.values);
      if (!(scale > 0) || !Number.isFinite(scale)) scale = 1;
      const cost = (u: number[]) => {
        const r = evalAt(toX(u));
        const obj = objectiveOf(r.values);
        const pen = penalty(r.values, req);
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
          new Map([
            ...extra,
            ...dofs.map((id, i) => [id, deriv(id, x0[i], 'optimised', '')] as const),
          ]),
        );
        if (prelim.values.Re > 0) {
          const ref = nelderMead(cost, toU(x0), { step: 0.2, maxIter: 60 * dofs.length });
          iterations += ref.iterations;
          if (ref.f <= cost(toU(x0))) x0 = toX(ref.x);
        }
      }
      // final assignment
      const finalExtra = new Map(extra);
      const objLabel = {
        minDrag: 'minimum drag at cruise',
        minTakeoff: 'lowest take-off speed',
        minMass: 'lightest foil',
      }[input.objective];
      dofs.forEach((id, i) =>
        finalExtra.set(
          id,
          deriv(id, x0[i], canOptimise ? 'optimised' : 'assumed', '', {
            method: canOptimise
              ? `Nelder–Mead search over ${dofs.map((d) => VAR[d].label.toLowerCase()).join(', ')} (${iterations} iterations), within ${fmtBounds(id, bounds(id))}.`
              : undefined,
          }),
        ),
      );
      res = iterateRe(finalExtra);
      const checks = requirementChecks(res.values, req);
      const active = checks.filter((c) => c.active).map((c) => c.label);
      const atBound = dofs.filter((id, i) => {
        const [lo, hi] = bounds(id);
        return (
          Math.abs(x0[i] - lo) / Math.abs(hi - lo) < 0.01 ||
          Math.abs(x0[i] - hi) / Math.abs(hi - lo) < 0.01
        );
      });
      const boundTxt = atBound.map(
        (id) => `${VAR[id].label.toLowerCase()} at the edge of its allowed range`,
      );
      for (const id of dofs) {
        const d = res.derivations.get(id);
        if (!d) continue;
        d.note = canOptimise
          ? `Not specified, so the optimiser chose it for ${objLabel}. ${
              active.length || boundTxt.length
                ? `Limits shaping this choice: ${[...active, ...boundTxt].join('; ')}.`
                : 'No requirement is limiting this choice.'
            } Type a value to fix it yourself.`
          : 'Not specified, so a typical value is used. Enter a cruise speed to let the optimiser choose it, or type your own value.';
      }
      const violated = checks.filter((c) => c.ok === false);
      optimisation = {
        ran: canOptimise,
        dofs,
        objective: input.objective,
        objectiveValue: canOptimise ? (objectiveOf(res.values) ?? null) : null,
        iterations,
        message: !canOptimise
          ? 'Typical values used for the free choices (no cruise speed to optimise against).'
          : violated.length
            ? `Could not meet every requirement — closest design shown. Not met: ${violated.map((c) => c.label).join('; ')}.`
            : `Optimised for ${objLabel}; all requirements met.`,
      };
    }
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
  const warnings = buildWarnings(values, section, res, input);
  return {
    values,
    derivations,
    conflicts,
    requirements: requirementChecks(values, input.requirements),
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
    out.push({ id, label, varId, kind, limit, actual, ok, active });
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
    });
  }
  return out;
}

function buildWarnings(
  v: Vals,
  section: SectionModel | null,
  res: EngineResult,
  input: DesignInput,
): string[] {
  const w: string[] = [];
  for (const f of res.failed) {
    w.push(
      `Couldn’t calculate ${f.vars.map((x) => VAR[x]?.label.toLowerCase() ?? x).join(', ')}: ${f.reason}.`,
    );
  }
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
  if (section?.mode === 'estimate')
    w.push(
      'Section data is estimated (no polar pasted). Paste airfoiltools.com polars for more accurate drag and max lift.',
    );
  if (input.planform === 'elliptical' && has(v, 'massFoil')) {
    // nothing extra; elliptical tips are handled in the structure model
  }
  return w;
}
