/**
 * Ambient sea for the 3-D view: a JONSWAP spectrum (γ = 3.3) with cos² spreading,
 * represented by a handful of linear (Airy) deep-water wave components.
 * Direction 0° = head seas (waves running towards the craft), 180° = following.
 * In the foil's frame each component is met at ω_e = ω + U kx.
 */
import { G } from '../physics/fluid';

export interface WaveComponent {
  kx: number;
  ky: number;
  /** amplitude, m */
  a: number;
  /** intrinsic angular frequency, rad/s */
  omega: number;
  phase0: number;
}

/** Typical peak period for a wind sea of this height (fully developed), s. */
export const defaultPeakPeriod = (Hs: number) => Math.max(1.2, 4.2 * Math.sqrt(Math.max(Hs, 0.01)));

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seaComponents(
  Hs: number,
  Tp: number,
  dirDeg: number,
  n = 16,
  seed = 7,
): WaveComponent[] {
  if (!(Hs > 0)) return [];
  const wp = (2 * Math.PI) / Tp;
  const gamma = 3.3;
  const S = (w: number) => {
    const sig = w <= wp ? 0.07 : 0.09;
    const r = Math.exp(-((w - wp) ** 2) / (2 * sig * sig * wp * wp));
    return ((G * G) / w ** 5) * Math.exp(-1.25 * (wp / w) ** 4) * Math.pow(gamma, r);
  };
  const w0 = 0.75 * wp,
    w1 = 2.6 * wp;
  const dw = (w1 - w0) / n;
  const rand = rng(seed);
  const comps: WaveComponent[] = [];
  let m0 = 0;
  for (let i = 0; i < n; i++) {
    const w = w0 + (i + 0.3 + 0.4 * rand()) * dw;
    const a = Math.sqrt(2 * S(w) * dw);
    m0 += (a * a) / 2;
    // direction drawn from cos² spreading (±90°) by rejection
    let th = 0;
    for (let k = 0; k < 50; k++) {
      th = (rand() - 0.5) * Math.PI;
      if (rand() < Math.cos(th) ** 2) break;
    }
    const dir = (dirDeg * Math.PI) / 180 + 0.6 * th;
    const k = (w * w) / G;
    comps.push({
      kx: k * Math.cos(dir),
      ky: k * Math.sin(dir),
      a,
      omega: w,
      phase0: 2 * Math.PI * rand(),
    });
  }
  // scale to the requested significant height, Hs = 4√m₀
  const f = Hs / (4 * Math.sqrt(m0));
  for (const c of comps) c.a *= f;
  return comps;
}

/** Elevation and orbital velocity of the sea at a point (foil frame), for gust read-outs. */
export function seaAt(
  comps: WaveComponent[],
  phases: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
): { eta: number; u: number; w: number } {
  let eta = 0,
    u = 0,
    w = 0;
  comps.forEach((c, i) => {
    const k = Math.hypot(c.kx, c.ky);
    const th = c.kx * x + c.ky * y - phases[i];
    const e = c.a * c.omega * Math.exp(k * Math.min(z, 0));
    eta += c.a * Math.cos(th);
    u += (e * Math.cos(th) * c.kx) / k;
    w += e * Math.sin(th);
  });
  return { eta, u, w };
}
