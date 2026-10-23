/** Rendering of relation templates as symbols or as substituted numbers (LaTeX). */
import { G } from '../physics/fluid';
import type { Quantity } from '../physics/units';
import { VAR } from './variables';
import type { Vals } from './types';

const UNIT_TEX: Partial<Record<Quantity, string>> = {
  length: '\\text{m}',
  smallLength: '\\text{m}',
  area: '\\text{m}^2',
  speed: '\\text{m/s}',
  force: '\\text{N}',
  mass: '\\text{kg}',
  angle: '\\text{rad}',
  pressure: '\\text{Pa}',
  stress: '\\text{Pa}',
  modulus: '\\text{Pa}',
  power: '\\text{W}',
  density: '\\text{kg/m}^3',
  kinViscosity: '\\text{m}^2\\text{/s}',
  temperature: '{}^\\circ\\text{C}',
  moment: '\\text{N}\\,\\text{m}',
  salinity: '\\text{g/kg}',
  perAngle: '\\text{rad}^{-1}',
};

const CONSTS: Record<string, { symbol: string; value: string }> = {
  g: { symbol: 'g', value: `${G.toFixed(3)}\\,\\text{m/s}^2` },
  pi: { symbol: '\\pi', value: '\\pi' },
};

/** Number → LaTeX with ~4 significant figures. */
export function texNum(v: number, sig = 4): string {
  if (!Number.isFinite(v)) return v > 0 ? '\\infty' : v < 0 ? '-\\infty' : '\\text{—}';
  if (v === 0) return '0';
  const a = Math.abs(v);
  if (a >= 1e5 || a < 1e-3) {
    const [m, e] = v.toExponential(sig - 1).split('e');
    return `${trim(m)}\\times10^{${Number(e)}}`;
  }
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(a)));
  return trim(v.toFixed(Math.min(digits, 8)));
}

function trim(s: string): string {
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}

/** Value of a variable with its SI unit, for substitutions. */
export function texValue(id: string, v: number): string {
  const def = VAR[id];
  const unit = def ? UNIT_TEX[def.quantity] : undefined;
  const n = texNum(v);
  return unit ? `${n}\\,${unit}` : n;
}

export function texSymbol(id: string): string {
  return VAR[id]?.symbol ?? CONSTS[id]?.symbol ?? id;
}

/**
 * Render a template. In 'symbol' mode placeholders become symbols; in 'value'
 * mode they become numbers (with units) — except ids listed in `keepSymbols`.
 */
export function renderTemplate(
  tpl: string,
  mode: 'symbol' | 'value',
  vals?: Vals,
  keepSymbols: string[] = [],
): string {
  // Ids start with a letter, so LaTeX optional args such as \sqrt[3] are left alone.
  // Each substitution is braced: "\cdot" + "c_r" must not become the command "\cdotc".
  return tpl.replace(/\[([A-Za-z][A-Za-z0-9]*)(\^(\d))?\]/g, (_m, id: string, _p, pow?: string) => {
    if (CONSTS[id]) {
      const c = CONSTS[id];
      const s = mode === 'symbol' ? c.symbol : c.value;
      return pow ? (mode === 'symbol' ? `{${s}}^${pow}` : `\\left(${s}\\right)^${pow}`) : `{${s}}`;
    }
    if (mode === 'symbol' || keepSymbols.includes(id) || !vals || vals[id] === undefined) {
      const s = texSymbol(id);
      return pow ? `{${s}}^${pow}` : `{${s}}`;
    }
    const v = vals[id];
    const t = texValue(id, v);
    const hasUnit = t.includes('\\,');
    if (pow) return hasUnit || v < 0 ? `\\left(${t}\\right)^${pow}` : `{${t}}^${pow}`;
    return v < 0 ? `\\left(${t}\\right)` : `{${t}}`;
  });
}
