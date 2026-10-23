/**
 * Water surface: the simulated wave field of the foils (height texture from the
 * surface worker) plus the ambient sea, on a mesh that is fine over the
 * simulated area and stretches out to the horizon. Shaded with Fresnel sky
 * reflection from above and Snell's window from below.
 */
import * as THREE from 'three';
import type { SurfaceGrid } from '../../flow3d/surface';
import { FLOW_GLSL } from './glsl';

const VERT = /* glsl */ `
uniform highp sampler2D tEta;
uniform vec4 uDom;      // Lx, Ly, xUp, has data
uniform vec2 uTexel;
uniform float uExag;
uniform float uAmbFar;
${FLOW_GLSL}
varying vec3 vWorld;
varying vec2 vXY;
varying float vWake;
varying float vFade;
float domFade(vec2 xy) {
  float Lx = uDom.x, Ly = uDom.y, x0 = -uDom.z;
  float f = smoothstep(x0, x0 + 0.06 * Lx, xy.x) * (1.0 - smoothstep(x0 + 0.86 * Lx, x0 + Lx, xy.x));
  return f * (1.0 - smoothstep(0.36 * Ly, 0.5 * Ly, abs(xy.y))) * uDom.w;
}
float wakeAt(vec2 xy) {
  return texture2D(tEta, xy / uDom.xy + 0.5 * uTexel).r * domFade(xy);
}
void main() {
  vec2 xy = vec2(position.x, -position.z);
  vFade = domFade(xy);
  float w = wakeAt(xy);
  float amb = uNWave > 0 ? waveHeight(xy) * (1.0 - smoothstep(0.6 * uAmbFar, uAmbFar, length(xy))) : 0.0;
  vec3 p = vec3(position.x, w * uExag + amb, position.z);
  vWake = w;
  vXY = xy;
  vec4 world = modelMatrix * vec4(p, 1.0);
  vWorld = world.xyz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const FRAG = /* glsl */ `
uniform highp sampler2D tEta;
uniform vec4 uDom;
uniform vec2 uTexel;
uniform float uExag;
uniform float uAmbFar;
uniform vec3 uSun;
uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uDeep;
uniform vec3 uBody;
uniform float uBelow;
uniform float uOpacity;
uniform int uStyle;
uniform float uEtaRange;
uniform float uContour;
uniform vec3 uFogColor;
uniform float uFogDensity;
${FLOW_GLSL}
varying vec3 vWorld;
varying vec2 vXY;
varying float vWake;
varying float vFade;
float domFade(vec2 xy) {
  float Lx = uDom.x, Ly = uDom.y, x0 = -uDom.z;
  float f = smoothstep(x0, x0 + 0.06 * Lx, xy.x) * (1.0 - smoothstep(x0 + 0.86 * Lx, x0 + Lx, xy.x));
  return f * (1.0 - smoothstep(0.36 * Ly, 0.5 * Ly, abs(xy.y))) * uDom.w;
}
float wakeAt(vec2 xy) {
  return texture2D(tEta, xy / uDom.xy + 0.5 * uTexel).r * domFade(xy);
}
vec3 sky(vec3 d) {
  float t = clamp(d.y, 0.0, 1.0);
  vec3 c = mix(uSkyHorizon, uSkyTop, pow(t, 0.6));
  return c + vec3(1.0, 0.95, 0.8) * pow(max(dot(d, uSun), 0.0), 600.0) * 6.0;
}
void main() {
  vec2 h = uDom.xy * uTexel;
  vec2 xy = vXY;
  vec2 s = uExag * vec2(wakeAt(xy + vec2(h.x, 0.0)) - wakeAt(xy - vec2(h.x, 0.0)), wakeAt(xy + vec2(0.0, h.y)) - wakeAt(xy - vec2(0.0, h.y))) / (2.0 * h);
  if (uNWave > 0) s += waveSlope(xy) * (1.0 - smoothstep(0.6 * uAmbFar, uAmbFar, length(xy)));
  vec3 n = normalize(vec3(-s.x, 1.0, s.y));
  vec3 V = normalize(cameraPosition - vWorld);
  vec3 col;
  float alpha;
  if (uBelow < 0.5) {
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(n, V), 0.0), 5.0);
    vec3 R = reflect(-V, n);
    R.y = abs(R.y);
    col = mix(uBody, sky(R), F);
    alpha = mix(uOpacity, 1.0, F);
  } else {
    vec3 T = refract(-V, -n, 1.333);
    if (dot(T, T) < 1e-6) {
      col = uDeep * 1.2;
      alpha = 0.97;
    } else {
      col = mix(uBody, sky(T), 0.8);
      alpha = 0.9;
    }
  }
  if (uStyle == 1) {
    float e = clamp(vWake / max(uEtaRange, 1e-6), -1.0, 1.0);
    vec3 up = vec3(0.95, 0.45, 0.25), dn = vec3(0.15, 0.4, 0.95), mid = vec3(0.85, 0.9, 0.95);
    vec3 ec = pow(e > 0.0 ? mix(mid, up, e) : mix(mid, dn, -e), vec3(2.2));
    col = mix(col, ec, 0.75 * vFade);
    alpha = mix(alpha, max(alpha, 0.85), vFade);
  }
  if (uContour > 0.0) {
    float lev = vWake / uContour;
    float fw = max(fwidth(lev), 1e-4);
    // only where the simulated field is shown at full strength
    float line = (1.0 - smoothstep(0.5, 1.5, abs(fract(lev + 0.5) - 0.5) / fw)) * smoothstep(0.97, 1.0, vFade);
    // no zero level: it only traces the calm water's round-off
    line *= step(0.5, abs(lev));
    col = mix(col, vWake >= 0.0 ? vec3(1.0) : vec3(0.004, 0.01, 0.03), line * 0.7);
    alpha = max(alpha, line * 0.9);
  }
  float d = length(cameraPosition - vWorld);
  col = mix(col, uFogColor, 1.0 - exp(-pow(d * uFogDensity, 2.0)));
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;

