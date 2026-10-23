import { describe, expect, it } from 'vitest';
import { exampleSection, deg } from './helpers';

/**
 * Reference points read from the XFoil polars published on airfoiltools.com for
 * NACA 63-412 (n63412-il, Ncrit 9). Only these few numbers are used for calibration.
 */
const REF = {
  5e5: {
    alphaL0: -3.03,
    slopePerDeg: 0.1114,
    clmax: 1.329,
    cd: { 0.2: 0.00714, 0.5: 0.00745, 0.8: 0.00824 },
  },
  1e6: {
    alphaL0: -3.02,
    slopePerDeg: 0.1132,
    clmax: 1.418,
    cd: { 0.2: 0.00561, 0.5: 0.00584, 0.8: 0.00693 },
  },
} as const;

describe('estimate-mode section model vs XFoil (NACA 63-412)', () => {
  const sec = exampleSection();
  for (const [ReStr, ref] of Object.entries(REF)) {
    const Re = Number(ReStr);
    it(`Re ${Re}`, () => {
      const s = sec.at(Re);
      expect(Math.abs(deg(s.alphaL0) - ref.alphaL0)).toBeLessThan(0.5);
      expect(Math.abs(s.a0 * (Math.PI / 180) - ref.slopePerDeg) / ref.slopePerDeg).toBeLessThan(
        0.1,
      );
      expect(Math.abs(s.clmax - ref.clmax) / ref.clmax).toBeLessThan(0.15);
      for (const [cl, cd] of Object.entries(ref.cd)) {
        expect(Math.abs(sec.cd(Number(cl), Re) - cd) / cd).toBeLessThan(0.3);
      }
    });
  }
  it('minimum pressure falls as lift rises', () => {
    expect(sec.cpMin(1.0)).toBeLessThan(sec.cpMin(0.5));
  });
});
