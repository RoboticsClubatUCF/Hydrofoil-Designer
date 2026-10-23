/**
 * Equation-system engine.
 *
 * Given the currently known values, it finds every variable the relations
 * determine and solves them in dependency order:
 *
 *  1. Bipartite matching between relations and the unknowns they can be solved for.
 *  2. Unknowns reachable by alternating paths from an unmatched (free) unknown are
 *     under-determined and left blank (Dulmage–Mendelsohn decomposition).
 *  3. The rest are grouped into strongly connected blocks (Tarjan) and solved in
 *     topological order: one-equation blocks by closed form or Brent's method,
 *     larger blocks simultaneously by damped Newton (Levenberg–Marquardt).
 *
 * Every solved value gets a Derivation describing exactly how it was obtained.
 */
import { findRoot, solveLinear } from '../physics/numeric';
import { renderTemplate, texSymbol, texValue } from './latex';
import { VAR } from './variables';
import type { Ctx, Derivation, Relation, Vals } from './types';

export interface EngineResult {
  values: Vals;
  derivations: Map<string, Derivation>;
  /** variables the structure says are determined but whose solve failed */
  failed: { vars: string[]; reason: string }[];
}

export function runEngine(
  relations: Relation[],
  known: Map<string, Derivation>,
  ctx: Ctx,
): EngineResult {
  const derivations = new Map(known);
  const values: Vals = {};
  for (const [k, d] of known) values[k] = d.value;
  let order = derivations.size;
  const failed: EngineResult['failed'] = [];

  const isKnown = (v: string) => {
    const x = values[v];
    return x !== undefined && (Number.isFinite(x) || x === Infinity);
  };

  // ---- active relations and unknowns
  let active = relations.filter((r) => r.vars.some((v) => !isKnown(v)));
  // A relation can only be used if every unknown it cannot be solved for can be
  // solved by some other usable relation (e.g. the free-surface factor needs a depth).
  for (;;) {
    const solvableSomewhere = new Set<string>();
    for (const r of active)
      for (const v of r.vars) if (!isKnown(v) && r.solveFor[v]) solvableSomewhere.add(v);
    const next = active.filter((r) =>
      r.vars.every((v) => isKnown(v) || r.solveFor[v] || solvableSomewhere.has(v)),
    );
    if (next.length === active.length) break;
    active = next;
  }
  const unknownSet = new Set<string>();
  for (const r of active) for (const v of r.vars) if (!isKnown(v)) unknownSet.add(v);
  const unknowns = [...unknownSet];

  // ---- maximum matching (relation → var) on solvable edges
  const matchR = new Map<number, string>();
  const matchV = new Map<string, number>();
  const solvable = (ri: number) =>
    active[ri].vars.filter((v) => !isKnown(v) && active[ri].solveFor[v]);
  const tryAugment = (ri: number, seen: Set<string>): boolean => {
    for (const v of solvable(ri)) {
      if (seen.has(v)) continue;
      seen.add(v);
      const other = matchV.get(v);
      if (other === undefined || tryAugment(other, seen)) {
        matchR.set(ri, v);
        matchV.set(v, ri);
        return true;
      }
    }
    return false;
  };
  for (let ri = 0; ri < active.length; ri++) tryAugment(ri, new Set());

  // ---- under-determined part: alternating BFS from unmatched unknowns
  const relsOfVar = new Map<string, number[]>();
  active.forEach((r, ri) => {
    for (const v of r.vars)
      if (unknownSet.has(v)) (relsOfVar.get(v) ?? relsOfVar.set(v, []).get(v)!).push(ri);
  });
  const underVar = new Set<string>();
  const underRel = new Set<number>();
  const queue = unknowns.filter((v) => !matchV.has(v));
  for (const v of queue) underVar.add(v);
  while (queue.length) {
    const v = queue.shift()!;
    for (const ri of relsOfVar.get(v) ?? []) {
      if (underRel.has(ri)) continue;
      underRel.add(ri);
      const mv = matchR.get(ri);
      if (mv && !underVar.has(mv)) {
        underVar.add(mv);
        queue.push(mv);
      }
    }
  }

  // ---- determined, matched relations → dependency graph → SCCs
  const det = [...matchR.keys()].filter((ri) => !underRel.has(ri));
  const detSet = new Set(det);
  const deps = new Map<number, number[]>();
  for (const ri of det) {
    const own = matchR.get(ri)!;
    const d: number[] = [];
    for (const v of active[ri].vars) {
      if (v === own || !unknownSet.has(v)) continue;
      const rj = matchV.get(v);
      if (rj !== undefined && detSet.has(rj)) d.push(rj);
    }
    deps.set(ri, d);
  }
  const sccs = tarjan(det, deps);

  for (const comp of sccs) {
    const rels = comp.map((ri) => active[ri]);
    const vars = comp.map((ri) => matchR.get(ri)!);
    // every other variable these relations use must be known by now
    const missing = new Set<string>();
    for (const r of rels)
      for (const v of r.vars) if (!vars.includes(v) && !isKnown(v)) missing.add(v);
    if (missing.size) {
      failed.push({
        vars,
        reason: `needs ${[...missing].map((m) => VAR[m]?.label ?? m).join(', ')}`,
      });
      continue;
    }
    const res =
      comp.length === 1
        ? solveSingle(rels[0], vars[0], values, ctx)
        : solveBlock(rels, vars, values, ctx);
    if (!res.ok) {
      failed.push({ vars, reason: res.reason });
      continue;
    }
    for (const d of res.derivations) {
      values[d.varId] = d.value;
      derivations.set(d.varId, { ...d, order: order++ });
    }
  }
  return { values, derivations, failed };
}

