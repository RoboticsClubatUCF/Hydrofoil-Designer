/**
 * Minimal DXF (R12, ASCII) writer: polylines on named layers, millimetres.
 * R12 is the most widely importable flavour (Fusion 360, SolidWorks, Onshape,
 * FreeCAD, LibreCAD, laser/CNC software).
 */
import type { ParsedProfile } from '../physics/profile/parse';
import { planformOutline, type PlanformType } from '../physics/wing/planform';
import { scaledSection } from './geometry';

interface Poly {
  layer: string;
  pts: { x: number; y: number }[];
  closed: boolean;
}

function layerTable(layers: { name: string; color: number }[]): string[] {
  const out = ['0', 'TABLE', '2', 'LAYER', '70', String(layers.length)];
  for (const l of layers)
    out.push('0', 'LAYER', '2', l.name, '70', '0', '62', String(l.color), '6', 'CONTINUOUS');
  out.push('0', 'ENDTAB');
  return out;
}

function polyline(p: Poly): string[] {
  const out = ['0', 'POLYLINE', '8', p.layer, '66', '1', '70', p.closed ? '1' : '0'];
  for (const q of p.pts)
    out.push('0', 'VERTEX', '8', p.layer, '10', q.x.toFixed(4), '20', q.y.toFixed(4), '30', '0.0');
  out.push('0', 'SEQEND', '8', p.layer);
  return out;
}

function text(layer: string, x: number, y: number, h: number, s: string): string[] {
  return [
    '0',
    'TEXT',
    '8',
    layer,
    '10',
    x.toFixed(3),
    '20',
    y.toFixed(3),
    '30',
    '0.0',
    '40',
    h.toFixed(3),
    '1',
    s,
  ];
}

export interface DxfOptions {
  profile: ParsedProfile;
  planform: PlanformType;
  lambda: number;
  span: number; // m
  rootChord: number; // m
  tipChord: number; // m
  name: string;
}

/** Root and tip sections (quarter-chord aligned) and the half-planform below them. */
export function buildDxf(o: DxfOptions): string {
  const polys: Poly[] = [];
  const texts: string[][] = [];
  const crMM = o.rootChord * 1000;
  polys.push({ layer: 'ROOT_SECTION', pts: scaledSection(o.profile, o.rootChord), closed: true });
  if (o.tipChord > 1e-6)
    polys.push({ layer: 'TIP_SECTION', pts: scaledSection(o.profile, o.tipChord), closed: true });
  // half planform (top view), placed below the sections; x = chordwise, y = spanwise
  const outline = planformOutline(o.planform, o.lambda, o.span, o.rootChord, 80);
  const yOff = -1.5 * crMM;
  const plan = [
    ...outline.map((p) => ({ x: (p.xLE - 0.25 * o.rootChord) * 1000, y: yOff - p.y * 1000 })),
    ...[...outline]
      .reverse()
      .map((p) => ({ x: (p.xTE - 0.25 * o.rootChord) * 1000, y: yOff - p.y * 1000 })),
  ];
  polys.push({ layer: 'PLANFORM_HALF', pts: plan, closed: true });
  const th = Math.max(2, crMM * 0.04);
  texts.push(
    text(
      'NOTES',
      -0.25 * crMM,
      0.25 * crMM,
      th,
      `${o.name} - root chord ${crMM.toFixed(1)} mm (quarter chord at x=0)`,
    ),
  );
  texts.push(
    text(
      'NOTES',
      -0.25 * crMM,
      yOff + th * 1.5,
      th,
      `Half planform: semi-span ${(o.span * 500).toFixed(1)} mm`,
    ),
  );
  const out: string[] = [
    '0',
    'SECTION',
    '2',
    'HEADER',
    '9',
    '$ACADVER',
    '1',
    'AC1009',
    '9',
    '$INSUNITS',
    '70',
    '4',
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'TABLES',
    ...layerTable([
      { name: 'ROOT_SECTION', color: 5 },
      { name: 'TIP_SECTION', color: 3 },
      { name: 'PLANFORM_HALF', color: 7 },
      { name: 'NOTES', color: 8 },
    ]),
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    ...polys.flatMap(polyline),
    ...texts.flat(),
    '0',
    'ENDSEC',
    '0',
    'EOF',
  ];
  return out.join('\r\n') + '\r\n';
}
