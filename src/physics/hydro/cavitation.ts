/**
 * Cavitation check. Cavitation starts where local pressure falls to the vapour
 * pressure, i.e. where −Cp_min exceeds the cavitation number
 *
 *   σ = (p_atm + ρ g h − p_v) / (½ ρ V²)
 *
 * Margin = σ + Cp_min (positive = no cavitation predicted).
 */
import { brent } from '../numeric';

export function cavitationNumber(
  pAtm: number,
  rho: number,
  g: number,
  depth: number,
  pv: number,
  V: number,
): number {
  return (pAtm + rho * g * depth - pv) / (0.5 * rho * V * V);
}

/**
 * Speed at which cavitation starts while carrying a fixed lift: the top of the
 * cavitation-free speed range. cpMinAtSpeed(V) must give the minimum Cp at the
 * section cl needed at speed V.
 *
 * At constant lift the margin can also turn negative at low speed, where the
 * high cl gives a strong suction peak, so the margin may cross zero more than
 * once. Speeds are scanned downward from vHi in ~3 % steps and the highest
 * crossing is refined with Brent's method. Returns vLo if the margin is
 * negative at every scanned speed.
 */
export function cavitationInceptionSpeed(
  pAtm: number,
  rho: number,
  g: number,
  depth: number,
  pv: number,
  cpMinAtSpeed: (V: number) => number,
  vLo = 0.5,
  vHi = 80,
): number | null {
  const f = (V: number) => cavitationNumber(pAtm, rho, g, depth, pv, V) + cpMinAtSpeed(V);
  if (!(vLo < vHi)) return null;
  if (f(vHi) > 0) return null; // no inception in range
  const n = Math.ceil(Math.log(vHi / vLo) / 0.03);
  let above = vHi;
  for (let i = 1; i <= n; i++) {
    const V = i === n ? vLo : vHi * Math.pow(vLo / vHi, i / n);
    if (f(V) > 0) {
      const r = brent(f, V, above, 1e-6);
      return r.converged ? r.x : null;
    }
    above = V;
  }
  return vLo;
}
