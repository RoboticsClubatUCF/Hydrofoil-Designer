import { describe, expect, it } from 'vitest';
import { marchSurface } from '../src/physics/profile/boundaryLayer';

const plate = (Re: number) => {
  const xi = Array.from({ length: 400 }, (_, i) => (i + 1) / 400);
  return marchSurface(
    xi,
    xi.map(() => 1),
    xi,
    Re,
  );
};

describe('boundary layer', () => {
  it('laminar flat plate matches Blasius', () => {
    const r = plate(1e5);
    expect(r.xTransition).toBe(1);
    expect(r.cd / (1.328 / Math.sqrt(1e5))).toBeCloseTo(1, 1);
    expect(r.hTE).toBeCloseTo(2.61, 2);
  });
  it('high-Re plate transitions and lies between laminar and fully turbulent drag', () => {
    const r = plate(1e7);
    expect(r.xTransition).toBeLessThan(0.5);
    expect(r.cd).toBeGreaterThan(1.328 / Math.sqrt(1e7));
    expect(r.cd).toBeLessThan(0.074 / Math.pow(1e7, 0.2));
  });
});