/** Tarjan's SCC; with edges "depends on", components come out in solve order. */
function tarjan(nodes: number[], deps: Map<number, number[]>): number[][] {
  let index = 0;
  const idx = new Map<number, number>();
  const low = new Map<number, number>();
  const onStack = new Set<number>();
  const stack: number[] = [];
  const out: number[][] = [];
  const strong = (v: number) => {
    idx.set(v, index);
    low.set(v, index);
    index++;
    stack.push(v);
    onStack.add(v);
    for (const w of deps.get(v) ?? []) {
      if (!idx.has(w)) {
        strong(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
    }
    if (low.get(v) === idx.get(v)) {
      const comp: number[] = [];
      let w: number;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      out.push(comp);
    }
  };
  for (const n of nodes) if (!idx.has(n)) strong(n);
  return out;
}

type SolveOutcome = { ok: true; derivations: Derivation[] } | { ok: false; reason: string };

function inRange(id: string, x: number): string | null {
  const def = VAR[id];
  if (!Number.isFinite(x) && x !== Infinity) return 'no valid solution';
  if (def?.positive && !(x > 0))
    return `${def.label.toLowerCase()} would have to be ${x === 0 ? 'zero' : 'negative'}`;
  return null;
}

function solveSingle(r: Relation, v: string, values: Vals, ctx: Ctx): SolveOutcome {
  const spec = r.solveFor[v];
  const inputs = r.vars.filter((x) => x !== v);
  const sym = texSymbol(v);
  let x: number;
  let method: string;
  let formula: string;
  let substitution: string;
  if (spec.calc) {
    x = spec.calc(values, ctx);
    method = 'Closed form';
    formula = `${sym} = ${renderTemplate(spec.rhs, 'symbol')}`;
    substitution = `${sym} = ${renderTemplate(spec.rhs, 'value', values)}`;
  } else {
    const def = VAR[v];
    const f = (t: number) => r.residual({ ...values, [v]: t }, ctx);
    const root = findRoot(f, def.range[0], def.range[1], {
      log: def.positive,
      prefer: def.typical,
      samples: 80,
    });
    if (!root.converged)
      return { ok: false, reason: `no value of ${def.label.toLowerCase()} satisfies “${r.title}”` };
    x = root.x;
    method = `Solved numerically (Brent’s method on a bracketing scan, ${root.iterations} evaluations)`;
    formula = renderTemplate(r.equation, 'symbol');
    substitution = renderTemplate(r.equation, 'value', values, [v]);
  }
  const bad = inRange(v, x);
  if (bad) return { ok: false, reason: `${r.title}: ${bad}` };
  return {
    ok: true,
    derivations: [
      {
        varId: v,
        status: 'calculated',
        value: x,
        relationId: r.id,
        title: r.title,
        formula,
        substitution: `${substitution} = ${texValue(v, x)}`,
        inputs,
        method,
        note: r.explain,
        order: 0,
      },
    ],
  };
}

function solveBlock(rels: Relation[], vars: string[], values: Vals, ctx: Ctx): SolveOutcome {
  const n = vars.length;
  const pos = vars.map((v) => VAR[v]?.positive ?? true);
  const toX = (y: number[]) => y.map((t, i) => (pos[i] ? Math.exp(t) : t));
  const F = (y: number[]) => {
    const x = toX(y);
    const vv: Vals = { ...values };
    vars.forEach((v, i) => (vv[v] = x[i]));
    return rels.map((r) => r.residual(vv, ctx));
  };
  const norm = (f: number[]) => Math.sqrt(f.reduce((s, t) => s + t * t, 0));
  const starts: number[][] = [];
  const typ = vars.map((v) => VAR[v]?.typical ?? 1);
  for (const scale of [1, 0.3, 3, 0.1, 10])
    starts.push(typ.map((t, i) => (pos[i] ? Math.log(t * scale) : t * scale)));
  let best: { y: number[]; f: number; it: number } | null = null;
  for (const y0 of starts) {
    let y = y0.slice();
    let f = F(y);
    if (!f.every(Number.isFinite)) continue;
    let mu = 1e-3;
    let it = 0;
    for (; it < 120 && norm(f) > 1e-12; it++) {
      const J: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
      for (let j = 0; j < n; j++) {
        const h = 1e-6 * Math.max(1, Math.abs(y[j]));
        const yp = y.slice();
        yp[j] += h;
        const fp = F(yp);
        for (let i = 0; i < n; i++) J[i][j] = (fp[i] - f[i]) / h;
      }
      let improved = false;
      for (let tries = 0; tries < 12; tries++) {
        const JtJ = Array.from({ length: n }, (_, i) =>
          Array.from({ length: n }, (_, j) => {
            let s = 0;
            for (let k = 0; k < n; k++) s += J[k][i] * J[k][j];
            return s + (i === j ? mu * (1 + s) : 0);
          }),
        );
        const Jtf = Array.from({ length: n }, (_, i) => {
          let s = 0;
          for (let k = 0; k < n; k++) s += J[k][i] * f[k];
          return -s;
        });
        let step: number[];
        try {
          step = solveLinear(JtJ, Jtf);
        } catch {
          mu *= 10;
          continue;
        }
        // keep log-steps modest
        const maxStep = Math.max(...step.map(Math.abs));
        if (maxStep > 2) step = step.map((s) => (s * 2) / maxStep);
        const yn = y.map((t, i) => t + step[i]);
        const fn = F(yn);
        if (fn.every(Number.isFinite) && norm(fn) < norm(f)) {
          y = yn;
          f = fn;
          mu = Math.max(mu / 3, 1e-9);
          improved = true;
          break;
        }
        mu *= 10;
      }
      if (!improved) break;
    }
    const fn = norm(f);
    if (!best || fn < best.f) best = { y, f: fn, it };
    if (fn < 1e-9) break;
  }
  if (!best || best.f > 1e-7) {
    return {
      ok: false,
      reason: `no consistent solution for ${vars.map((v) => VAR[v]?.label ?? v).join(', ')} (equations: ${rels.map((r) => r.title).join('; ')})`,
    };
  }
  const x = toX(best.y);
  for (let i = 0; i < n; i++) {
    const bad = inRange(vars[i], x[i]);
    if (bad) return { ok: false, reason: bad };
  }
  const blockInputs = new Set<string>();
  for (const r of rels) for (const v of r.vars) if (!vars.includes(v)) blockInputs.add(v);
  const system = rels.map((r) => renderTemplate(r.equation, 'symbol'));
  const substituted = rels.map((r) => renderTemplate(r.equation, 'value', values, vars));
  const solution = vars.map((v, i) => `${texSymbol(v)} = ${texValue(v, x[i])}`);
  const formula = `\\begin{cases} ${system.join(' \\\\ ')} \\end{cases}`;
  const substitution = `\\begin{cases} ${substituted.join(' \\\\ ')} \\end{cases} \\;\\Rightarrow\\; ${solution.join(',\\ ')}`;
  return {
    ok: true,
    derivations: vars.map((v, i) => ({
      varId: v,
      status: 'calculated' as const,
      value: x[i],
      relationId: rels.map((r) => r.id).join('+'),
      title: `Solved together: ${rels.map((r) => r.title).join(' · ')}`,
      formula,
      substitution,
      inputs: [...blockInputs],
      method: `These ${n} equations share ${n} unknowns, so they were solved simultaneously (damped Newton–Raphson, ${best!.it} iterations; residual ${best!.f.toExponential(1)}).`,
      note: rels
        .map((r) => r.explain)
        .filter(Boolean)
        .join(' '),
      block: vars,
      order: 0,
    })),
  };
}

/** Residual check of every fully known relation. */
export function findConflicts(relations: Relation[], values: Vals, ctx: Ctx, tol = 1e-6) {
  const out: { relation: Relation; residual: number }[] = [];
  for (const r of relations) {
    if (
      !r.vars.every(
        (v) => values[v] !== undefined && (Number.isFinite(values[v]) || values[v] === Infinity),
      )
    )
      continue;
    const res = r.residual(values, ctx);
    if (Number.isFinite(res) && Math.abs(res) > tol) out.push({ relation: r, residual: res });
  }
  return out;
}
