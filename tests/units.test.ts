import { describe, expect, it } from 'vitest';
import { UNITS, fromSI, toSI, getUnit, fmt } from '../src/physics/units';

describe('units', () => {
  it('round-trips every unit', () => {
    for (const list of Object.values(UNITS)) {
      for (const u of list) {
        for (const v of [-12.5, 0, 0.003, 42, 1234.5])
          expect(fromSI(toSI(v, u), u)).toBeCloseTo(v, 9);
      }
    }
  });
  it('converts common values', () => {
    expect(toSI(10, getUnit('speed', 'kn'))).toBeCloseTo(5.1444, 4);
    expect(toSI(68, getUnit('temperature', 'F'))).toBeCloseTo(20, 9);
    expect(toSI(200, getUnit('mass', 'lb'))).toBeCloseTo(90.718, 3);
    expect(toSI(60, getUnit('percent'))).toBeCloseTo(0.6, 12);
    expect(toSI(0.11, getUnit('perAngle', '/deg'))).toBeCloseTo(6.3025, 4);
  });
  it('formats numbers', () => {
    expect(fmt(0.123456)).toBe('0.1235');
    expect(fmt(1234567)).toBe('1.235×10^6');
    expect(fmt(5)).toBe('5');
  });
});
