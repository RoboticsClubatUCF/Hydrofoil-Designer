import { describe, expect, it } from 'vitest';
import { solveDesign } from '../src/solver/solve';
import { DEFAULT_REQUIREMENTS, type DesignInput } from '../src/solver/types';
import { FOIL_IDS, VAR, foilId, foilValues } from '../src/solver/variables';
import { MATERIALS } from '../src/physics/structure/materials';
import { buildSectionModel } from '../src/physics/profile/sectionModel';
import { naca4 } from '../src/physics/profile/geometry';
import { G } from '../src/physics/fluid';
import { simulate } from '../src/simulate/simulate';
import { designInput, sanitiseDoc } from '../src/state/store';
import { exampleSection } from './helpers';

const sec = exampleSection();
const sym = buildSectionModel(naca4('0012'), []);

const input = (values: Record<string, number>, extra: Partial<DesignInput> = {}): DesignInput => ({
  values,
  planform: 'rectangular',
  salinity: 0,
  material: MATERIALS[0],
  requirements: DEFAULT_REQUIREMENTS,
  objective: 'minDrag',
  ...extra,
});
const same = { foil2: { planform: 'rectangular' as const, sameSection: true } };
const near = (a: number, b: number, tol = 2e-3) =>
  expect(Math.abs(a - b) / Math.max(Math.abs(b), 1e-12)).toBeLessThan(tol);

// values that depend on section data at an iterated Reynolds number (settled to 0.1 %)
const RE_DEPENDENT = new Set(['Re', 'D', 'P', 'Vto']);

