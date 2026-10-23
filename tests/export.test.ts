import { describe, expect, it } from 'vitest';
import { parseProfile } from '../src/physics/profile/parse';
import { buildDxf } from '../src/export/dxf';
import { sectionXyz, sectionsCsv } from '../src/export/xyz';
import { buildReport } from '../src/export/report';
import { solveDesign } from '../src/solver/solve';
import { DEFAULT_REQUIREMENTS } from '../src/solver/types';
import { MATERIALS } from '../src/physics/structure/materials';
import { exampleSection, exampleText } from './helpers';

const profile = parseProfile(exampleText());
const nPts = profile.upper.length + profile.lower.length - 1;

describe('exports', () => {
  it('DXF has the expected layers and closed outlines', () => {
    const dxf = buildDxf({
      profile,
      planform: 'tapered',
      lambda: 0.5,
      span: 0.8,
      rootChord: 0.15,
      tipChord: 0.075,
      name: 'test',
    });
    const lines = dxf.split('\r\n');
    expect(lines[1]).toBe('SECTION');
    expect(lines.filter((l) => l === 'POLYLINE')).toHaveLength(3);
    for (const layer of ['ROOT_SECTION', 'TIP_SECTION', 'PLANFORM_HALF'])
      expect(dxf).toContain(layer);
    expect(lines[lines.length - 2]).toBe('EOF');
    // root section spans 150 mm of chord
    const xs: number[] = [];
    let layer = '';
    for (let i = 0; i < lines.length - 1; i++) {
      if (lines[i] === '8') layer = lines[i + 1];
      if (lines[i] === '10' && layer === 'ROOT_SECTION') xs.push(Number(lines[i + 1]));
    }
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(150, 1);
  });

  it('XYZ and CSV point files', () => {
    const txt = sectionXyz(profile, 0.15, 0.4).trim().split('\n');
    expect(txt).toHaveLength(nPts);
    expect(txt[0].split(' ')).toHaveLength(3);
    expect(Number(txt[0].split(' ')[2])).toBeCloseTo(400, 6);
    const csv = sectionsCsv(profile, 0.15, 0.1, 0.4).trim().split('\n');
    expect(csv[0]).toBe('section,x_mm,y_mm,z_mm');
    expect(csv).toHaveLength(1 + 2 * nPts);
  });

  it('report lists inputs and worked calculations', () => {
    const r = solveDesign(
      {
        values: { m: 90, V: 5, b: 0.8, cr: 0.15 },
        planform: 'rectangular',
        salinity: 0,
        material: MATERIALS[0],
        requirements: DEFAULT_REQUIREMENTS,
        objective: 'minDrag',
      },
      exampleSection(),
    );
    const md = buildReport(r, 'Test foil', {});
    expect(md).toContain('# Test foil');
    expect(md).toContain('## Your inputs');
    expect(md).toContain('### Planform area');
    expect(md).toContain('$$');
  });
});
