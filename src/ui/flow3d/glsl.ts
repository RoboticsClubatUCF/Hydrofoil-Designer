/**
 * GLSL for the 3-D view. FLOW_GLSL is the GPU twin of src/flow3d/velocity.ts:
 * free stream + vortex segments (with free-surface images) + each foil's
 * section near field + orbital velocity of the ambient sea. Positions are in the
 * physics frame (x downstream, y span, z up); the scene uses three.js axes
 * (x, z, −y).
 */

/** Segments per row of the segment texture (two texels each). */
export const SEG_PER_ROW = 512;
export const MAX_WAVES = 16;
/** Width of the foil data texture (panel nodes, stations, profile per foil). */
export const FOIL_TEX_W = 128;

export const FLOW_GLSL = /* glsl */ `
#define PI 3.141592653589793
uniform highp sampler2D tSeg;
uniform int uNSeg;
uniform highp sampler2D tFoil;
uniform int uNFoil;
uniform vec4 uFoilA[2];   // x0, z0, half span, stations
uniform vec4 uFoilB[2];   // cos pitch, sin pitch, panel nodes, tip fade length
uniform float uU;
uniform int uNWave;
uniform vec4 uWave[${MAX_WAVES}];     // kx, ky, amplitude, ω
uniform float uWavePh[${MAX_WAVES}];

vec3 segVel(vec3 p) {
  vec3 v = vec3(0.0);
  for (int i = 0; i < 8192; i++) {
    if (i >= uNSeg) break;
    ivec2 c0 = ivec2((i % ${SEG_PER_ROW}) * 2, i / ${SEG_PER_ROW});
    vec4 A = texelFetch(tSeg, c0, 0);
    vec4 B = texelFetch(tSeg, c0 + ivec2(1, 0), 0);
    vec3 r1 = p - A.xyz;
    vec3 r2 = p - B.xyz;
    vec3 r0 = B.xyz - A.xyz;
    vec3 c = cross(r1, r2);
    float den = dot(c, c) + B.w * B.w * dot(r0, r0);
    float l1 = length(r1);
    float l2 = length(r2);
    if (den > 1e-20 && l1 > 1e-9 && l2 > 1e-9) {
      v += c * (A.w * dot(r0, r1 / l1 - r2 / l2) / (4.0 * PI * den));
    }
  }
  return v;
}

vec3 nearVel(int f, vec3 p, inout float inside) {
  vec4 FA = uFoilA[f];
  vec4 FB = uFoilB[f];
  float hspan = FA.z;
  float ay = abs(p.y);
  float over = ay - hspan;
  float tipLen = FB.w;
  if (over > tipLen) return vec3(0.0);
  int M = int(FA.w);
  float fs = clamp(ay / hspan, 0.0, 1.0) * float(M - 1);
  int j0 = min(int(floor(fs)), M - 2);
  vec4 st = mix(texelFetch(tFoil, ivec2(j0, 4 * f + 1), 0), texelFetch(tFoil, ivec2(j0 + 1, 4 * f + 1), 0), fs - float(j0));
  float c = st.x;
  float ca = FB.x;
  float sa = FB.y;
  vec2 d = vec2(p.x - FA.x, p.z - FA.y);
  float xi = (d.x * ca - d.y * sa) / c;
  float ze = (d.x * sa + d.y * ca) / c;
  float r2 = xi * xi + ze * ze;
  if (r2 > 9.0) return vec3(0.0);
  if (over <= 0.0) {
    float xl = xi + 0.25;
    if (xl >= 0.0 && xl <= 1.0) {
      float s = sqrt(xl) * 63.0;
      int k0 = min(int(floor(s)), 62);
      vec2 pr = mix(texelFetch(tFoil, ivec2(k0, 4 * f + 2), 0).xy, texelFetch(tFoil, ivec2(k0 + 1, 4 * f + 2), 0).xy, s - float(k0));
      if (ze <= pr.x && ze >= pr.y) inside = 1.0;
    }
  }
  int n = int(FB.z);
  vec2 v = vec2(0.0);
  vec4 na = texelFetch(tFoil, ivec2(0, 4 * f), 0);
  float ga = st.y * na.z + st.z * na.w;
  for (int j = 0; j < ${FOIL_TEX_W - 1}; j++) {
    if (j >= n - 1) break;
    vec4 nb = texelFetch(tFoil, ivec2(j + 1, 4 * f), 0);
    float gb = st.y * nb.z + st.z * nb.w;
    vec2 dd = nb.xy - na.xy;
    float l = length(dd);
    if (l > 1e-9) {
      vec2 t = dd / l;
      vec2 r = vec2(xi, ze) - na.xy;
      float xl = dot(r, t);
      float zl = -r.x * t.y + r.y * t.x;
      float I0 = atan(zl, xl - l) - atan(zl, xl);
      if (I0 > PI) I0 -= 2.0 * PI;
      if (I0 < -PI) I0 += 2.0 * PI;
      float I1 = 0.5 * log((xl * xl + zl * zl + 1e-20) / ((xl - l) * (xl - l) + zl * zl + 1e-20));
      float J0 = xl * I0 - zl * I1;
      float J1 = xl * I1 - l + zl * I0;
      float ul = -((I0 - J0 / l) * ga + (J0 / l) * gb) / (2.0 * PI);
      float wl = ((I1 - J1 / l) * ga + (J1 / l) * gb) / (2.0 * PI);
      v += vec2(ul * t.x - wl * t.y, ul * t.y + wl * t.x);
    }
    na = nb;
    ga = gb;
  }
  float rr = max(r2, 1e-12);
  v += st.w / (2.0 * PI) * vec2(ze, -xi) / rr;
  v *= (1.0 - smoothstep(2.0, 3.0, sqrt(r2))) * (1.0 - smoothstep(0.0, tipLen, over));
  return vec3(v.x * ca + v.y * sa, 0.0, -v.x * sa + v.y * ca);
}

float waveHeight(vec2 xy) {
  float h = 0.0;
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    if (i >= uNWave) break;
    vec4 w = uWave[i];
    h += w.z * cos(dot(w.xy, xy) - uWavePh[i]);
  }
  return h;
}

vec2 waveSlope(vec2 xy) {
  vec2 s = vec2(0.0);
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    if (i >= uNWave) break;
    vec4 w = uWave[i];
    s -= w.z * sin(dot(w.xy, xy) - uWavePh[i]) * w.xy;
  }
  return s;
}

vec3 waveVel(vec3 p) {
  vec3 v = vec3(0.0);
  for (int i = 0; i < ${MAX_WAVES}; i++) {
    if (i >= uNWave) break;
    vec4 w = uWave[i];
    float k = length(w.xy);
    float th = dot(w.xy, p.xy) - uWavePh[i];
    float e = w.z * w.w * exp(k * min(p.z, 0.0));
    v += vec3(e * cos(th) * w.xy / k, e * sin(th));
  }
  return v;
}

vec3 flowVel(vec3 p, out float inside) {
  inside = 0.0;
  vec3 v = vec3(uU, 0.0, 0.0) + segVel(p) + waveVel(p);
  for (int f = 0; f < 2; f++) {
    if (f >= uNFoil) break;
    v += nearVel(f, p, inside);
  }
  return v;
}
`;

