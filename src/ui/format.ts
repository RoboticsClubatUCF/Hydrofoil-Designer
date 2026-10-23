import { fmt, fromSI, type Unit } from '../physics/units';
import { VAR } from '../solver/variables';

/** Value in a display unit, as plain text for an input box (no unit). */
export function displayNumber(si: number, unit: Unit, id?: string): string {
  if (si === Infinity) return '∞';
  if (!Number.isFinite(si)) return '';
  const v = fromSI(si, unit);
  if (id && VAR[id]?.sci) return fmtSci(v);
  return fmt(v, 4);
}

/** Parse a number typed by the user (accepts commas as decimal separators and e-notation). */
export function parseTyped(text: string): number | null {
  const t = text.trim().replace(/\s/g, '').replace(',', '.');
  if (!t) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : NaN;
}

export function download(name: string, content: string, type = 'text/plain') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'foil'
  );
}

export function scrollToVar(id: string) {
  const el = document.getElementById(`field-${id}`);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
}

const SUP: Record<string, string> = {
  '-': '⁻',
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
};
/** 797159 → "7.97×10⁵" */
export function fmtSci(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return '—';
  const [m, e] = v.toExponential(digits).split('e');
  return `${m}×10${String(Number(e))
    .split('')
    .map((c) => SUP[c] ?? c)
    .join('')}`;
}
