/**
 * Parser for airfoil coordinate files as published by airfoiltools.com and the
 * UIUC database. Two layouts are recognised automatically:
 *
 * Lednicer:  name / "NU. NL." counts / upper surface LE→TE / lower surface LE→TE
 * Selig:     name / one loop TE → upper → LE → lower → TE
 */

export interface Pt {
  x: number;
  y: number;
}

export type ProfileFormat = 'lednicer' | 'selig';

export interface ParsedProfile {
  name: string;
  format: ProfileFormat;
  /** Upper surface from leading edge to trailing edge, unit chord. */
  upper: Pt[];
  /** Lower surface from leading edge to trailing edge, unit chord. */
  lower: Pt[];
  /** Original point count as read from the file. */
  pointCount: number;
  warnings: string[];
}

export class ProfileParseError extends Error {}

const NUM = /^[+-]?(\d+\.?\d*|\.\d+)([eEdD][+-]?\d+)?$/;

function numbersIn(line: string): number[] | null {
  const tokens = line
    .trim()
    .split(/[\s,;]+/)
    .filter(Boolean);
  if (tokens.length < 2) return null;
  if (!NUM.test(tokens[0]) || !NUM.test(tokens[1])) return null;
  return tokens.slice(0, 2).map((t) => Number(t.replace(/[dD]/, 'e')));
}

export function parseProfile(text: string): ParsedProfile {
  const warnings: string[] = [];
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let name = '';
  // Groups of numeric lines separated by blank lines (blank lines matter for Lednicer).
  const rows: { v: number[]; group: number }[] = [];
  let group = 0;
  let lastWasBlank = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) {
      lastWasBlank = true;
      continue;
    }
    const nums = numbersIn(line);
    if (!nums) {
      if (rows.length === 0 && !name) name = line;
      else if (rows.length > 0)
        warnings.push(`Ignored a line that isn't a coordinate pair: "${line.slice(0, 40)}"`);
      continue;
    }
    if (lastWasBlank && rows.length > 0) group++;
    lastWasBlank = false;
    rows.push({ v: nums, group });
  }
  if (rows.length < 6)
    throw new ProfileParseError('Not enough coordinate pairs found — paste the whole .dat file.');

  let upper: Pt[];
  let lower: Pt[];
  let format: ProfileFormat;
  const [c0, c1] = rows[0].v;
  // Lednicer count line: two whole numbers that are not themselves a coordinate
  // (they lie far outside the x-range of the remaining points).
  let maxRestX = -Infinity;
  for (const r of rows.slice(1)) maxRestX = Math.max(maxRestX, r.v[0]);
  const looksLikeCounts =
    Number.isInteger(c0) &&
    Number.isInteger(c1) &&
    c0 >= 3 &&
    c1 >= 3 &&
    (c0 > 1.5 * maxRestX || Math.abs(c0 + c1 - (rows.length - 1)) <= 1);

  if (looksLikeCounts) {
    format = 'lednicer';
    const nu = c0,
      nl = c1;
    const pts = rows.slice(1).map((r) => ({ x: r.v[0], y: r.v[1] }));
    if (pts.length >= nu + nl) {
      upper = pts.slice(0, nu);
      lower = pts.slice(nu, nu + nl);
      if (pts.length > nu + nl)
        warnings.push('File has more points than its header counts; extra points ignored.');
    } else {
      // Counts disagree; fall back to splitting where x jumps back to the leading edge.
      warnings.push(
        'Point counts in the header do not match the data; split surfaces at the leading edge instead.',
      );
      const split = findReset(pts);
      upper = pts.slice(0, split);
      lower = pts.slice(split);
    }
  } else {
    const pts = rows.map((r) => ({ x: r.v[0], y: r.v[1] }));
    // A Lednicer file without the counts line: two LE→TE runs.
    const reset = findReset(pts);
    if (
      reset > 0 &&
      pts[0].x < pts[reset - 1].x &&
      Math.abs(pts[0].x - pts[reset].x) < 0.05 * spanX(pts)
    ) {
      format = 'lednicer';
      upper = pts.slice(0, reset);
      lower = pts.slice(reset);
      warnings.push(
        'No point-count line found; read as two leading-edge-to-trailing-edge surfaces.',
      );
    } else {
      format = 'selig';
      let iLE = 0;
      for (let i = 1; i < pts.length; i++) if (pts[i].x < pts[iLE].x) iLE = i;
      upper = pts.slice(0, iLE + 1).reverse();
      lower = pts.slice(iLE);
    }
  }

  // Make sure "upper" really is the upper surface.
  if (meanY(upper) < meanY(lower)) {
    [upper, lower] = [lower, upper];
    warnings.push('Surfaces were listed lower-first; swapped them.');
  }

  const pointCount = upper.length + lower.length;
  ({ upper, lower } = normalise(upper, lower, warnings));
  validate(upper, lower);
  return { name: name || 'Unnamed section', format, upper, lower, pointCount, warnings };
}

