/**
 * Velocity anywhere in the water for a FlowState (the CPU twin of the particle
 * shader): free stream + vortex segments (with images) + each foil's section
 * near field. Used for streamlines and for checking the shader.
 */
import { NEAR_R0, NEAR_R1, PROFILE_SAMPLES, smoothstep } from './nearField';
import type { FlowFoil, FlowState } from './types';
import { addSegmentVelocity } from './vortex';

const K = 1 / (2 * Math.PI);

/** Distance beyond the tip over which the section near field fades out, m. */
export function tipFadeLength(f: FlowFoil, nStation: number): number {
  return 0.25 * Math.max(f.st[4 * (nStation - 1)], 0.05 * f.cr);
}

function station(f: FlowFoil, M: number, eta: number, out: number[]) {
  const s = Math.min(1, Math.max(0, eta)) * (M - 1);
  const j0 = Math.min(M - 2, Math.floor(s));
  const t = s - j0;
  for (let k = 0; k < 4; k++)
    out[k] = f.st[4 * j0 + k] + (f.st[4 * (j0 + 1) + k] - f.st[4 * j0 + k]) * t;
}

function insideProfile(f: FlowFoil, xi: number, ze: number): boolean {
  const x = xi + 0.25;
  if (x < 0 || x > 1) return false;
  const s = Math.sqrt(x) * (PROFILE_SAMPLES - 1);
  const k0 = Math.min(PROFILE_SAMPLES - 2, Math.floor(s));
  const t = s - k0;
  const yu = f.profU[k0] + (f.profU[k0 + 1] - f.profU[k0]) * t;
  const yl = f.profL[k0] + (f.profL[k0 + 1] - f.profL[k0]) * t;
  return ze <= yu && ze >= yl;
}

/**
 * Near-field velocity of one foil at a point (adds to out); returns true when
 * the point is inside the foil.
 */
export function addNearField(
  f: FlowFoil,
  M: number,
  px: number,
  py: number,
  pz: number,
  out: Float64Array | number[],
): boolean {
  const half = f.b / 2;
  const ay = Math.abs(py);
  const over = ay - half;
  const tipLen = tipFadeLength(f, M);
  if (over > tipLen) return false;
  const st = [0, 0, 0, 0];
  station(f, M, ay / half, st);
  const [c, a0, a90, G] = st;
  const cp = Math.cos(f.pitch),
    sp = Math.sin(f.pitch);
  const dx = px - f.x0,
    dz = pz - f.z0;
  const xi = (dx * cp - dz * sp) / c;
  const ze = (dx * sp + dz * cp) / c;
  const r2 = xi * xi + ze * ze;
  if (r2 > NEAR_R1 * NEAR_R1) return false;
  const inside = over <= 0 && insideProfile(f, xi, ze);
  const n = f.nodes.length / 2;
  let u = 0,
    w = 0;
  let ax = f.nodes[0],
    az = f.nodes[1];
  let ga = a0 * f.g0[0] + a90 * f.g90[0];
  for (let j = 0; j < n - 1; j++) {
    const bx = f.nodes[2 * j + 2],
      bz = f.nodes[2 * j + 3];
    const gb = a0 * f.g0[j + 1] + a90 * f.g90[j + 1];
    const ddx = bx - ax,
      ddz = bz - az;
    const l = Math.hypot(ddx, ddz);
    if (l > 1e-12) {
      const tx = ddx / l,
        tz = ddz / l;
      const rx = xi - ax,
        rz = ze - az;
      const xl = rx * tx + rz * tz;
      const zl = -rx * tz + rz * tx;
      let I0 = Math.atan2(zl, xl - l) - Math.atan2(zl, xl);
      if (I0 > Math.PI) I0 -= 2 * Math.PI;
      if (I0 < -Math.PI) I0 += 2 * Math.PI;
      const I1 =
        0.5 * Math.log((xl * xl + zl * zl + 1e-30) / ((xl - l) * (xl - l) + zl * zl + 1e-30));
      const J0 = xl * I0 - zl * I1;
      const J1 = xl * I1 - l + zl * I0;
      const ul = -K * ((I0 - J0 / l) * ga + (J0 / l) * gb);
      const wl = K * ((I1 - J1 / l) * ga + (J1 / l) * gb);
      u += ul * tx - wl * tz;
      w += ul * tz + wl * tx;
    }
    ax = bx;
    az = bz;
    ga = gb;
  }
  const rr = Math.max(r2, 1e-12);
  u += (G * K * ze) / rr;
  w -= (G * K * xi) / rr;
  const fade =
    (1 - smoothstep(NEAR_R0, NEAR_R1, Math.sqrt(r2))) * (1 - smoothstep(0, tipLen, over));
  u *= fade;
  w *= fade;
  out[0] += u * cp + w * sp;
  out[2] += -u * sp + w * cp;
  return inside;
}

