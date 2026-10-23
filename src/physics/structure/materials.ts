/** Typical properties for solid foil materials (room temperature, nominal values). */
export interface Material {
  id: string;
  name: string;
  E: number; // Pa
  yieldStrength: number; // Pa (or design strength for composites and prints)
  density: number; // kg/m³
  note?: string;
}

export const MATERIALS: Material[] = [
  { id: 'al6061', name: 'Aluminium 6061-T6', E: 68.9e9, yieldStrength: 276e6, density: 2700 },
  { id: 'al7075', name: 'Aluminium 7075-T6', E: 71.7e9, yieldStrength: 503e6, density: 2810 },
  {
    id: 'ss316',
    name: 'Stainless steel 316',
    E: 193e9,
    yieldStrength: 205e6,
    density: 8000,
    note: 'Annealed bar',
  },
  { id: 'ti64', name: 'Titanium Ti-6Al-4V', E: 113.8e9, yieldStrength: 880e6, density: 4430 },
  {
    id: 'cfrp',
    name: 'Carbon fibre / epoxy (UD-rich layup)',
    E: 100e9,
    yieldStrength: 600e6,
    density: 1550,
    note: 'Layup dependent; strength is a conservative design value',
  },
  {
    id: 'gfrp',
    name: 'Glass fibre / epoxy',
    E: 25e9,
    yieldStrength: 300e6,
    density: 1900,
    note: 'Layup dependent; strength is a conservative design value',
  },
  {
    id: 'pla',
    name: 'PLA (3D printed, 100% infill)',
    E: 3.5e9,
    yieldStrength: 50e6,
    density: 1240,
    note: 'Print orientation matters',
  },
  {
    id: 'petg',
    name: 'PETG (3D printed, 100% infill)',
    E: 2.1e9,
    yieldStrength: 45e6,
    density: 1270,
    note: 'Print orientation matters',
  },
  {
    id: 'cfnylon',
    name: 'Carbon-filled nylon (printed)',
    E: 6e9,
    yieldStrength: 70e6,
    density: 1200,
  },
];

export function materialById(id: string): Material | undefined {
  return MATERIALS.find((m) => m.id === id);
}
