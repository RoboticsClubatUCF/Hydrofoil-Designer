/**
 * GPU particles carried by the flow. Positions and velocities live in float
 * textures (two render targets written in one pass); each frame every particle
 * evaluates the full velocity field (FLOW_GLSL) and is advanced with a second-
 * order Adams–Bashforth step. Particles that leave the box, enter a foil or rise
 * above the water are re-released upstream. They are drawn as streaks whose
 * length is the distance travelled in a short time and whose colour is the
 * local pressure coefficient from Bernoulli, Cp = 1 − |v|²/U².
 */
import * as THREE from 'three';
import { COLORMAP_GLSL, FLOW_GLSL } from './glsl';

export interface SeedRegion {
  yC: number;
  yHalf: number;
  zC: number;
  zHalf: number;
  /** release on both sides of the centre plane (tips) */
  mirror: boolean;
}

export type ColourBy = 'pressure' | 'speed' | 'white';

const COMPUTE_FRAG = /* glsl */ `
precision highp float;
precision highp int;
precision highp sampler2D;
layout(location = 0) out vec4 oPos;
layout(location = 1) out vec4 oVel;
uniform sampler2D tPos;
uniform sampler2D tVel;
uniform float uDt;
uniform float uDtRatio;
uniform uint uFrame;
uniform int uInit;
uniform vec3 uBoxMin;
uniform vec3 uBoxMax;
uniform vec4 uSeed;
uniform float uSeedMirror;
uniform vec2 uInlet;
uniform float uMaxAge;
uniform float uTopZ;
${FLOW_GLSL}

uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float rnd(inout uint s) {
  s = pcg(s);
  return float(s) * (1.0 / 4294967295.0);
}
vec3 spawn(inout uint s, bool anywhere) {
  float x = anywhere ? mix(uBoxMin.x, uBoxMax.x, rnd(s)) : uInlet.x + uInlet.y * rnd(s);
  float y = uSeed.x + (2.0 * rnd(s) - 1.0) * uSeed.y;
  if (uSeedMirror > 0.5 && rnd(s) < 0.5) y = -y;
  float z = min(uSeed.z + (2.0 * rnd(s) - 1.0) * uSeed.w, uTopZ);
  return vec3(x, y, z);
}

void main() {
  ivec2 ij = ivec2(gl_FragCoord.xy);
  vec4 P = texelFetch(tPos, ij, 0);
  vec4 Vp = texelFetch(tVel, ij, 0);
  uint s = pcg(uint(ij.x) * 7919u + uint(ij.y) * 104729u + pcg(uFrame));
  vec3 p = P.xyz;
  float inside = 0.0;
  vec3 v = vec3(0.0);
  bool respawn = uInit == 1;
  if (!respawn) {
    v = flowVel(p, inside);
    respawn = inside > 0.5 || p.x > uBoxMax.x || p.x < uBoxMin.x - 1.0 || abs(p.y) > uBoxMax.y
      || p.z < uBoxMin.z || p.z > waveHeight(p.xy) || P.w > uMaxAge;
  }
  if (respawn) {
    p = spawn(s, uInit == 1);
    v = flowVel(p, inside);
    oPos = vec4(p, 0.0);
    oVel = vec4(v, 0.0);
    return;
  }
  vec3 adv = Vp.w > 0.5 ? v + 0.5 * uDtRatio * (v - Vp.xyz) : v;
  oPos = vec4(p + uDt * adv, P.w + uDt);
  oVel = vec4(v, 1.0);
}
`;