function spanX(pts: Pt[]): number {
  let lo = Infinity,
    hi = -Infinity;
  for (const p of pts) {
    lo = Math.min(lo, p.x);
    hi = Math.max(hi, p.x);
  }
  return hi - lo || 1;
}

function findReset(pts: Pt[]): number {
  // first index where x drops sharply (start of second surface)
  const span = spanX(pts);
  for (let i = 1; i < pts.length; i++) if (pts[i].x < pts[i - 1].x - 0.5 * span) return i;
  return -1;
}

function meanY(pts: Pt[]): number {
  return pts.reduce((s, p) => s + p.y, 0) / pts.length;
}

function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-9) out.push(p);
  }
  return out;
}

/** Translate, de-rotate and scale so the leading edge is (0,0) and the trailing edge (1,0). */
function normalise(upper: Pt[], lower: Pt[], warnings: string[]) {
  upper = dedupe(upper);
  lower = dedupe(lower);
  // Leading edge: share a common point if the two surfaces start apart.
  const u0 = upper[0],
    l0 = lower[0];
  let le: Pt;
  if (Math.hypot(u0.x - l0.x, u0.y - l0.y) < 1e-9) le = u0;
  else {
    le = u0.x <= l0.x ? u0 : l0;
    if (le === u0) lower = [u0, ...lower];
    else upper = [l0, ...upper];
  }
  const ut = upper[upper.length - 1],
    lt = lower[lower.length - 1];
  const te = { x: (ut.x + lt.x) / 2, y: (ut.y + lt.y) / 2 };
  const dx = te.x - le.x,
    dy = te.y - le.y;
  const chord = Math.hypot(dx, dy);
  if (!(chord > 0))
    throw new ProfileParseError('Leading and trailing edge coincide — check the coordinates.');
  const ang = Math.atan2(dy, dx);
  const needs = Math.abs(chord - 1) > 1e-3 || Math.abs(ang) > 1e-4 || Math.hypot(le.x, le.y) > 1e-4;
  if (needs) {
    const parts: string[] = [];
    if (Math.abs(chord - 1) > 1e-3) parts.push(`scaled by 1/${chord.toPrecision(4)}`);
    if (Math.abs(ang) > 1e-4) parts.push(`rotated ${((ang * 180) / Math.PI).toFixed(2)}°`);
    if (Math.hypot(le.x, le.y) > 1e-4) parts.push('shifted');
    warnings.push(`Coordinates normalised to unit chord (${parts.join(', ')}).`);
  }
  const c = Math.cos(-ang),
    s = Math.sin(-ang);
  const tf = (p: Pt): Pt => {
    const x = p.x - le.x,
      y = p.y - le.y;
    return { x: (x * c - y * s) / chord, y: (x * s + y * c) / chord };
  };
  return { upper: upper.map(tf), lower: lower.map(tf) };
}

function validate(upper: Pt[], lower: Pt[]) {
  if (upper.length < 5 || lower.length < 5)
    throw new ProfileParseError('Each surface needs at least 5 points.');
  for (const [surf, label] of [
    [upper, 'upper'],
    [lower, 'lower'],
  ] as const) {
    for (let i = 1; i < surf.length; i++) {
      if (surf[i].x < surf[i - 1].x - 0.02)
        throw new ProfileParseError(
          `The ${label} surface doubles back in x near x = ${surf[i].x.toFixed(3)} — check the point order.`,
        );
    }
  }
  // Surfaces must not cross (allowing tiny overlap at the trailing edge).
  const xs = Array.from({ length: 19 }, (_, i) => 0.05 + i * 0.05);
  for (const x of xs) {
    const yu = yAt(upper, x),
      yl = yAt(lower, x);
    if (yu < yl - 1e-4)
      throw new ProfileParseError(`Upper and lower surfaces cross near x = ${x.toFixed(2)}.`);
  }
}

function yAt(surf: Pt[], x: number): number {
  for (let i = 1; i < surf.length; i++) {
    if (surf[i].x >= x) {
      const a = surf[i - 1],
        b = surf[i];
      const t = (x - a.x) / (b.x - a.x || 1);
      return a.y + t * (b.y - a.y);
    }
  }
  return surf[surf.length - 1].y;
}

/** Re-serialise a parsed profile in Selig format (useful for exports). */
export function toSelig(p: { name: string; upper: Pt[]; lower: Pt[] }): string {
  const lines = [p.name];
  for (const q of [...p.upper].reverse()) lines.push(`${q.x.toFixed(6)}  ${q.y.toFixed(6)}`);
  for (const q of p.lower.slice(1)) lines.push(`${q.x.toFixed(6)}  ${q.y.toFixed(6)}`);
  return lines.join('\n');
}
