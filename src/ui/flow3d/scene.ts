/** The three.js scene of the 3-D flow view. */
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { SurfaceGrid } from '../../flow3d/surface';
import type { FlowState } from '../../flow3d/types';
import { seaAt, type WaveComponent } from '../../flow3d/seaState';
import { tipFadeLength, velocityAt } from '../../flow3d/velocity';
import { SEG_STRIDE } from '../../flow3d/vortex';
import {
  FoilMesh,
  PERSON_HEIGHT,
  buildCraft,
  buildPerson,
  sectionCap,
  toThree,
  type FoilColouring,
} from './craft';
import { Annotations, type AnnotationFormat } from './annotations';
import { FOIL_TEX_W, MAX_WAVES, SEG_PER_ROW, cpColor } from './glsl';
import { Particles, type ColourBy, type SeedRegion } from './particles';
import { Water, srgb } from './water';

export type SeedMode = 'volume' | 'slice' | 'tips' | 'surface';
export type CameraPreset = 'three-quarter' | 'section' | 'front' | 'behind' | 'above' | 'wake';

export interface ViewSettings {
  playing: boolean;
  timeScale: number;
  particles: boolean;
  particleCount: number;
  seed: SeedMode;
  /** slice position as a fraction of the semi-span */
  sliceY: number;
  colourBy: ColourBy;
  /** streak length, in units of the time to cross 5 % of the foil length */
  streak: number;
  streamlines: boolean;
  foilColour: FoilColouring;
  showCraft: boolean;
  /** 1.75 m human silhouette standing on the board */
  showPerson: boolean;
  /** span, chords and depth of each foil */
  dimensions: boolean;
  /** lift and drag along the span */
  forces: boolean;
  cutaway: boolean;
  surface: boolean;
  surfaceStyle: 'realistic' | 'elevation';
  contours: boolean;
  exaggeration: number;
}