const QUAD_VERT = /* glsl */ `
void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const STREAK_VERT = /* glsl */ `
uniform highp sampler2D tPos;
uniform highp sampler2D tVel;
uniform float uStreak;
uniform float uWidth;
uniform vec2 uViewport;
uniform float uU;
uniform int uColorBy;
uniform float uFadeAge;
uniform vec3 uFogColor;
uniform float uFogDensity;
attribute vec2 aIdx;
varying vec4 vColor;
varying float vAlong;
varying float vAcross;
${COLORMAP_GLSL}
vec3 toThree(vec3 p) { return vec3(p.x, p.z, -p.y); }
void main() {
  vec4 P = texelFetch(tPos, ivec2(aIdx), 0);
  vec4 V = texelFetch(tVel, ivec2(aIdx), 0);
  vec3 head = toThree(P.xyz);
  vec3 tail = toThree(P.xyz - V.xyz * uStreak);
  vec4 ch = projectionMatrix * modelViewMatrix * vec4(head, 1.0);
  vec4 ct = projectionMatrix * modelViewMatrix * vec4(tail, 1.0);
  vAlong = position.x;
  vAcross = position.y;
  if (ch.w <= 0.0 || ct.w <= 0.0 || V.w < 0.5) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vColor = vec4(0.0);
    return;
  }
  vec2 sh = ch.xy / ch.w * uViewport;
  vec2 st = ct.xy / ct.w * uViewport;
  vec2 dir = sh - st;
  float len = length(dir);
  dir = len > 1e-3 ? dir / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec4 c = position.x < 0.5 ? ch : ct;
  // extend the head by half a width so short streaks still show as dots
  c.xy += (dir * (position.x < 0.5 ? 0.5 : -0.5) + nrm * position.y * 0.5) * uWidth / uViewport * c.w;
  gl_Position = c;
  float sp = length(V.xyz) / uU;
  float cp = 1.0 - sp * sp;
  vec3 col = uColorBy == 0 ? cpColor(cp) : uColorBy == 1 ? speedColor(sp) : vec3(0.85, 0.93, 1.0);
  // water at free-stream pressure stays faint so the flow the foil disturbs stands out
  float emphasis = uColorBy == 2 ? 0.75 : mix(0.28, 1.0, smoothstep(0.015, 0.25, abs(cp)));
  if (uColorBy == 0 && abs(cp) < 0.25) col = mix(vec3(0.55, 0.74, 0.84), col, smoothstep(0.015, 0.25, abs(cp)));
  float dist = length((modelViewMatrix * vec4(head, 1.0)).xyz);
  float fog = exp(-pow(dist * uFogDensity, 2.0));
  float a = smoothstep(0.0, uFadeAge, P.w) * fog * emphasis;
  vColor = vec4(col, a);
}
`;

const STREAK_FRAG = /* glsl */ `
varying vec4 vColor;
varying float vAlong;
varying float vAcross;
void main() {
  float a = vColor.a * (1.0 - 0.8 * vAlong) * (1.0 - smoothstep(0.4, 1.0, abs(vAcross)));
  if (a < 0.02) discard;
  gl_FragColor = vec4(vColor.rgb, a);
}
`;

export class Particles {
  readonly mesh: THREE.Mesh;
  private size: number;
  private targets: THREE.WebGLRenderTarget[];
  private cur = 0;
  private computeMat: THREE.ShaderMaterial;
  private computeScene = new THREE.Scene();
  private computeCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private frame = 0;
  private needsInit = true;
  private lastDt = 0;
  readonly renderMat: THREE.ShaderMaterial;

  /** flowUniforms: shared FLOW_GLSL uniforms (also used by the water). */
  constructor(count: number, flowUniforms: Record<string, THREE.IUniform>) {
    this.size = Math.ceil(Math.sqrt(count));
    const opts = {
      type: THREE.FloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      count: 2,
    };
    this.targets = [
      new THREE.WebGLRenderTarget(this.size, this.size, opts),
      new THREE.WebGLRenderTarget(this.size, this.size, opts),
    ];
    this.computeMat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: QUAD_VERT,
      fragmentShader: COMPUTE_FRAG,
      uniforms: {
        ...flowUniforms,
        tPos: { value: null },
        tVel: { value: null },
        uDt: { value: 0 },
        uDtRatio: { value: 1 },
        uFrame: { value: 0 },
        uInit: { value: 1 },
        uBoxMin: { value: new THREE.Vector3() },
        uBoxMax: { value: new THREE.Vector3() },
        uSeed: { value: new THREE.Vector4() },
        uSeedMirror: { value: 0 },
        uInlet: { value: new THREE.Vector2() },
        uMaxAge: { value: 10 },
        uTopZ: { value: -0.01 },
      },
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.computeMat);
    quad.frustumCulled = false;
    this.computeScene.add(quad);

    // streak quads: corner (along 0/1, across −1/+1), one instance per particle
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array([0, -1, 0, 0, 1, 0, 1, -1, 0, 1, 1, 0]), 3),
    );
    // counter-clockwise on screen (the quad is built in screen space, so its winding never flips)
    geo.setIndex([0, 1, 2, 2, 1, 3]);
    const n = this.size * this.size;
    const idx = new Float32Array(2 * n);
    for (let i = 0; i < n; i++) {
      idx[2 * i] = i % this.size;
      idx[2 * i + 1] = Math.floor(i / this.size);
    }
    geo.setAttribute('aIdx', new THREE.InstancedBufferAttribute(idx, 2));
    geo.instanceCount = n;
    this.renderMat = new THREE.ShaderMaterial({
      vertexShader: STREAK_VERT,
      fragmentShader: STREAK_FRAG,
      uniforms: {
        tPos: { value: null },
        tVel: { value: null },
        uStreak: { value: 0.02 },
        uWidth: { value: 2 },
        uViewport: { value: new THREE.Vector2(800, 600) },
        uU: flowUniforms.uU,
        uColorBy: { value: 0 },
        uFadeAge: { value: 0.05 },
        uFogColor: { value: new THREE.Color() },
        uFogDensity: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(geo, this.renderMat);
    this.mesh.frustumCulled = false;
  }

  get count() {
    return this.size * this.size;
  }

  setRegion(
    boxMin: THREE.Vector3,
    boxMax: THREE.Vector3,
    seed: SeedRegion,
    inletX: number,
    inletW: number,
    maxAge: number,
    topZ: number,
  ) {
    const u = this.computeMat.uniforms;
    u.uBoxMin.value.copy(boxMin);
    u.uBoxMax.value.copy(boxMax);
    u.uSeed.value.set(seed.yC, seed.yHalf, seed.zC, seed.zHalf);
    u.uSeedMirror.value = seed.mirror ? 1 : 0;
    u.uInlet.value.set(inletX, inletW);
    u.uMaxAge.value = maxAge;
    u.uTopZ.value = topZ;
  }

  /** Re-release every particle (after a change of seeding or geometry). */
  reset() {
    this.needsInit = true;
  }

  step(renderer: THREE.WebGLRenderer, dt: number) {
    const u = this.computeMat.uniforms;
    const src = this.targets[this.cur];
    const dst = this.targets[1 - this.cur];
    u.tPos.value = src.textures[0];
    u.tVel.value = src.textures[1];
    u.uDt.value = dt;
    u.uDtRatio.value = this.lastDt > 0 ? dt / this.lastDt : 1;
    u.uFrame.value = this.frame++;
    u.uInit.value = this.needsInit ? 1 : 0;
    this.needsInit = false;
    if (dt > 0) this.lastDt = dt;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(dst);
    renderer.render(this.computeScene, this.computeCam);
    renderer.setRenderTarget(prev);
    this.cur = 1 - this.cur;
    this.renderMat.uniforms.tPos.value = dst.textures[0];
    this.renderMat.uniforms.tVel.value = dst.textures[1];
  }

  /** Read back particle positions and velocities (for checks). */
  read(renderer: THREE.WebGLRenderer, n = 64) {
    const t = this.targets[this.cur];
    const w = Math.min(n, this.size);
    const pos = new Float32Array(4 * w);
    const vel = new Float32Array(4 * w);
    renderer.readRenderTargetPixels(t, 0, 0, w, 1, pos, undefined, 0);
    renderer.readRenderTargetPixels(t, 0, 0, w, 1, vel, undefined, 1);
    return { pos, vel };
  }

  dispose() {
    this.targets.forEach((t) => t.dispose());
    this.computeMat.dispose();
    this.renderMat.dispose();
    this.mesh.geometry.dispose();
  }
}
