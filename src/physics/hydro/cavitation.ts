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
 * Speed at which cavitation starts while carrying a fixed lift.
 * cpMinAtSpeed(V) must give the minimum Cp at the section cl needed at speed V.
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
  if (f(vHi) > 0) return null; // no inception in range
  if (f(vLo) < 0) return vLo;
  const r = brent(f, vLo, vHi, 1e-6);
  return r.converged ? r.x : null;
}
