import { describe, expect, it } from 'vitest';
import { parseProfile, ProfileParseError, toSelig } from '../src/physics/profile/parse';
import { buildGeometry, naca4 } from '../src/physics/profile/geometry';
import { exampleText } from './helpers';

describe('profile parsing', () => {
  it('reads the Lednicer example (NACA 63-412)', () => {
    const p = parseProfile(exampleText());
    expect(p.name).toBe('NACA 63-412 AIRFOIL');
    expect(p.format).toBe('lednicer');
    expect(p.upper).toHaveLength(26);
    expect(p.lower).toHaveLength(26);
    expect(p.pointCount).toBe(52);
    expect(p.upper[0]).toEqual({ x: 0, y: 0 });
    expect(p.upper[25].x).toBeCloseTo(1, 9);
    expect(p.warnings).toEqual([]);
  });

  it('reads the same foil in Selig format identically', () => {
    const led = parseProfile(exampleText());
    const sel = parseProfile(toSelig(led));
    expect(sel.format).toBe('selig');
    expect(sel.upper.length).toBe(led.upper.length);
    sel.upper.forEach((q, i) => {
      expect(q.x).toBeCloseTo(led.upper[i].x, 6);
      expect(q.y).toBeCloseTo(led.upper[i].y, 6);
    });
    sel.lower.forEach((q, i) => expect(q.y).toBeCloseTo(led.lower[i].y, 6));
  });

  it('accepts commas, tabs, no name and lower-first ordering', () => {
    const led = parseProfile(exampleText());
    const lines = [...led.lower].reverse().map((q) => `${q.x},\t${q.y}`);
    lines.push(...led.upper.slice(1).map((q) => `${q.x}, ${q.y}`));
    const p = parseProfile(lines.join('\n'));
    expect(p.upper[10].y).toBeGreaterThan(0);
    expect(p.warnings.some((w) => w.includes('swapped'))).toBe(true);
  });

  it('normalises scaled and shifted coordinates', () => {
    const led = parseProfile(exampleText());
    const txt = [
      'scaled',
      ...[...led.upper].reverse().map((q) => `${100 * q.x + 5} ${100 * q.y + 2}`),
      ...led.lower.slice(1).map((q) => `${100 * q.x + 5} ${100 * q.y + 2}`),
    ].join('\n');
    const p = parseProfile(txt);
    expect(p.upper[p.upper.length - 1].x).toBeCloseTo(1, 6);
    expect(p.upper[12].y).toBeCloseTo(led.upper[12].y, 6);
    expect(p.warnings.join(' ')).toMatch(/normalised/);
  });

  it('rejects junk with a clear message', () => {
    expect(() => parseProfile('hello\n1 2\n3 4')).toThrow(ProfileParseError);
    expect(() => parseProfile('')).toThrow(/Not enough/);
  });
});

describe('section geometry', () => {
  it('NACA 0012: thickness, area, LE radius', () => {
    const g = buildGeometry(naca4('0012'));
    expect(g.tMax).toBeCloseTo(0.12, 3);
    expect(g.xTMax).toBeCloseTo(0.3, 1);
    expect(Math.abs(g.camberMax)).toBeLessThan(1e-6);
    // closed-TE NACA 4-digit area ≈ 0.685 t c²
    expect(g.area / g.tMax).toBeCloseTo(0.685, 2);
    // LE radius 1.1019 t²
    expect(g.leRadius).toBeCloseTo(1.1019 * 0.12 ** 2, 3);
    expect(g.centroid.y).toBeCloseTo(0, 6);
  });
  it('NACA 4412 camber', () => {
    const g = buildGeometry(naca4('4412'));
    expect(g.camberMax).toBeCloseTo(0.04, 3);
    expect(g.xCamberMax).toBeCloseTo(0.4, 1);
  });
  it('NACA 63-412 example', () => {
    const g = buildGeometry(parseProfile(exampleText()));
    expect(g.tMax).toBeCloseTo(0.12, 3);
    expect(g.xTMax).toBeCloseTo(0.35, 1);
    expect(g.camberMax).toBeCloseTo(0.022, 2);
    expect(g.sectionModulus).toBeGreaterThan(0);
    expect(g.ixx).toBeGreaterThan(0);
  });
});
