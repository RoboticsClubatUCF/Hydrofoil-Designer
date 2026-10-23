/** Scaled section outlines for export. Units: millimetres. */
import type { ParsedProfile, Pt } from '../physics/profile/parse';

/** Closed outline (Selig order) scaled to `chord` metres, returned in mm, with the
 * quarter-chord point at x = 0 so root and tip sections stack for lofting. */
export function scaledSection(p: ParsedProfile, chordM: number): Pt[] {
  const c = chordM * 1000;
  const loop = [...p.upper].reverse().concat(p.lower.slice(1));
  return loop.map((q) => ({ x: (q.x - 0.25) * c, y: q.y * c }));
}