/** Colour given in sRGB, stored linear (shaders convert back on output). */
export const srgb = (r: number, g: number, b: number) =>
  new THREE.Color().setRGB(r, g, b, THREE.SRGBColorSpace);

/** Grid coordinates: uniform over [a, b] with n cells, then geometric growth out to ±far. */
function axis(a: number, b: number, n: number, far: number, nOut: number): number[] {
  const out: number[] = [];
  const d = (b - a) / n;
  const grow = (span: number) => {
    // geometric steps starting at d reaching span in nOut steps
    let r = 1.2;
    for (let it = 0; it < 60; it++) {
      const s = (d * (Math.pow(r, nOut) - 1)) / (r - 1);
      r *= Math.pow(span / s, 0.5 / nOut);
    }
    const steps: number[] = [];
    let x = 0,
      dd = d;
    for (let i = 0; i < nOut; i++) {
      dd *= r;
      x += dd;
      steps.push(x);
    }
    return steps.map((v) => (v * span) / x);
  };
  const left = grow(Math.max(far + a, d));
  for (let i = left.length - 1; i >= 0; i--) out.push(a - left[i]);
  for (let i = 0; i <= n; i++) out.push(a + i * d);
  for (const v of grow(Math.max(far - b, d))) out.push(b + v);
  return out;
}

export class Water {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private tex: THREE.DataTexture | null = null;
  private grid: SurfaceGrid | null = null;
  private useHalf: boolean;
  private key = '';

  constructor(flowUniforms: Record<string, THREE.IUniform>, floatLinear: boolean) {
    this.useHalf = !floatLinear;
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: {
        ...flowUniforms,
        tEta: { value: null },
        uDom: { value: new THREE.Vector4(1, 1, 0, 0) },
        uTexel: { value: new THREE.Vector2(1, 1) },
        uExag: { value: 1 },
        uAmbFar: { value: 1000 },
        uSun: { value: new THREE.Vector3(0.3, 0.8, -0.5).normalize() },
        uSkyTop: { value: srgb(0.32, 0.55, 0.85) },
        uSkyHorizon: { value: srgb(0.78, 0.86, 0.93) },
        uDeep: { value: srgb(0.03, 0.17, 0.24) },
        uBody: { value: srgb(0.06, 0.32, 0.4) },
        uBelow: { value: 0 },
        uOpacity: { value: 0.55 },
        uStyle: { value: 0 },
        uEtaRange: { value: 0.01 },
        uContour: { value: 0 },
        uFogColor: { value: new THREE.Color() },
        uFogDensity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(new THREE.BufferGeometry(), this.material);
    this.mesh.frustumCulled = false;
  }

  /** Rebuild the mesh for a simulation grid (fine over the simulated area). */
  private rebuild(grid: SurfaceGrid) {
    const far = Math.max(15 * grid.Lx, 3000);
    const xs = axis(-grid.xUp, grid.Lx - grid.xUp, 320, far, 24);
    const ys = axis(-grid.Ly / 2, grid.Ly / 2, 160, far, 24);
    const nx = xs.length,
      ny = ys.length;
    const pos = new Float32Array(nx * ny * 3);
    for (let j = 0; j < ny; j++)
      for (let i = 0; i < nx; i++) {
        const k = 3 * (j * nx + i);
        pos[k] = xs[i];
        pos[k + 1] = 0;
        pos[k + 2] = -ys[j];
      }
    const idx: number[] = [];
    for (let j = 0; j < ny - 1; j++)
      for (let i = 0; i < nx - 1; i++) {
        const a = j * nx + i;
        idx.push(a, a + 1, a + nx, a + 1, a + nx + 1, a + nx);
      }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setIndex(idx);
    this.mesh.geometry.dispose();
    this.mesh.geometry = geo;
    this.material.uniforms.uAmbFar.value = 0.5 * far;
  }

  /** New elevation field from the surface worker. */
  setField(grid: SurfaceGrid, eta: Float32Array) {
    const key = `${grid.nx}x${grid.ny}@${grid.Lx.toFixed(4)}`;
    if (key !== this.key) {
      this.key = key;
      this.grid = grid;
      this.rebuild(grid);
      this.tex?.dispose();
      const data = this.useHalf
        ? new Uint16Array(grid.nx * grid.ny)
        : new Float32Array(grid.nx * grid.ny);
      this.tex = new THREE.DataTexture(
        data,
        grid.nx,
        grid.ny,
        THREE.RedFormat,
        this.useHalf ? THREE.HalfFloatType : THREE.FloatType,
      );
      this.tex.wrapS = this.tex.wrapT = THREE.RepeatWrapping;
      this.tex.minFilter = this.tex.magFilter = THREE.LinearFilter;
      this.tex.generateMipmaps = false;
      const u = this.material.uniforms;
      u.tEta.value = this.tex;
      u.uDom.value.set(grid.Lx, grid.Ly, grid.xUp, 1);
      u.uTexel.value.set(1 / grid.nx, 1 / grid.ny);
    }
    const tex = this.tex!;
    if (this.useHalf) {
      const d = tex.image.data as Uint16Array;
      for (let i = 0; i < eta.length; i++) d[i] = THREE.DataUtils.toHalfFloat(eta[i]);
    } else (tex.image.data as Float32Array).set(eta);
    tex.needsUpdate = true;
  }

  get simGrid() {
    return this.grid;
  }

  dispose() {
    this.tex?.dispose();
    this.material.dispose();
    this.mesh.geometry.dispose();
  }
}
