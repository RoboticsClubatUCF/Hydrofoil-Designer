import { describe, expect, it } from 'vitest';
import { liftingLine } from '../src/physics/wing/liftingLine';
import { cantileverBending } from '../src/physics/structure/beam';

const a0 = 2 * Math.PI;
describe('lifting line', () => {
  it('elliptical planform: e = 1 and CLα = a0/(1 + a0/(πAR))', () => {
    for (const AR of [4, 6, 10]) {
      const r = liftingLine('elliptical', AR, 0, a0);
      expect(r.e).toBeCloseTo(1, 6);
      expect(r.CLalpha).toBeCloseTo(a0 / (1 + a0 / (Math.PI * AR)), 4);
      expect(r.loadCentroid).toBeCloseTo(4 / (3 * Math.PI), 3);
    }
  });
  it('rectangular AR 6: δ ≈ 0.05 (Glauert)', () => {
    const r = liftingLine('rectangular', 6, 1, a0);
    expect(r.delta).toBeGreaterThan(0.04);
    expect(r.delta).toBeLessThan(0.06);
    expect(r.clPeakRatio).toBeGreaterThan(1);
  });
  it('taper ratio ≈ 0.35 is nearly elliptical', () => {
    expect(liftingLine('tapered', 6, 0.35, a0).delta).toBeLessThan(0.015);
  });
});

describe('cantilever bending', () => {
  it('uniform load on a constant section matches qL⁴/(8EI)', () => {
    const eta = Array.from({ length: 401 }, (_, i) => i / 400);
    const w = eta.map(() => 1);
    const lift = 1000,
      span = 2,
      E = 70e9,
      I1 = 1e-4,
      c = 1;
    const r = cantileverBending(lift, span, c, 'rectangular', 1, eta, w, I1, 1, E);
    const q = lift / 2 / (span / 2);
    const l = span / 2;
    expect(r.moment[0]).toBeCloseTo((q * l * l) / 2, 3);
    expect(r.tipDeflection / ((q * l ** 4) / (8 * E * I1))).toBeCloseTo(1, 3);
  });
});
