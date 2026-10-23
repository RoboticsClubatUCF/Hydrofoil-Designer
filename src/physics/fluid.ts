/**
 * Water properties at atmospheric pressure.
 *
 * - Pure-water density: Kell (1975), 0–100 °C.
 * - Pure-water viscosity and seawater corrections: Sharqawy, Lienhard & Zubair,
 *   "Thermophysical properties of seawater", Desalination & Water Treatment 16 (2010).
 * - Vapour pressure: Buck (1996) over liquid water, with the Sharqawy (2010)
 *   Raoult-type salinity correction.
 */

export const G = 9.80665; // m/s², standard gravity
export const P_ATM = 101325; // Pa, standard atmosphere

export type WaterType = 'fresh' | 'brackish' | 'salt' | 'custom';

/** Salinity in g/kg for each preset. */
export const WATER_SALINITY: Record<Exclude<WaterType, 'custom'>, number> = {
  fresh: 0,
  brackish: 15,
  salt: 35,
};

/** Pure water density, kg/m³ (Kell 1975). T in °C. */
export function pureWaterDensity(T: number): number {
  return (
    (999.83952 +
      16.945176 * T -
      7.9870401e-3 * T ** 2 -
      46.170461e-6 * T ** 3 +
      105.56302e-9 * T ** 4 -
      280.54253e-12 * T ** 5) /
    (1 + 16.87985e-3 * T)
  );
}

/** Water density, kg/m³. T in °C, salinity in g/kg. */
export function waterDensity(T: number, salinityGkg: number): number {
  const S = salinityGkg / 1000;
  const rw = pureWaterDensity(T);
  if (S === 0) return rw;
  const b1 = 8.02e2,
    b2 = -2.001,
    b3 = 1.677e-2,
    b4 = -3.06e-5,
    b5 = -1.613e-5;
  return rw + S * (b1 + b2 * T + b3 * T ** 2 + b4 * T ** 3 + b5 * S * T ** 2);
}

/** Dynamic viscosity, Pa·s. */
export function waterDynamicViscosity(T: number, salinityGkg: number): number {
  const muW = 4.2844e-5 + 1 / (0.157 * (T + 64.993) ** 2 - 91.296);
  const S = salinityGkg / 1000;
  if (S === 0) return muW;
  const A = 1.541 + 1.998e-2 * T - 9.52e-5 * T ** 2;
  const B = 7.974 - 7.561e-2 * T + 4.724e-4 * T ** 2;
  return muW * (1 + A * S + B * S ** 2);
}

/** Kinematic viscosity, m²/s. */
export function waterKinematicViscosity(T: number, salinityGkg: number): number {
  return waterDynamicViscosity(T, salinityGkg) / waterDensity(T, salinityGkg);
}

/** Vapour pressure, Pa. */
export function waterVapourPressure(T: number, salinityGkg: number): number {
  const pw = 611.21 * Math.exp((18.678 - T / 234.5) * (T / (257.14 + T)));
  const S = salinityGkg;
  if (S === 0) return pw;
  return pw / (1 + 0.57357 * (S / (1000 - S)));
}
