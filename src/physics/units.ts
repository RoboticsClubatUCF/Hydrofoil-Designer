/**
 * Units and quantities. Every value is stored internally in SI; units only
 * affect what the user types and sees.
 */

export type Quantity =
  | 'length'
  | 'smallLength'
  | 'area'
  | 'speed'
  | 'force'
  | 'mass'
  | 'angle'
  | 'pressure'
  | 'stress'
  | 'modulus'
  | 'power'
  | 'density'
  | 'kinViscosity'
  | 'temperature'
  | 'moment'
  | 'salinity'
  | 'ratio'
  | 'percent'
  | 'perAngle'
  | 'none';

export interface Unit {
  id: string;
  label: string;
  /** SI value = value * factor + offset */
  factor: number;
  offset?: number;
}

export const UNITS: Record<Quantity, Unit[]> = {
  length: [
    { id: 'm', label: 'm', factor: 1 },
    { id: 'cm', label: 'cm', factor: 0.01 },
    { id: 'mm', label: 'mm', factor: 0.001 },
    { id: 'in', label: 'in', factor: 0.0254 },
    { id: 'ft', label: 'ft', factor: 0.3048 },
  ],
  smallLength: [
    { id: 'mm', label: 'mm', factor: 0.001 },
    { id: 'cm', label: 'cm', factor: 0.01 },
    { id: 'm', label: 'm', factor: 1 },
    { id: 'in', label: 'in', factor: 0.0254 },
  ],
  area: [
    { id: 'm2', label: 'm²', factor: 1 },
    { id: 'cm2', label: 'cm²', factor: 1e-4 },
    { id: 'in2', label: 'in²', factor: 0.00064516 },
    { id: 'ft2', label: 'ft²', factor: 0.09290304 },
  ],
  speed: [
    { id: 'm/s', label: 'm/s', factor: 1 },
    { id: 'km/h', label: 'km/h', factor: 1 / 3.6 },
    { id: 'kn', label: 'knots', factor: 1852 / 3600 },
    { id: 'mph', label: 'mph', factor: 0.44704 },
  ],
  force: [
    { id: 'N', label: 'N', factor: 1 },
    { id: 'kN', label: 'kN', factor: 1000 },
    { id: 'kgf', label: 'kgf', factor: 9.80665 },
    { id: 'lbf', label: 'lbf', factor: 4.4482216152605 },
  ],
  mass: [
    { id: 'kg', label: 'kg', factor: 1 },
    { id: 'g', label: 'g', factor: 0.001 },
    { id: 'lb', label: 'lb', factor: 0.45359237 },
  ],
  angle: [
    { id: 'deg', label: '°', factor: Math.PI / 180 },
    { id: 'rad', label: 'rad', factor: 1 },
  ],
  pressure: [
    { id: 'kPa', label: 'kPa', factor: 1000 },
    { id: 'Pa', label: 'Pa', factor: 1 },
    { id: 'bar', label: 'bar', factor: 1e5 },
    { id: 'psi', label: 'psi', factor: 6894.757293168 },
  ],
  stress: [
    { id: 'MPa', label: 'MPa', factor: 1e6 },
    { id: 'kPa', label: 'kPa', factor: 1000 },
    { id: 'psi', label: 'psi', factor: 6894.757293168 },
    { id: 'ksi', label: 'ksi', factor: 6894757.293168 },
  ],
  modulus: [
    { id: 'GPa', label: 'GPa', factor: 1e9 },
    { id: 'MPa', label: 'MPa', factor: 1e6 },
    { id: 'Msi', label: 'Msi', factor: 6894757293.168 },
  ],
  power: [
    { id: 'W', label: 'W', factor: 1 },
    { id: 'kW', label: 'kW', factor: 1000 },
    { id: 'hp', label: 'hp', factor: 745.69987158227 },
  ],
  density: [
    { id: 'kg/m3', label: 'kg/m³', factor: 1 },
    { id: 'lb/ft3', label: 'lb/ft³', factor: 16.01846337396 },
  ],
  kinViscosity: [
    { id: 'cSt', label: 'mm²/s', factor: 1e-6 },
    { id: 'm2/s', label: 'm²/s', factor: 1 },
  ],
  temperature: [
    { id: 'C', label: '°C', factor: 1 },
    { id: 'F', label: '°F', factor: 5 / 9, offset: -32 * (5 / 9) },
  ],
  moment: [
    { id: 'Nm', label: 'N·m', factor: 1 },
    { id: 'lbf.ft', label: 'lbf·ft', factor: 1.3558179483314 },
    { id: 'lbf.in', label: 'lbf·in', factor: 0.1129848290276 },
  ],
  salinity: [{ id: 'g/kg', label: 'g/kg', factor: 1 }],
  ratio: [{ id: '-', label: '', factor: 1 }],
  percent: [{ id: '%', label: '%', factor: 0.01 }],
  perAngle: [
    { id: '/rad', label: '/rad', factor: 1 },
    { id: '/deg', label: '/°', factor: 180 / Math.PI },
  ],
  none: [{ id: '-', label: '', factor: 1 }],
};

