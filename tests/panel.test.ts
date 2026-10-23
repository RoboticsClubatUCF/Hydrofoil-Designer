import { describe, expect, it } from 'vitest';
import { buildGeometry, naca4 } from '../src/physics/profile/geometry';
import { alphaForCl, inviscidLiftLine, panelAt, solvePanels } from '../src/physics/profile/panel';
import type { ParsedProfile, Pt } from '../src/physics/profile/parse';
import { parseProfile } from '../src/physics/profile/parse';
import { deg, exampleText, rad } from './helpers';

/** Symmetric Joukowski aerofoil: circle centre (−ε, 0) mapped by z = ζ + 1/ζ. */
function joukowski(eps: number, n = 240): { profile: ParsedProfile; chord: number; R: number } {
  const R = 1 + eps;
  const pts: Pt[] = [];
  for (let i = 0; i <= n; i++) {
    const th = (2 * Math.PI * i) / n;
    const zr = -eps + R * Math.cos(th),
      zi = R * Math.sin(th);
    const m = zr * zr + zi * zi;
    pts.push({ x: zr + zr / m, y: zi - zi / m });
  }
  const chord = 2 - pts[n / 2].x;
  const txt = ['Joukowski', ...pts.map((p) => `${p.x} ${p.y}`)].join('\n');
  return { profile: parseProfile(txt), chord, R };
}

describe('panel method', () => {
  it('symmetric section has zero lift at zero angle', () => {
    const sol = solvePanels(buildGeometry(naca4('0012')).nodes);
    expect(Math.abs(panelAt(sol, 0).cl)).toBeLessThan(1e-3);
  });

  it('lift slope ≈ 2π(1 + 0.77 t/c) for NACA 0012', () => {
    const sol = solvePanels(buildGeometry(naca4('0012')).nodes);
    const { a0 } = inviscidLiftLine(sol);
    expect(a0 / (2 * Math.PI * (1 + 0.77 * 0.12))).toBeCloseTo(1, 1);
  });

  it('zero-lift angles agree with thin-aerofoil theory', () => {
    const z2412 = inviscidLiftLine(solvePanels(buildGeometry(naca4('2412')).nodes)).alphaL0;
    const z4412 = inviscidLiftLine(solvePanels(buildGeometry(naca4('4412')).nodes)).alphaL0;
    expect(deg(z2412)).toBeCloseTo(-2.08, 0);
    expect(deg(z4412)).toBeCloseTo(-4.15, 0);
  });

  it('matches the exact Joukowski lift within 1.5 %', () => {
    const { profile, chord, R } = joukowski(0.1);
    const sol = solvePanels(buildGeometry(profile, 200).nodes);
    for (const a of [2, 5, 8]) {
      const exact = (8 * Math.PI * R * Math.sin(rad(a))) / chord;
      const cl = panelAt(sol, rad(a)).cl;
      expect(Math.abs(cl - exact) / exact).toBeLessThan(0.015);
    }
  });

  it('NACA 0012 at zero lift: peak suction matches published v/V ≈ 1.19', () => {
    const sol = solvePanels(buildGeometry(naca4('0012')).nodes);
    expect(panelAt(sol, 0).cpMin).toBeCloseTo(1 - 1.19 ** 2, 1);
  });

  it('is converged for the 63-412 example', () => {
    const p = parseProfile(exampleText());
    const a = inviscidLiftLine(solvePanels(buildGeometry(p, 160).nodes));
    const b = inviscidLiftLine(solvePanels(buildGeometry(p, 320).nodes));
    expect(Math.abs(a.a0 - b.a0) / b.a0).toBeLessThan(0.005);
    expect(Math.abs(deg(a.alphaL0 - b.alphaL0))).toBeLessThan(0.05);
  });

  it('alphaForCl inverts the lift curve', () => {
    const sol = solvePanels(buildGeometry(naca4('4412')).nodes);
    const a = alphaForCl(sol, 0.8);
    expect(panelAt(sol, a).cl).toBeCloseTo(0.8, 6);
  });
});