/** Diverging map for pressure coefficient (blue suction → white → red pressure), sRGB. */
export const COLORMAP_GLSL = /* glsl */ `
vec3 cpColor(float cp) {
  float t = clamp(cp, -1.2, 1.0);
  vec3 mid = vec3(0.93, 0.95, 0.97);
  vec3 lo = vec3(0.10, 0.36, 0.92);
  vec3 lo2 = vec3(0.35, 0.10, 0.70);
  vec3 hi = vec3(0.92, 0.25, 0.14);
  if (t < 0.0) {
    float u = -t;
    return u < 1.0 ? mix(mid, lo, u) : mix(lo, lo2, (u - 1.0) / 0.2);
  }
  return mix(mid, hi, t);
}
vec3 speedColor(float s) {
  float t = clamp((s - 0.6) / 0.8, 0.0, 1.0);
  vec3 a = vec3(0.18, 0.10, 0.45);
  vec3 b = vec3(0.10, 0.55, 0.80);
  vec3 c = vec3(0.45, 0.85, 0.55);
  vec3 d = vec3(0.98, 0.90, 0.30);
  return t < 0.33 ? mix(a, b, t / 0.33) : t < 0.66 ? mix(b, c, (t - 0.33) / 0.33) : mix(c, d, (t - 0.66) / 0.34);
}
`;

/** Same diverging map on the CPU (sRGB 0–1) for foil vertex colours and legends. */
export function cpColor(cp: number): [number, number, number] {
  const t = Math.min(1, Math.max(-1.2, cp));
  const mix = (a: number[], b: number[], u: number) =>
    a.map((x, i) => x + (b[i] - x) * u) as [number, number, number];
  const mid = [0.93, 0.95, 0.97],
    lo = [0.1, 0.36, 0.92],
    lo2 = [0.35, 0.1, 0.7],
    hi = [0.92, 0.25, 0.14];
  if (t < 0) return -t < 1 ? mix(mid, lo, -t) : mix(lo, lo2, (-t - 1) / 0.2);
  return mix(mid, hi, t);
}