describe('secondary foil', () => {
  it('is ignored, inputs included, when it is switched off', () => {
    const r = solveDesign(input({ m: 90, V: 5, b: 0.8, cr: 0.15, b2: 0.4, cr2: 0.08 }), sec);
    expect(r.values.b2).toBeUndefined();
    expect(r.values.Dtot).toBeUndefined();
    expect(r.requirements.every((c) => c.foil === 1)).toBe(true);
    expect(r.values.share).toBe(1);
  });

  it('each foil solves like a single foil carrying its share of the load', () => {
    const both = solveDesign(
      input({ m: 90, V: 5, b: 0.8, cr: 0.15, b2: 0.4, cr2: 0.08, share: 0.75 }, same),
      sec,
    );
    const main = solveDesign(input({ m: 90, V: 5, b: 0.8, cr: 0.15, share: 0.75 }), sec);
    const second = solveDesign(input({ m: 90, V: 5, b: 0.4, cr: 0.08, share: 0.25 }), sec);
    expect(both.conflicts).toEqual([]);
    expect(both.values.share2).toBeCloseTo(0.25, 12);
    for (const id of ['L', 'S', 'CL', 'alpha', 'Re', 'D', 'P', 'Vto', 'SF', 'massFoil', 'e']) {
      near(both.values[id], main.values[id], RE_DEPENDENT.has(id) ? 2e-3 : 1e-6);
      near(both.values[`${id}2`], second.values[id], RE_DEPENDENT.has(id) ? 2e-3 : 5e-3);
    }
    // the secondary foil reads the shared section at its own Reynolds number
    near(both.values.Re2, (5 * 0.08) / both.values.nu, 1e-9);
    near(both.values.clmax2, sec.at(both.values.Re2).clmax, 1e-3);
    expect(both.derivations.clmax2.status).toBe('section');
  });

  it('adds up the craft totals', () => {
    const r = solveDesign(
      input({ m: 90, V: 5, b: 0.8, cr: 0.15, b2: 0.4, cr2: 0.08, share: 0.75 }, same),
      sec,
    );
    const v = r.values;
    near(v.L + v.L2, 90 * G, 1e-9);
    near(v.Dtot, v.D + v.D2, 1e-9);
    near(v.Ptot, v.Dtot * 5, 1e-9);
    near(v.LDtot, (90 * G) / v.Dtot, 1e-9);
    near(v.VtoCraft, Math.max(v.Vto, v.Vto2), 1e-12);
    near(v.massTot, v.massFoil + v.massFoil2, 1e-9);
    // the smaller foil works harder, so it needs more speed to lift off
    expect(v.Vto2).toBeGreaterThan(v.Vto);
    expect(v.VtoCraft).toBe(v.Vto2);
  });

  it('can use its own profile', () => {
    const r = solveDesign(
      input(
        { m: 90, V: 5, b: 0.8, cr: 0.15, b2: 0.4, cr2: 0.08, share: 0.75 },
        { foil2: { planform: 'rectangular', sameSection: false } },
      ),
      sec,
      { section2: sym },
    );
    const alone = solveDesign(input({ m: 90, V: 5, b: 0.4, cr: 0.08, share: 0.25 }), sym);
    near(r.values.tc2, 0.12, 2e-3);
    expect(Math.abs(r.values.alphaL02)).toBeLessThan(1e-4); // symmetric section
    near(r.values.tc, sec.geometry.tMax, 1e-9);
    for (const id of ['CL', 'alpha', 'D', 'SF', 'massFoil'])
      near(r.values[`${id}2`], alone.values[id], 5e-3);
  });

  it('waits for its own profile without holding up the main foil', () => {
    const r = solveDesign(
      input(
        { m: 90, V: 5, b: 0.8, cr: 0.15, b2: 0.4, cr2: 0.08, share: 0.75 },
        { foil2: { planform: 'rectangular', sameSection: false } },
      ),
      sec,
    );
    const main = solveDesign(input({ m: 90, V: 5, b: 0.8, cr: 0.15, share: 0.75 }), sec);
    expect(r.missing.some((m) => m.startsWith('Secondary foil'))).toBe(true);
    expect(r.values.S2).toBeCloseTo(0.032, 12);
    expect(r.values.D2).toBeUndefined();
    expect(r.values.Dtot).toBeUndefined();
    near(r.values.D, main.values.D, 1e-9);
  });

  it('assumes an 80/20 split, the main depth and the main take-off speed', () => {
    const r = solveDesign(input({ m: 90, V: 5, Vto: 3.5, h: 0.3 }, same), sec, {
      noOptimise: true,
    });
    expect(r.derivations.share.status).toBe('assumed');
    expect(r.values.share).toBe(0.8);
    expect(r.values.share2).toBeCloseTo(0.2, 12);
    expect(r.derivations.h2.status).toBe('assumed');
    expect(r.values.h2).toBe(0.3);
    expect(r.derivations.Vto2.status).toBe('assumed');
    expect(r.values.Vto2).toBe(3.5);
    // both sized to lift off at 3.5 m/s
    near(r.values.L2, 0.5 * r.values.rho * 3.5 ** 2 * r.values.S2 * r.values.CLmaxTo2, 1e-6);
  });

  it('optimises both foils and applies every requirement to each', () => {
    const req = { ...DEFAULT_REQUIREMENTS, spanMax: 0.9 };
    const r = solveDesign(input({ m: 90, V: 5 }, { ...same, requirements: req }), sec);
    const v = r.values;
    expect(r.optimisation?.ran).toBe(true);
    expect(r.optimisation?.dofs).toEqual(['AR', 'alpha', 'AR2', 'alpha2']);
    expect(r.optimisation?.objectiveValue).toBe(v.Dtot);
    expect(r.derivations.AR2.status).toBe('optimised');
    const seconds = r.requirements.filter((c) => c.foil === 2);
    expect(seconds.map((c) => c.id)).toEqual(
      r.requirements.filter((c) => c.foil === 1).map((c) => c.id),
    );
    expect(seconds.find((c) => c.id === 'spanMax')?.varId).toBe('b2');
    expect(r.requirements.filter((c) => c.ok === false)).toEqual([]);
    expect(v.b).toBeLessThanOrEqual(0.9 * 1.001);
    expect(v.b2).toBeLessThanOrEqual(0.9 * 1.001);
    expect(v.S2).toBeLessThan(v.S);
  });

  it('flies both foils over one speed range and adds the drag', () => {
    const inp = input({ m: 90, V: 5, b: 0.8, cr: 0.15, b2: 0.4, cr2: 0.08, share: 0.75 }, same);
    const r = solveDesign(inp, sec);
    const sim = simulate(inp, sec, r);
    expect(sim.second?.sweep).toBeTruthy();
    expect(sim.total).toBeTruthy();
    const a = sim.sweep!;
    const b = sim.second!.sweep!;
    expect(b.V).toEqual(a.V);
    for (let i = 0; i < a.V.length; i++) near(sim.total!.D[i], a.D[i] + b.D[i], 1e-12);
    expect(sim.total!.markers.Vto).toBe(r.values.VtoCraft);
    expect(sim.second!.outline?.at(-1)?.y).toBeCloseTo(0.2, 9);
  });

  it('every secondary-foil variable mirrors a main-foil one', () => {
    for (const id of FOIL_IDS) {
      const twin = VAR[foilId(id, 2)];
      expect(twin.base).toBe(id);
      expect(twin.foil).toBe(2);
      expect(twin.quantity).toBe(VAR[id].quantity);
    }
    expect(foilId('m', 2)).toBe('m');
    expect(foilValues({ b: 1, b2: 2, V: 5 }, 2)).toMatchObject({ b: 2, V: 5 });
    expect(foilValues({ b: 1, V: 5 }, 2).b).toBeUndefined();
  });

  it('design files keep the secondary foil settings', () => {
    const blank = sanitiseDoc({});
    expect(blank.foil2.enabled).toBe(false);
    expect(designInput(blank).foil2).toBeNull();
    const doc = sanitiseDoc({
      foil2: {
        enabled: true,
        sameSection: false,
        profileText: 'x',
        polarTexts: ['a', 3 as unknown as string],
        planform: 'bogus' as 'tapered',
      },
    });
    expect(doc.foil2).toEqual({
      enabled: true,
      sameSection: false,
      profileText: 'x',
      polarTexts: ['a'],
      planform: 'rectangular',
    });
    expect(designInput(doc).foil2).toEqual({ planform: 'rectangular', sameSection: false });
  });
});
