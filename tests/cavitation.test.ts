import { describe, expect, it } from 'vitest';
import { cavitationInceptionSpeed, cavitationNumber } from '../src/physics/hydro/cavitation';
import { solveDesign } from '../src/solver/solve';
import { DEFAULT_REQUIREMENTS } from '../src/solver/types';
import { MATERIALS } from '../src/physics/structure/materials';
import { G } from '../src/physics/fluid';
import { exampleSection } from './helpers';

// σ = 200/V² with these inputs (p_atm = 1e5, ρ = 1000, depth 0, p_v = 0)
const sigmaArgs = [1e5, 1000, 0, 0, 0] as const;

describe('cavitation inception speed', () => {
  it('returns the high-speed crossing when the margin is also negative at low speed', () => {
    // margin = 200/V² − 0.5 − 1e4/V⁴: negative below ≈ 7.65 m/s and above ≈ 18.48 m/s
    const cpMin = (V: number) => -0.5 - 1e4 / V ** 4;
    const vcav = cavitationInceptionSpeed(...sigmaArgs, cpMin);
    const u = (200 - Math.sqrt(200 ** 2 - 4 * 1e4 * 0.5)) / (2 * 1e4);
    expect(vcav).toBeCloseTo(1 / Math.sqrt(u), 4);
  });

  it('returns null when no inception happens below the top speed', () => {
    expect(cavitationInceptionSpeed(...sigmaArgs, () => 0, 0.5, 10)).toBeNull();
  });

  it('returns the lowest speed when the margin is negative everywhere', () => {
    expect(cavitationInceptionSpeed(...sigmaArgs, () => -1e6, 2, 80)).toBe(2);
  });

  it('solver result sits at the top of the cavitation-free range', () => {
    const sec = exampleSection();
    const r = solveDesign(
      {
        values: { m: 90, V: 5, b: 0.8, cr: 0.15, h: 0.3 },
        planform: 'rectangular',
        salinity: 0,
        material: MATERIALS[0],
        requirements: DEFAULT_REQUIREMENTS,
        objective: 'minDrag',
      },
      sec,
    );
    const v = r.values;
    const margin = (V: number) =>
      cavitationNumber(v.patm, v.rho, G, v.h, v.pv, V) +
      sec.cpMin((v.kPeak * v.L) / (0.5 * v.rho * V * V * v.S));
    expect(v.Vcav).toBeGreaterThan(v.V);
    expect(Math.abs(margin(v.Vcav))).toBeLessThan(1e-4);
    for (const k of [1.05, 1.5, 3]) expect(margin(k * v.Vcav)).toBeLessThan(0);
  });
});
