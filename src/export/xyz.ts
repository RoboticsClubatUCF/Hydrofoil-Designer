/** Point files for CAD spline import (e.g. SolidWorks "Curve Through XYZ Points"). Millimetres. */
import type { ParsedProfile } from '../physics/profile/parse';
import { scaledSection } from './geometry';

/** Section at spanwise station z (m), quarter chord on the z axis; one "x y z" per line. */
export function sectionXyz(p: ParsedProfile, chordM: number, zM: number): string {
  return (
    scaledSection(p, chordM)
      .map((q) => `${q.x.toFixed(4)} ${q.y.toFixed(4)} ${(zM * 1000).toFixed(4)}`)
      .join('\n') + '\n'
  );
}

/** Both sections in one CSV with a header row. */
export function sectionsCsv(
  p: ParsedProfile,
  rootChordM: number,
  tipChordM: number,
  semiSpanM: number,
): string {
  const rows = ['section,x_mm,y_mm,z_mm'];
  for (const q of scaledSection(p, rootChordM))
    rows.push(`root,${q.x.toFixed(4)},${q.y.toFixed(4)},0`);
  if (tipChordM > 1e-6)
    for (const q of scaledSection(p, tipChordM))
      rows.push(`tip,${q.x.toFixed(4)},${q.y.toFixed(4)},${(semiSpanM * 1000).toFixed(4)}`);
  return rows.join('\n') + '\n';
}
