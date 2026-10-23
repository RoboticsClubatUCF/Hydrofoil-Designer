/**
 * Polar import: airfoiltools.com CSV ("Polar key,…" header then
 * "Alpha,Cl,Cd,Cdp,Cm,Top_Xtr,Bot_Xtr") and classic XFoil saved polar text.
 */
import { linearFit } from '../numeric';

export interface PolarRow {
  alpha: number; // degrees as in the file
  cl: number;
  cd: number;
  cm: number;
}

export interface Polar {
  label: string;
  Re: number;
  ncrit: number | null;
  rows: PolarRow[];
}

export class PolarParseError extends Error {}

export function parsePolar(text: string, fallbackRe?: number): Polar {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let Re: number | null = null;
  let ncrit: number | null = null;
  let label = '';
  const rows: PolarRow[] = [];
  let cols: string[] | null = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    // airfoiltools CSV metadata
    const kv = line.match(/^([A-Za-z][A-Za-z ]+),\s*(.+)$/);
    if (kv && !/^alpha/i.test(line)) {
      const key = kv[1].trim().toLowerCase();
      const val = kv[2].trim();
      if (key === 'reynolds number') Re = Number(val);
      else if (key === 'ncrit') ncrit = Number(val);
      else if (key === 'polar key' || key === 'airfoil') label = label || val;
      continue;
    }
    // XFoil text metadata: "Mach =   0.000     Re =     0.200 e 6     Ncrit =   9.000"
    const reM = line.match(/Re\s*=\s*([\d.]+)\s*e\s*([+-]?\d+)/i);
    if (reM) Re = Number(reM[1]) * Math.pow(10, Number(reM[2]));
    const ncM = line.match(/Ncrit\s*=\s*([\d.]+)/i);
    if (ncM) ncrit = Number(ncM[1]);
    const forM = line.match(/polar for:\s*(.+)$/i);
    if (forM) label = forM[1].trim();
    if (/^alpha\b/i.test(line)) {
      cols = line
        .toLowerCase()
        .split(/[\s,]+/)
        .filter(Boolean);
      continue;
    }
    if (!cols) continue;
    const parts = line.split(/[\s,]+/).filter(Boolean);
    if (parts.length < 3 || !/^[+-]?[\d.]/.test(parts[0])) continue;
    const get = (name: string) => {
      const i = cols!.indexOf(name);
      return i >= 0 ? Number(parts[i]) : NaN;
    };
    const row = { alpha: get('alpha'), cl: get('cl'), cd: get('cd'), cm: get('cm') };
    if ([row.alpha, row.cl, row.cd].every(Number.isFinite))
      rows.push({ ...row, cm: Number.isFinite(row.cm) ? row.cm : 0 });
  }
  if (!cols)
    throw new PolarParseError(
      'No "Alpha, Cl, Cd …" column header found — paste the full polar CSV.',
    );
  if (rows.length < 5) throw new PolarParseError('Polar has fewer than 5 data rows.');
  if (Re === null || !(Re > 0)) {
    if (fallbackRe && fallbackRe > 0) Re = fallbackRe;
    else throw new PolarParseError('Could not find the Reynolds number in the polar.');
  }
  rows.sort((a, b) => a.alpha - b.alpha);
  return { label: label || `Re ${Re}`, Re, ncrit, rows };
}

export interface PolarSummary {
  Re: number;
  alphaL0: number; // rad
  a0: number; // per rad
  clmax: number;
  alphaStall: number; // rad
  cm0: number;
  /** attached branch, cl ascending */
  branchCl: number[];
  branchCd: number[];
  alphaRange: [number, number]; // deg
}

const D2R = Math.PI / 180;

export function summarisePolar(p: Polar): PolarSummary {
  const r = p.rows;
  let iMax = 0;
  for (let i = 1; i < r.length; i++) if (r[i].cl > r[iMax].cl) iMax = i;
  const clmax = r[iMax].cl;
  let fitPts = r.filter((q) => q.alpha >= -3 && q.alpha <= 5 && q.alpha < r[iMax].alpha);
  if (fitPts.length < 4) fitPts = r.filter((q) => q.cl >= 0 && q.cl <= 0.6 * clmax);
  if (fitPts.length < 2) fitPts = r.slice(0, Math.max(2, iMax));
  const fit = linearFit(
    fitPts.map((q) => q.alpha),
    fitPts.map((q) => q.cl),
  );
  const a0deg = fit.slope;
  const alphaL0deg = -fit.intercept / a0deg;
  // cm near zero lift
  let cm0 = r[0].cm;
  let bestD = Infinity;
  for (const q of r) {
    const d = Math.abs(q.alpha - alphaL0deg);
    if (d < bestD) {
      bestD = d;
      cm0 = q.cm;
    }
  }
  // attached branch: from the minimum-cl row up to clmax, keeping cl increasing
  let iMin = 0;
  for (let i = 0; i < iMax; i++) if (r[i].cl < r[iMin].cl) iMin = i;
  const branchCl: number[] = [],
    branchCd: number[] = [];
  for (let i = iMin; i <= iMax; i++) {
    if (branchCl.length && r[i].cl <= branchCl[branchCl.length - 1]) continue;
    branchCl.push(r[i].cl);
    branchCd.push(r[i].cd);
  }
  return {
    Re: p.Re,
    alphaL0: alphaL0deg * D2R,
    a0: a0deg / D2R,
    clmax,
    alphaStall: r[iMax].alpha * D2R,
    cm0,
    branchCl,
    branchCd,
    alphaRange: [r[0].alpha, r[r.length - 1].alpha],
  };
}
