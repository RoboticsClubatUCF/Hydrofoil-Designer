import { describe, expect, it } from 'vitest';
import { parsePolar, summarisePolar, PolarParseError } from '../src/physics/profile/polar';
import { rad } from './helpers';

/** Synthetic polar in airfoiltools CSV layout: cl = 0.11·(α + 3) up to 12°, then a drop. */
function syntheticCsv(Re: number) {
  const rows = ['Alpha,Cl,Cd,Cdp,Cm,Top_Xtr,Bot_Xtr'];
  for (let a = -6; a <= 16; a += 0.5) {
    const cl = a <= 12 ? 0.11 * (a + 3) : 1.65 - 0.08 * (a - 12);
    const cd = 0.006 + 0.004 * (cl - 0.4) ** 2 + (a > 12 ? 0.02 * (a - 12) : 0);
    rows.push(
      `${a.toFixed(3)},${cl.toFixed(4)},${cd.toFixed(5)},${(cd / 2).toFixed(5)},-0.0800,0.5,0.6`,
    );
  }
  return [
    'Xfoil polar. Reynolds number fixed. Mach  number fixed',
    'Polar key,xf-test-il-' + Re,
    'Airfoil,test-il',
    `Reynolds number,${Re}`,
    'Ncrit,9',
    'Mach,0',
    '',
    ...rows,
  ].join('\n');
}

describe('polar import', () => {
  it('parses airfoiltools CSV and derives the lift line', () => {
    const p = parsePolar(syntheticCsv(500000));
    expect(p.Re).toBe(500000);
    expect(p.ncrit).toBe(9);
    const s = summarisePolar(p);
    expect(s.alphaL0).toBeCloseTo(rad(-3), 4);
    expect(s.a0).toBeCloseTo(0.11 * (180 / Math.PI), 2);
    expect(s.clmax).toBeCloseTo(1.65, 3);
    expect(s.alphaStall).toBeCloseTo(rad(12), 4);
  });

  it('parses XFoil saved-polar text', () => {
    const txt = [
      '       XFOIL         Version 6.99',
      ' Calculated polar for: TEST',
      ' Mach =   0.000     Re =     0.200 e 6     Ncrit =   9.000',
      '   alpha    CL        CD       CDp       CM     Top_Xtr  Bot_Xtr',
      '  ------ -------- --------- --------- -------- -------- --------',
      ...[-2, 0, 2, 4, 6, 8].map(
        (a) =>
          `  ${a.toFixed(3)}   ${(0.1 * (a + 2)).toFixed(4)}   0.01000   0.00500  -0.0500   0.5000   0.6000`,
      ),
    ].join('\n');
    const p = parsePolar(txt);
    expect(p.Re).toBeCloseTo(2e5, 6);
    expect(p.label).toBe('TEST');
    expect(p.rows).toHaveLength(6);
  });

  it('errors clearly on bad input', () => {
    expect(() => parsePolar('nothing here')).toThrow(PolarParseError);
  });
});
