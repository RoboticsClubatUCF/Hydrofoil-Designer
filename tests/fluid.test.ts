import { describe, expect, it } from 'vitest';
import { waterDensity, waterKinematicViscosity, waterVapourPressure } from '../src/physics/fluid';

// Reference values: ITTC 7.5-02-01-03 (2011) fresh water and seawater tables.
describe('water properties', () => {
  it('fresh water at 20 °C', () => {
    expect(waterDensity(20, 0)).toBeCloseTo(998.2, 1);
    expect(waterKinematicViscosity(20, 0)).toBeCloseTo(1.0034e-6, 8);
    expect(waterVapourPressure(20, 0)).toBeCloseTo(2339, -1);
  });
  it('fresh water at 4 °C has maximum density', () => {
    expect(waterDensity(4, 0)).toBeGreaterThan(waterDensity(1, 0));
    expect(waterDensity(4, 0)).toBeGreaterThan(waterDensity(8, 0));
    expect(waterDensity(4, 0)).toBeCloseTo(999.97, 1);
  });
  it('seawater at 15 °C, 35 g/kg', () => {
    expect(Math.abs(waterDensity(15, 35) - 1026.0)).toBeLessThan(0.5);
    expect(Math.abs(waterKinematicViscosity(15, 35) - 1.1892e-6) / 1.1892e-6).toBeLessThan(0.01);
    expect(waterVapourPressure(15, 35)).toBeLessThan(waterVapourPressure(15, 0));
  });
});