export interface GustReadout {
  /** largest lift change over the last few seconds, fraction of the lift */
  liftSwing: number;
  /** largest angle change, rad */
  alphaSwing: number;
  /** smallest depth of the main foil under the passing waves, m */
  minDepth: number;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const SKY_FRAG = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBelow;
uniform vec3 uSun;
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 c = d.y > 0.0 ? mix(uHorizon, uTop, pow(d.y, 0.6)) : mix(uHorizon * 0.8, uBelow, pow(-d.y, 0.4));
  c += vec3(1.0, 0.95, 0.8) * pow(max(dot(d, uSun), 0.0), 800.0) * 4.0;
  gl_FragColor = vec4(c, 1.0);
  #include <colorspace_fragment>
}
`;

const UNDER_COLOR = new THREE.Color().setRGB(0.07, 0.3, 0.38, THREE.SRGBColorSpace);
const AIR_FOG = new THREE.Color().setRGB(0.78, 0.86, 0.93, THREE.SRGBColorSpace);

export class FlowScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly camera: THREE.PerspectiveCamera;
  readonly controls: OrbitControls;
  private scene = new THREE.Scene();
  private fog = new THREE.FogExp2(0xffffff, 0);
  private uniforms: Record<string, THREE.IUniform>;
  private segTex: THREE.DataTexture | null = null;
  private foilTex: THREE.DataTexture;
  private foilMeshes: FoilMesh[] = [];
  private foilMat: THREE.MeshStandardMaterial;
  private craftMat: THREE.MeshStandardMaterial;
  private boardMat: THREE.MeshStandardMaterial;
  private craft: THREE.Group | null = null;
  private cap: THREE.Mesh | null = null;
  private capMat = new THREE.MeshBasicMaterial({
    color: new THREE.Color().setRGB(0.16, 0.2, 0.24, THREE.SRGBColorSpace),
    side: THREE.DoubleSide,
  });
  private craftKey = '';
  private person: THREE.Mesh;
  private water: Water;
  private particles: Particles | null = null;
  private streamlines: THREE.LineSegments | null = null;
  private annot = new Annotations();
  private labels = new CSS2DRenderer();
  private format: AnnotationFormat | null = null;
  private sky: THREE.Mesh;
  private clip = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  private state: FlowState | null = null;
  private settings: ViewSettings;
  private waves: WaveComponent[] = [];
  private phases = new Float32Array(MAX_WAVES);
  private raf = 0;
  private last = 0;
  private visible = true;
  private camAnim: {
    from: THREE.Vector3;
    to: THREE.Vector3;
    tFrom: THREE.Vector3;
    tTo: THREE.Vector3;
    t: number;
  } | null = null;
  private gust = { t: 0, lift: [] as number[], alpha: [] as number[], depth: [] as number[] };
  private seedKey = '';
  onGust: ((g: GustReadout) => void) | null = null;
  onFrame: ((fps: number) => void) | null = null;
  onContour: ((step: number) => void) | null = null;
  private fpsAcc = { n: 0, t: 0 };

  constructor(canvas: HTMLCanvasElement, settings: ViewSettings) {
    this.settings = settings;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.localClippingEnabled = true;
    this.renderer.toneMapping = THREE.NoToneMapping;
    const floatLinear = this.renderer.extensions.has('OES_texture_float_linear');
    if (!this.renderer.extensions.has('EXT_color_buffer_float'))
      throw new Error(
        'This browser cannot render to floating-point textures (EXT_color_buffer_float), which the flow particles need.',
      );

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1e4);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;

    // light from above plus the scattered light under water, so the pressure colours read from any side
    this.scene.add(new THREE.HemisphereLight(0xe6f2ff, 0x5d8a99, 1.6));
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xfff4e0, 2.2);
    sun.position.set(3, 8, -5);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0x9fd0ff, 0.6);
    fill.position.set(-4, -2, 6);
    this.scene.add(fill);

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1, 32, 16),
      new THREE.ShaderMaterial({
        vertexShader: SKY_VERT,
        fragmentShader: SKY_FRAG,
        uniforms: {
          uTop: { value: srgb(0.32, 0.55, 0.85) },
          uHorizon: { value: AIR_FOG.clone() },
          uBelow: { value: srgb(0.05, 0.2, 0.28) },
          uSun: { value: new THREE.Vector3(0.3, 0.8, -0.5).normalize() },
        },
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
      }),
    );
    this.sky.renderOrder = -10;
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);

    this.uniforms = {
      tSeg: { value: null },
      uNSeg: { value: 0 },
      tFoil: { value: null },
      uNFoil: { value: 0 },
      uFoilA: { value: [new THREE.Vector4(), new THREE.Vector4()] },
      uFoilB: { value: [new THREE.Vector4(), new THREE.Vector4()] },
      uU: { value: 1 },
      uNWave: { value: 0 },
      uWave: { value: Array.from({ length: MAX_WAVES }, () => new THREE.Vector4()) },
      uWavePh: { value: new Float32Array(MAX_WAVES) },
    };
    this.foilTex = new THREE.DataTexture(
      new Float32Array(FOIL_TEX_W * 8 * 4),
      FOIL_TEX_W,
      8,
      THREE.RGBAFormat,
      THREE.FloatType,
    );
    this.foilTex.minFilter = this.foilTex.magFilter = THREE.NearestFilter;
    this.uniforms.tFoil.value = this.foilTex;

    this.foilMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.38,
      metalness: 0.05,
      side: THREE.DoubleSide,
      clippingPlanes: [],
    });
    this.craftMat = new THREE.MeshStandardMaterial({
      color: 0x2f3338,
      roughness: 0.45,
      metalness: 0.35,
      clippingPlanes: [],
    });
    this.boardMat = new THREE.MeshStandardMaterial({
      color: 0xeef1f3,
      roughness: 0.55,
      metalness: 0.0,
    });

    this.person = buildPerson(
      new THREE.MeshBasicMaterial({
        color: new THREE.Color().setRGB(0.12, 0.14, 0.17, THREE.SRGBColorSpace),
        side: THREE.DoubleSide,
      }),
    );
    this.person.visible = false;
    this.scene.add(this.person);

    this.water = new Water(this.uniforms, floatLinear);
    this.scene.add(this.water.mesh);

    this.scene.add(this.annot.group);
    this.labels.domElement.className = 'f3-labels';
    canvas.after(this.labels.domElement);

    this.applySettings(settings);
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  // ---------------------------------------------------------------- data

  setFlow(state: FlowState) {
    const first = !this.state;
    const prevKey = this.state ? this.geomKey(this.state) : '';
    this.state = state;
    const u = this.uniforms;
    u.uU.value = state.V;

    // vortex segments
    const rows = Math.max(1, Math.ceil(state.nSeg / SEG_PER_ROW));
    const w = 2 * SEG_PER_ROW;
    const data = new Float32Array(w * rows * 4);
    for (let i = 0; i < state.nSeg; i++) {
      const o = i * SEG_STRIDE;
      const t = 4 * (Math.floor(i / SEG_PER_ROW) * w + 2 * (i % SEG_PER_ROW));
      data[t] = state.segs[o];
      data[t + 1] = state.segs[o + 1];
      data[t + 2] = state.segs[o + 2];
      data[t + 3] = state.segs[o + 6];
      data[t + 4] = state.segs[o + 3];
      data[t + 5] = state.segs[o + 4];
      data[t + 6] = state.segs[o + 5];
      data[t + 7] = state.segs[o + 7];
    }
    if (!this.segTex || this.segTex.image.height !== rows) {
      this.segTex?.dispose();
      this.segTex = new THREE.DataTexture(data, w, rows, THREE.RGBAFormat, THREE.FloatType);
      this.segTex.minFilter = this.segTex.magFilter = THREE.NearestFilter;
    } else (this.segTex.image.data as Float32Array).set(data);
    this.segTex.needsUpdate = true;
    u.tSeg.value = this.segTex;
    u.uNSeg.value = state.nSeg;

    // foil data
    const fd = this.foilTex.image.data as Float32Array;
    fd.fill(0);
    state.foils.slice(0, 2).forEach((f, k) => {
      const row = (r: number, j: number) => 4 * ((4 * k + r) * FOIL_TEX_W + j);
      const n = f.nodes.length / 2;
      for (let j = 0; j < n; j++) {
        const t = row(0, j);
        fd[t] = f.nodes[2 * j];
        fd[t + 1] = f.nodes[2 * j + 1];
        fd[t + 2] = f.g0[j];
        fd[t + 3] = f.g90[j];
      }
      for (let j = 0; j < state.nStation; j++) fd.set(f.st.subarray(4 * j, 4 * j + 4), row(1, j));
      for (let j = 0; j < f.profU.length; j++) {
        const t = row(2, j);
        fd[t] = f.profU[j];
        fd[t + 1] = f.profL[j];
      }
      u.uFoilA.value[k].set(f.x0, f.z0, f.b / 2, state.nStation);
      u.uFoilB.value[k].set(
        Math.cos(f.pitch),
        Math.sin(f.pitch),
        n,
        tipFadeLength(f, state.nStation),
      );
    });
    this.foilTex.needsUpdate = true;
    u.uNFoil.value = Math.min(2, state.foils.length);

    // foil meshes
    while (this.foilMeshes.length < state.foils.length) {
      const m = new FoilMesh(this.foilMat);
      this.foilMeshes.push(m);
      this.scene.add(m.mesh);
    }
    while (this.foilMeshes.length > state.foils.length) {
      const m = this.foilMeshes.pop()!;
      this.scene.remove(m.mesh);
      m.dispose();
    }
    this.updateFoilColours();
    this.rebuildCraft();
    this.updateRegion();
    this.updateAnnotations();
    if (first) this.preset('three-quarter', true);
    else if (prevKey !== this.geomKey(state)) this.particles?.reset();
  }

  private geomKey(s: FlowState) {
    return s.foils
      .map((f) => `${f.b.toFixed(4)}|${f.cr.toFixed(4)}|${f.x0.toFixed(3)}|${f.z0.toFixed(3)}`)
      .join(';');
  }

  /** Units for the measurement and force labels. */
  setFormat(fmt: AnnotationFormat) {
    this.format = fmt;
    this.updateAnnotations();
  }

  private updateAnnotations() {
    if (this.state && this.format) this.annot.update(this.state, this.format);
  }

  private updateFoilColours() {
    const s = this.state;
    if (!s) return;
    s.foils.forEach((f, i) => this.foilMeshes[i].update(f, s, this.settings.foilColour));
  }

  private rebuildCraft() {
    const s = this.state;
    if (!s) return;
    const main = s.foils[0];
    const clearance = Math.max(0.12, 0.25 * -main.z0);
    const key = `${this.geomKey(s)}|${clearance.toFixed(3)}`;
    if (key === this.craftKey && this.craft) {
      this.craft.visible = this.settings.showCraft;
      this.person.visible = this.settings.showPerson;
      return;
    }
    this.craftKey = key;
    if (this.craft) {
      this.scene.remove(this.craft);
      this.craft.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    }
    const built = buildCraft(s, clearance, this.craftMat, this.boardMat);
    this.craft = built.group;
    this.craft.visible = this.settings.showCraft;
    this.scene.add(this.craft);
    this.person.position.copy(built.deck);
    this.person.visible = this.settings.showPerson;
  }

  setSurface(grid: SurfaceGrid, eta: Float32Array) {
    this.water.setField(grid, eta);
    let m = 0;
    for (let i = 0; i < eta.length; i += 7) m = Math.max(m, Math.abs(eta[i]));
    const u = this.water.material.uniforms;
    // elevation colours and contour spacing follow the size of the wake
    u.uEtaRange.value = 0.9 * u.uEtaRange.value + 0.1 * Math.max(m, 1e-5);
    const step = niceStep(u.uEtaRange.value / 4);
    if (step !== this.contourStep) {
      this.contourStep = step;
      this.onContour?.(step);
    }
    this.applyContours();
  }

  private contourStep = 0.001;

  private applyContours() {
    this.water.material.uniforms.uContour.value = this.settings.contours ? this.contourStep : 0;
  }

  /** Contour spacing currently drawn on the surface, m. */
  get contourSpacing() {
    return this.contourStep;
  }

  setSea(waves: WaveComponent[]) {
    const prev = this.waves;
    this.waves = waves.slice(0, MAX_WAVES);
    const u = this.uniforms;
    u.uNWave.value = this.waves.length;
    this.waves.forEach((c, i) => {
      u.uWave.value[i].set(c.kx, c.ky, c.a, c.omega);
      if (prev.length !== this.waves.length) this.phases[i] = -c.phase0;
    });
    this.gust = { t: 0, lift: [], alpha: [], depth: [] };
    if (!this.waves.length) this.onGust?.({ liftSwing: 0, alphaSwing: 0, minDepth: Infinity });
  }

  setStreamlines(lines: { pts: Float32Array; cp: Float32Array }[] | null) {
    if (this.streamlines) {
      this.scene.remove(this.streamlines);
      this.streamlines.geometry.dispose();
      (this.streamlines.material as THREE.Material).dispose();
      this.streamlines = null;
    }
    if (!lines || !lines.length) return;
    const pos: number[] = [];
    const col: number[] = [];
    const c3 = new THREE.Color();
    for (const l of lines) {
      const n = l.pts.length / 3;
      for (let i = 0; i < n - 1; i++) {
        for (const k of [i, i + 1]) {
          const p = toThree(l.pts[3 * k], l.pts[3 * k + 1], l.pts[3 * k + 2]);
          pos.push(p.x, p.y, p.z);
          const [r, g, b] = cpColor(l.cp[k]);
          c3.setRGB(r, g, b, THREE.SRGBColorSpace);
          col.push(c3.r, c3.g, c3.b);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.streamlines = new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }),
    );
    this.streamlines.frustumCulled = false;
    this.scene.add(this.streamlines);
  }

  // ---------------------------------------------------------------- settings

  applySettings(s: ViewSettings) {
    const prev = this.settings;
    this.settings = s;
    if (s.particles) {
      if (
        !this.particles ||
        this.particles.count < s.particleCount * 0.9 ||
        this.particles.count > s.particleCount * 1.1
      ) {
        if (this.particles) {
          this.scene.remove(this.particles.mesh);
          this.particles.dispose();
        }
        this.particles = new Particles(s.particleCount, this.uniforms);
        this.scene.add(this.particles.mesh);
        this.seedKey = '';
        this.applyViewport();
      }
      this.particles.mesh.visible = true;
      const pu = this.particles.renderMat.uniforms;
      pu.uColorBy.value = s.colourBy === 'pressure' ? 0 : s.colourBy === 'speed' ? 1 : 2;
    } else if (this.particles) this.particles.mesh.visible = false;
    this.water.mesh.visible = s.surface;
    const wu = this.water.material.uniforms;
    wu.uExag.value = s.exaggeration;
    wu.uStyle.value = s.surfaceStyle === 'elevation' ? 1 : 0;
    this.applyContours();
    if (this.streamlines) this.streamlines.visible = s.streamlines;
    if (prev.foilColour !== s.foilColour) this.updateFoilColours();
    if (this.craft) this.craft.visible = s.showCraft;
    this.person.visible = s.showPerson && !!this.state;
    this.annot.setVisible(s.dimensions, s.forces);
    this.updateRegion();
  }

  /** Particle box, release region and the cut-away plane. */
  private updateRegion() {
    const st = this.state;
    if (!st) return;
    const s = this.settings;
    const main = st.foils[0];
    const L = st.lref;
    const xs = st.foils.map((f) => f.x0);
    const zs = st.foils.map((f) => f.z0);
    const xMin = Math.min(...xs) - Math.max(0.7 * L, 3 * main.cr);
    const xMax = Math.max(...xs) + 2.6 * L;
    const yMax = Math.max(0.9 * L, 0.75 * Math.max(...st.foils.map((f) => f.b)));
    const zMin = Math.min(...zs) - 0.9 * L;
    const h = -main.z0;
    let seed: SeedRegion;
    const ySlice = (s.sliceY * main.b) / 2;
    switch (s.seed) {
      case 'slice':
        seed = {
          yC: ySlice,
          yHalf: 0.004 * main.b,
          zC: main.z0,
          zHalf: Math.min(1.4 * main.cr, 0.95 * h),
          mirror: false,
        };
        break;
      case 'tips':
        seed = {
          yC: main.b / 2 - 0.15 * main.cr,
          yHalf: 0.45 * main.cr,
          zC: main.z0,
          zHalf: 0.6 * main.cr,
          mirror: true,
        };
        break;
      case 'surface':
        seed = { yC: 0, yHalf: 0.7 * L, zC: -0.15 * h, zHalf: 0.13 * h, mirror: false };
        break;
      default:
        seed = {
          yC: 0,
          yHalf: 0.62 * Math.max(...st.foils.map((f) => f.b)),
          zC: main.z0,
          zHalf: Math.min(0.28 * L, 0.95 * h),
          mirror: false,
        };
    }
    const key = `${s.seed}|${s.sliceY}|${xMin.toFixed(3)}|${zMin.toFixed(3)}|${L.toFixed(3)}`;
    if (this.particles) {
      this.particles.setRegion(
        new THREE.Vector3(xMin, -yMax, zMin),
        new THREE.Vector3(xMax, yMax, 0),
        seed,
        xMin,
        0.12 * L,
        (4 * (xMax - xMin)) / st.V,
        -0.004 * L,
      );
      if (key !== this.seedKey) {
        this.seedKey = key;
        this.particles.reset();
      }
      const crossing = (0.05 * L) / st.V;
      this.particles.renderMat.uniforms.uStreak.value = s.streak * crossing;
      this.particles.renderMat.uniforms.uFadeAge.value = 0.5 * crossing;
    }
    // cut away the near half of the foils at the slice plane (three z = −y)
    const cut = s.cutaway && s.seed === 'slice';
    // keep y ≥ ySlice (three z ≤ −ySlice): points with negative signed distance are clipped
    this.clip.set(new THREE.Vector3(0, 0, -1), -ySlice + 1e-4);
    const had = (this.foilMat.clippingPlanes?.length ?? 0) > 0;
    this.foilMat.clippingPlanes = cut ? [this.clip] : [];
    this.craftMat.clippingPlanes = cut ? [this.clip] : [];
    if (had !== cut) this.foilMat.needsUpdate = this.craftMat.needsUpdate = true;
    this.annot.setClip(cut ? this.clip : null);
    if (this.cap) {
      this.scene.remove(this.cap);
      this.cap.geometry.dispose();
      this.cap = null;
    }
    if (cut && s.sliceY <= 1) {
      this.cap = sectionCap(main, s.sliceY, this.capMat);
      this.scene.add(this.cap);
    }
  }

  // ---------------------------------------------------------------- camera

  private centre() {
    const st = this.state!;
    const main = st.foils[0];
    const xs = st.foils.map((f) => f.x0);
    return toThree((Math.min(...xs) + Math.max(...xs)) / 2 + 0.25 * main.cr, 0, main.z0);
  }

  /** `foil` picks which foil the section view looks at (0 main, 1 secondary). */
  preset(p: CameraPreset, immediate = false, foil = 0) {
    const st = this.state;
    if (!st) return;
    const c = this.centre();
    const L = st.lref;
    const main = st.foils[0];
    let pos: THREE.Vector3;
    let target = c.clone();
    switch (p) {
      case 'section': {
        // side view along the span from just beyond the near tip, never inside the wing,
        // backed off past the tip dimensions, so the root chord spans about a third of the view
        const f = st.foils[Math.min(foil, st.foils.length - 1)];
        const c = f.cr;
        target = toThree(f.x0 + 0.25 * c, -f.b / 2, f.z0);
        const across = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
        const aspect = Math.min(Math.max(this.camera.aspect, 0.6), 2);
        const back = Math.max(3 * c, c / (0.35 * across * aspect));
        pos = target.clone().add(new THREE.Vector3(0, 0.08 * c, back));
        break;
      }
      case 'front':
        pos = c.clone().add(new THREE.Vector3(-1.5 * L, -0.1 * L, 0.25 * L));
        break;
      case 'behind':
        pos = c.clone().add(new THREE.Vector3(2.0 * L, -0.15 * L, 0.35 * L));
        target = c.clone().add(new THREE.Vector3(0.6 * L, 0, 0));
        break;
      case 'above': {
        // frame everything from the foil up to the board, or to the person's head when shown
        const top = this.settings.showPerson
          ? this.person.position.y + PERSON_HEIGHT
          : this.settings.showCraft
            ? this.person.position.y
            : 0;
        const bottom = main.z0 - 0.3 * main.cr;
        target = new THREE.Vector3(c.x, (top + bottom) / 2, 0);
        const fit =
          Math.max(top - bottom, 0.6 * L) /
          (2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)));
        pos = target
          .clone()
          .add(new THREE.Vector3(-0.62, 0.42, 0.66).normalize().multiplyScalar(1.35 * fit));
        break;
      }
      case 'wake': {
        const g = this.water.simGrid;
        const Lx = g ? g.Lx : 30 * L;
        target = new THREE.Vector3(0.3 * Lx, 0, 0);
        pos = new THREE.Vector3(-0.15 * Lx, 0.45 * Lx, 0.35 * Lx);
        break;
      }
      default:
        pos = c.clone().add(new THREE.Vector3(-0.85 * L, -0.25 * L, 1.0 * L));
    }
    if (immediate) {
      this.camera.position.copy(pos);
      this.controls.target.copy(target);
      this.controls.update();
      this.camAnim = null;
    } else {
      this.camAnim = {
        from: this.camera.position.clone(),
        to: pos,
        tFrom: this.controls.target.clone(),
        tTo: target,
        t: 0,
      };
    }
  }

  // ---------------------------------------------------------------- loop

  setVisible(v: boolean) {
    this.visible = v;
  }

  private size = { w: 800, h: 500 };

  resize(w: number, h: number) {
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(h, 1);
    this.camera.updateProjectionMatrix();
    this.labels.setSize(w, h);
    this.annot.setResolution(w, h);
    this.applyViewport();
  }

  private applyViewport() {
    if (!this.particles) return;
    const pr = this.renderer.getPixelRatio();
    this.particles.renderMat.uniforms.uViewport.value.set(
      (this.size.w * pr) / 2,
      (this.size.h * pr) / 2,
    );
    this.particles.renderMat.uniforms.uWidth.value = 2.2 * pr;
  }

  private loop(now: number) {
    this.raf = requestAnimationFrame(this.loop);
    const dtReal = this.last ? Math.min(0.05, (now - this.last) / 1000) : 0;
    this.last = now;
    if (!this.visible) return;
    this.fpsAcc.n++;
    this.fpsAcc.t += dtReal;
    if (this.fpsAcc.t > 1) {
      this.onFrame?.(this.fpsAcc.n / this.fpsAcc.t);
      this.fpsAcc = { n: 0, t: 0 };
    }
    const st = this.state;
    const s = this.settings;

    if (this.camAnim) {
      const a = this.camAnim;
      a.t = Math.min(1, a.t + dtReal / 0.9);
      const e = a.t < 0.5 ? 2 * a.t * a.t : 1 - (-2 * a.t + 2) ** 2 / 2;
      this.camera.position.lerpVectors(a.from, a.to, e);
      this.controls.target.lerpVectors(a.tFrom, a.tTo, e);
      if (a.t >= 1) this.camAnim = null;
    }
    this.controls.update();

    // keep near/far sensible for anything from a close-up to the whole wake
    const dist = this.camera.position.distanceTo(this.controls.target);
    this.camera.near = Math.max(0.002, dist * 0.004);
    this.camera.far = Math.max(5000, dist * 400);
    this.camera.updateProjectionMatrix();
    this.sky.position.copy(this.camera.position);
    // the silhouette turns about its vertical axis to face the camera
    if (this.person.visible) {
      const d = this.camera.position.clone().sub(this.person.position);
      this.person.rotation.y = Math.atan2(d.x, d.z);
    }
    this.sky.scale.setScalar(this.camera.far * 0.8);

    const simDt = s.playing ? dtReal * s.timeScale : 0;
    if (st && simDt > 0) {
      // ambient sea phases (met at the encounter frequency)
      this.waves.forEach((c, i) => {
        this.phases[i] += (c.omega + st.V * c.kx) * simDt;
      });
      (this.uniforms.uWavePh.value as Float32Array).set(this.phases);
      this.trackGust(simDt);
      if (this.particles && s.particles) {
        const cMin = Math.min(...st.foils.map((f) => f.cr));
        const nSub = Math.min(6, Math.max(1, Math.ceil((st.V * simDt) / (0.05 * cMin))));
        for (let i = 0; i < nSub; i++) this.particles.step(this.renderer, simDt / nSub);
      }
    }

    // above or below the water
    const below = this.camera.position.y < 0;
    const L = st?.lref ?? 1;
    const fogColor = below ? UNDER_COLOR : AIR_FOG;
    const fogDensity = below ? 0.12 / L : 0.0007;
    this.fog.color.copy(fogColor);
    this.fog.density = fogDensity;
    this.scene.fog = this.fog;
    this.scene.background = below ? UNDER_COLOR : null;
    this.sky.visible = !below;
    const wu = this.water.material.uniforms;
    wu.uBelow.value = below ? 1 : 0;
    wu.uFogColor.value.copy(fogColor);
    wu.uFogDensity.value = below ? 0.6 * fogDensity : fogDensity;
    if (this.particles) {
      const pu = this.particles.renderMat.uniforms;
      pu.uFogColor.value.copy(fogColor);
      pu.uFogDensity.value = below ? fogDensity : 0;
      // particles under the water are drawn before the surface when looking from above
      this.particles.mesh.renderOrder = below ? 2 : 1;
    }
    this.water.mesh.renderOrder = below ? 1 : 2;

    this.renderer.render(this.scene, this.camera);
    // labels pile up on each other when the whole wake is in view
    this.annot.setLabelsVisible(dist < 10 * L);
    this.labels.render(this.scene, this.camera);
  }

  /** Lift and angle swing of the main foil from the passing sea (linear quasi-steady). */
  private trackGust(dt: number) {
    const st = this.state!;
    if (!this.waves.length) return;
    const f = st.foils[0];
    const o = seaAt(this.waves, this.phases, f.x0, 0, f.z0);
    const dAlpha = o.w / st.V;
    const dL = (2 * o.u) / st.V + (f.op.kFS * f.op.CLa * dAlpha) / Math.max(f.op.CL, 1e-6);
    const surf = seaAt(this.waves, this.phases, f.x0, 0, 0).eta;
    const g = this.gust;
    g.lift.push(dL);
    g.alpha.push(dAlpha);
    g.depth.push(-f.z0 + surf);
    g.t += dt;
    const keep = 600;
    if (g.lift.length > keep) {
      g.lift.splice(0, g.lift.length - keep);
      g.alpha.splice(0, g.alpha.length - keep);
      g.depth.splice(0, g.depth.length - keep);
    }
    if (g.t > 0.25 * Math.max(0.2, this.settings.timeScale || 1)) {
      g.t = 0;
      this.onGust?.({
        liftSwing: Math.max(...g.lift.map(Math.abs)),
        alphaSwing: Math.max(...g.alpha.map(Math.abs)),
        minDepth: Math.min(...g.depth),
      });
    }
  }

  /** Compare GPU particle velocities with the CPU flow model (returns the worst relative error). */
  checkParticles(n = 64) {
    if (!this.particles || !this.state) return null;
    this.particles.step(this.renderer, 0);
    const { pos, vel } = this.particles.read(this.renderer, n);
    const v = [0, 0, 0];
    let worst = 0;
    let used = 0;
    for (let i = 0; i < pos.length / 4; i++) {
      if (vel[4 * i + 3] < 0.5) continue;
      velocityAt(this.state, pos[4 * i], pos[4 * i + 1], pos[4 * i + 2], v);
      const e =
        Math.hypot(v[0] - vel[4 * i], v[1] - vel[4 * i + 1], v[2] - vel[4 * i + 2]) / this.state.V;
      worst = Math.max(worst, e);
      used++;
    }
    return { worst, used };
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.controls.dispose();
    this.particles?.dispose();
    this.water.dispose();
    this.foilMeshes.forEach((m) => m.dispose());
    this.annot.dispose();
    this.labels.domElement.remove();
    this.segTex?.dispose();
    this.foilTex.dispose();
    this.person.geometry.dispose();
    this.renderer.dispose();
  }
}

function niceStep(x: number) {
  const p = Math.pow(10, Math.floor(Math.log10(Math.max(x, 1e-9))));
  const m = x / p;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
}
