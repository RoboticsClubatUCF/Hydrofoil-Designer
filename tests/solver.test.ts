import { describe, expect, it } from 'vitest';
import { solveDesign } from '../src/solver/solve';
import { DEFAULT_REQUIREMENTS, type DesignInput } from '../src/solver/types';
import { MATERIALS } from '../src/physics/structure/materials';
import { liftingLine } from '../src/physics/wing/liftingLine';
import { exampleSection, rad } from './helpers';

const sec = exampleSection();
const input = (values: Record<string, number>, extra: Partial<DesignInput> = {}): DesignInput => ({
  values,
  planform: 'rectangular',
  salinity: 0,
  material: MATERIALS[0],
  requirements: DEFAULT_REQUIREMENTS,
  objective: 'minDrag',
  ...extra,
});

describe('solver: propagation', () => {
  it('a blank form stays blank', () => {
    const r = solveDesign(input({}), sec);
    for (const id of ['L', 'S', 'T', 'rho', 'share', 'kFS']) expect(r.values[id]).toBeUndefined();
    expect(r.missing.length).toBeGreaterThan(0);
  });

  it('mass alone gives lift, assuming full load share but not water temperature', () => {
    const r = solveDesign(input({ m: 90 }), sec);
    expect(r.values.L).toBeCloseTo(90 * 9.80665, 6);
    expect(r.derivations.share.status).toBe('assumed');
    expect(r.values.T).toBeUndefined();
  });

  it('hand check: fully specified rectangular foil', () => {
    const r = solveDesign(input({ m: 90, V: 5, b: 0.8, cr: 0.15 }), sec);
    // independent calculation with literature water properties at 20 °C
    const rho = 998.21,
      nu = 1.0034e-6;
    const L = 90 * 9.80665;
    const q = 0.5 * rho * 25;
    const S = 0.8 * 0.15;
    const CL = L / (q * S);
    const AR = 0.8 / 0.15;
    const Re = (5 * 0.15) / nu;
    const s = sec.at(Re);
    const ll = liftingLine('rectangular', AR, 1, s.a0);
    const alpha = s.alphaL0 + CL / ll.CLalpha;
    const CDi = (CL * CL) / (Math.PI * ll.e * AR);
    const near = (a: number, b: number, tol = 2e-3) =>
      expect(Math.abs(a - b) / Math.abs(b)).toBeLessThan(tol);
    near(r.values.L, L);
    near(r.values.q, q);
    near(r.values.S, S);
    near(r.values.CL, CL);
    near(r.values.AR, AR);
    near(r.values.Re, Re);
    near(r.values.alpha, alpha, 5e-3);
    near(r.values.CDi, CDi, 5e-3);
    near(r.values.D, r.values.q * S * (r.values.CDp + r.values.CDi), 1e-9);
    near(r.values.P, r.values.D * 5, 1e-9);
    expect(r.derivations.S.status).toBe('calculated');
    expect(r.derivations.S.substitution).toContain('0.8');
    expect(r.derivations.S.substitution).toContain('0.15');
    expect(r.optimisation).toBeNull();
  });

  it('solves backwards: area and span give the chord', () => {
    const r = solveDesign(input({ S: 0.12, b: 0.8 }), sec);
    expect(r.values.cr).toBeCloseTo(0.15, 9);
    expect(r.derivations.cr.status).toBe('calculated');
    expect(r.derivations.cr.inputs).toEqual(['cbar']);
    expect(r.derivations.cbar.inputs.sort()).toEqual(['S', 'b']);
  });

  it('solves coupled equations simultaneously (mass, speed, span, angle)', () => {
    const r = solveDesign(input({ m: 90, V: 5, b: 0.8, alpha: rad(3) }), sec);
    expect(r.values.S).toBeGreaterThan(0);
    expect(r.values.L).toBeCloseTo(r.values.q * r.values.S * r.values.CL, 6);
    expect(r.values.AR).toBeCloseTo((0.8 * 0.8) / r.values.S, 6);
    expect(r.conflicts).toHaveLength(0);
    const blockVars = Object.values(r.derivations).filter((d) => (d.block?.length ?? 0) > 1);
    expect(blockVars.length).toBeGreaterThan(1);
  });

  it('sizes the chord for a safety-factor target', () => {
    const r = solveDesign(input({ m: 90, V: 5, b: 0.9, SF: 2 }), sec);
    expect(r.values.SF).toBe(2);
    expect(r.values.sigmaMax).toBeCloseTo(MATERIALS[0].yieldStrength / 2, -3);
    expect(r.derivations.cr.status).toBe('calculated');
  });

  it('flags contradictory inputs', () => {
    const r = solveDesign(input({ b: 0.8, cr: 0.15, S: 0.2 }), sec);
    expect(r.conflicts.length).toBeGreaterThan(0);
    expect(r.conflicts[0].vars.sort()).toEqual(['S', 'b', 'cr']);
  });

  it('a typed density overrides the correlation', () => {
    const r = solveDesign(input({ rho: 1025, V: 5 }), sec);
    expect(r.values.q).toBeCloseTo(0.5 * 1025 * 25, 6);
  });

  it('depth brings in free-surface lift loss and cavitation', () => {
    const r = solveDesign(input({ m: 90, V: 5, b: 0.8, cr: 0.15, h: 0.3 }), sec);
    expect(r.values.kFS).toBeLessThan(1);
    expect(r.values.sigma).toBeGreaterThan(0);
    expect(r.values.cavMargin).toBeCloseTo(r.values.sigma + r.values.cpMin, 9);
    expect(r.values.Vcav).toBeGreaterThan(5);
  });

  it('elliptical planform has span efficiency 1', () => {
    const r = solveDesign(input({ b: 0.8, cr: 0.15 }, { planform: 'elliptical' }), sec);
    expect(r.values.e).toBeCloseTo(1, 6);
    expect(r.values.S).toBeCloseTo((Math.PI / 4) * 0.8 * 0.15, 9);
  });
});

describe('solver: fitting the design', () => {
  it('optimises free choices and reports them', () => {
    const r = solveDesign(input({ m: 90, V: 5 }), sec);
    expect(r.optimisation?.ran).toBe(true);
    expect(r.optimisation?.dofs).toContain('AR');
    expect(r.derivations.AR.status).toBe('optimised');
    expect(r.derivations.S.status).toBe('calculated');
    expect(r.requirements.every((c) => c.ok !== false)).toBe(true);
  });

  it('honours a span limit and a safety factor', () => {
    const req = { ...DEFAULT_REQUIREMENTS, spanMax: 0.7, sfMin: 3 };
    const r = solveDesign(input({ m: 90, V: 5 }, { requirements: req }), sec);
    expect(r.values.b).toBeLessThanOrEqual(0.7 * 1.002);
    expect(r.values.SF).toBeGreaterThanOrEqual(3 * 0.995);
  });

  it('tapered foils get a taper ratio too', () => {
    const r = solveDesign(input({ m: 90, V: 5 }, { planform: 'tapered' }), sec);
    expect(r.optimisation?.dofs).toContain('lambda');
    expect(r.values.ct).toBeLessThan(r.values.cr);
  });

  it('take-off speed target sets the area', () => {
    const r = solveDesign(input({ m: 90, V: 5, Vto: 3.5 }), sec);
    expect(r.values.Vto).toBe(3.5);
    expect(r.values.L).toBeCloseTo(0.5 * r.values.rho * 3.5 ** 2 * r.values.S * r.values.CLmax, 6);
  });
});
