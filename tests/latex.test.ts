import katex from 'katex';
import { describe, expect, it } from 'vitest';
import { buildRelations } from '../src/solver/relations';
import { renderTemplate } from '../src/solver/latex';
import { solveDesign } from '../src/solver/solve';
import { DEFAULT_REQUIREMENTS } from '../src/solver/types';
import { VARS } from '../src/solver/variables';
import { MATERIALS } from '../src/physics/structure/materials';
import { exampleSection } from './helpers';
import type { PlanformType } from '../src/physics/wing/planform';

const PLANFORMS: PlanformType[] = ['rectangular', 'tapered', 'elliptical'];

function parses(tex: string): string | null {
  try {
    katex.renderToString(tex, { throwOnError: true, strict: 'ignore', output: 'html' });
    return null;
  } catch (e) {
    return `${(e as Error).message}\n  in: ${tex}`;
  }
}

function sampleVals(scale: number) {
  return Object.fromEntries(VARS.map((v) => [v.id, scale]));
}

describe('equation LaTeX', () => {
  it('every relation template renders in KaTeX', () => {
    const errors: string[] = [];
    for (const planform of PLANFORMS) {
      for (const r of buildRelations(planform, 35)) {
        const tpls = [r.equation, ...Object.values(r.solveFor).map((s) => s.rhs)];
        for (const tpl of tpls) {
          const outs = [renderTemplate(tpl, 'symbol')];
          for (const scale of [1.234, -0.5, 1.5e6, 2e-5]) outs.push(renderTemplate(tpl, 'value', sampleVals(scale)));
          for (const tex of outs) {
            const err = parses(tex);
            if (err) errors.push(`${planform}/${r.id}: ${err}`);
          }
        }
      }
    }
    expect(errors).toEqual([]);
  });

  it('every secondary-foil and craft relation renders in KaTeX', () => {
    const errors: string[] = [];
    for (const planform2 of PLANFORMS) {
      const rels = buildRelations('tapered', 35, planform2).filter((r) =>
        r.vars.some((v) => VARS.find((d) => d.id === v)?.foil !== 1),
      );
      for (const r of rels) {
        for (const tpl of [r.equation, ...Object.values(r.solveFor).map((s) => s.rhs)]) {
          const outs = [renderTemplate(tpl, 'symbol')];
          for (const scale of [1.234, -0.5, 1.5e6, 2e-5])
            outs.push(renderTemplate(tpl, 'value', sampleVals(scale)));
          for (const tex of outs) {
            const err = parses(tex);
            if (err) errors.push(`${planform2}/${r.id}: ${err}`);
          }
        }
      }
    }
    expect(errors).toEqual([]);
  });

  it('every secondary-foil symbol renders in KaTeX', () => {
    const errors = VARS.filter((v) => v.foil !== 1)
      .map((v) => parses(v.symbol))
      .filter((e): e is string => e !== null);
    expect(errors).toEqual([]);
  });

  it('every derivation of a two-foil design renders in KaTeX', () => {
    const errors: string[] = [];
    for (const planform of PLANFORMS) {
      const res = solveDesign(
        {
          values: { m: 90, V: 5, b: 0.8, cr: 0.15, b2: 0.4, cr2: 0.08, h: 0.4 },
          planform: 'rectangular',
          salinity: 35,
          material: MATERIALS[0],
          requirements: DEFAULT_REQUIREMENTS,
          objective: 'minDrag',
          foil2: { planform, sameSection: true },
        },
        exampleSection(),
      );
      expect(res.values.Dtot).toBeGreaterThan(0);
      for (const [id, d] of Object.entries(res.derivations)) {
        for (const tex of [d.formula, d.substitution]) {
          if (!tex) continue;
          const err = parses(tex);
          if (err) errors.push(`${planform}/${id}: ${err}`);
        }
      }
    }
    expect(errors).toEqual([]);
  });

  it('every derivation of a solved design renders in KaTeX', () => {
    const errors: string[] = [];
    for (const planform of PLANFORMS) {
      const res = solveDesign(
        {
          values: { m: 90, V: 5, b: 0.8, cr: 0.15 },
          planform,
          salinity: 35,
          material: MATERIALS[0],
          requirements: DEFAULT_REQUIREMENTS,
          objective: 'minDrag',
        },
        exampleSection(),
      );
      for (const [id, d] of Object.entries(res.derivations)) {
        for (const tex of [d.formula, d.substitution]) {
          if (!tex) continue;
          const err = parses(tex);
          if (err) errors.push(`${planform}/${id}: ${err}`);
        }
      }
    }
    expect(errors).toEqual([]);
  });
});