/** Total velocity at (x, y, z); returns true if the point is inside a foil. */
export function velocityAt(
  s: FlowState,
  x: number,
  y: number,
  z: number,
  out: Float64Array | number[],
): boolean {
  out[0] = s.V;
  out[1] = 0;
  out[2] = 0;
  addSegmentVelocity(s.segs, s.nSeg, x, y, z, out);
  let inside = false;
  for (const f of s.foils) if (addNearField(f, s.nStation, x, y, z, out)) inside = true;
  return inside;
}

/** Pressure coefficient from Bernoulli in the foil's frame (steady, irrotational). */
export function cpAt(s: FlowState, v: ArrayLike<number>): number {
  return 1 - (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) / (s.V * s.V);
}

export interface Streamline {
  /** x y z triplets */
  pts: Float32Array;
  /** Cp at each point */
  cp: Float32Array;
}

/** Trace a streamline downstream from a seed with RK4 and a step that grows away from the foils. */
export function traceStreamline(
  s: FlowState,
  seed: [number, number, number],
  xEnd: number,
  maxSteps = 900,
): Streamline {
  const pts: number[] = [];
  const cps: number[] = [];
  const v = [0, 0, 0];
  const k1 = [0, 0, 0],
    k2 = [0, 0, 0],
    k3 = [0, 0, 0],
    k4 = [0, 0, 0];
  let [x, y, z] = seed;
  const cMin = Math.min(...s.foils.map((f) => f.cr));
  for (let i = 0; i < maxSteps; i++) {
    const inside = velocityAt(s, x, y, z, v);
    pts.push(x, y, z);
    cps.push(cpAt(s, v));
    if (inside || x > xEnd || z > 0) break;
    // step length: fine near a foil, coarser away from it
    let dmin = Infinity;
    for (const f of s.foils) {
      const ay = Math.max(0, Math.abs(y) - f.b / 2);
      dmin = Math.min(dmin, Math.hypot(x - f.x0 - 0.25 * f.cr, ay, z - f.z0));
    }
    const ds = Math.min(0.25 * s.lref, Math.max(0.012 * cMin, 0.08 * dmin));
    const sp = Math.hypot(v[0], v[1], v[2]);
    if (sp < 1e-6) break;
    const h = ds / sp;
    k1[0] = v[0];
    k1[1] = v[1];
    k1[2] = v[2];
    velocityAt(s, x + 0.5 * h * k1[0], y + 0.5 * h * k1[1], z + 0.5 * h * k1[2], k2);
    velocityAt(s, x + 0.5 * h * k2[0], y + 0.5 * h * k2[1], z + 0.5 * h * k2[2], k3);
    velocityAt(s, x + h * k3[0], y + h * k3[1], z + h * k3[2], k4);
    x += (h / 6) * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0]);
    y += (h / 6) * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1]);
    z += (h / 6) * (k1[2] + 2 * k2[2] + 2 * k3[2] + k4[2]);
  }
  return { pts: Float32Array.from(pts), cp: Float32Array.from(cps) };
}