/** Preferred display unit for each quantity in each unit system. */
export const SYSTEM_DEFAULTS: Record<'SI' | 'US', Partial<Record<Quantity, string>>> = {
  SI: {
    length: 'm',
    smallLength: 'mm',
    area: 'm2',
    speed: 'm/s',
    force: 'N',
    mass: 'kg',
    angle: 'deg',
    pressure: 'kPa',
    stress: 'MPa',
    modulus: 'GPa',
    power: 'W',
    density: 'kg/m3',
    kinViscosity: 'cSt',
    temperature: 'C',
    moment: 'Nm',
  },
  US: {
    length: 'ft',
    smallLength: 'in',
    area: 'ft2',
    speed: 'kn',
    force: 'lbf',
    mass: 'lb',
    angle: 'deg',
    pressure: 'psi',
    stress: 'ksi',
    modulus: 'Msi',
    power: 'hp',
    density: 'lb/ft3',
    kinViscosity: 'cSt',
    temperature: 'F',
    moment: 'lbf.ft',
  },
};

export function getUnit(q: Quantity, id?: string): Unit {
  const list = UNITS[q];
  return list.find((u) => u.id === id) ?? list[0];
}

export function toSI(value: number, unit: Unit): number {
  return value * unit.factor + (unit.offset ?? 0);
}

export function fromSI(value: number, unit: Unit): number {
  return (value - (unit.offset ?? 0)) / unit.factor;
}

/** SI unit label used inside worked calculations. */
export const SI_LABEL: Record<Quantity, string> = {
  length: 'm',
  smallLength: 'm',
  area: 'm²',
  speed: 'm/s',
  force: 'N',
  mass: 'kg',
  angle: 'rad',
  pressure: 'Pa',
  stress: 'Pa',
  modulus: 'Pa',
  power: 'W',
  density: 'kg/m³',
  kinViscosity: 'm²/s',
  temperature: '°C',
  moment: 'N·m',
  salinity: 'g/kg',
  ratio: '',
  percent: '',
  perAngle: '/rad',
  none: '',
};

/** Format a number with a sensible number of significant figures. */
export function fmt(value: number, sig = 4): string {
  if (!Number.isFinite(value)) return value > 0 ? '∞' : value < 0 ? '−∞' : '—';
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1e6 || abs < 1e-4) {
    const [m, e] = value.toExponential(sig - 1).split('e');
    return `${trimZeros(m)}×10^${Number(e)}`;
  }
  const digits = Math.max(0, sig - 1 - Math.floor(Math.log10(abs)));
  return trimZeros(value.toFixed(Math.min(digits, 10)));
}

function trimZeros(s: string): string {
  if (!s.includes('.')) return s;
  return s.replace(/0+$/, '').replace(/\.$/, '');
}

/** Format for display with unit conversion, e.g. "0.82 m". */
export function fmtQ(valueSI: number, q: Quantity, unitId?: string, sig = 4): string {
  const u = getUnit(q, unitId);
  const v = fromSI(valueSI, u);
  return u.label ? `${fmt(v, sig)} ${u.label}` : fmt(v, sig);
}
