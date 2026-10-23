/**
 * Craft geometry for the 3-D view: each foil lofted from its section and
 * planform at its pitch and depth, coloured by surface pressure; a strut,
 * fuselage and board for context (not part of the design).
 */
import * as THREE from 'three';
import { chordRatio } from '../../physics/wing/planform';
import type { FlowFoil, FlowState } from '../../flow3d/types';
import { cpColor } from './glsl';

/** physics (x downstream, y span, z up) → three.js (x, z, −y) */
export const toThree = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

export type FoilColouring = 'pressure' | 'cavitation' | 'plain';

const N_SPAN_MESH = 36;

/** Mesh stations η ≥ 0, finer towards the tip. */
const meshEta = Array.from({ length: N_SPAN_MESH + 1 }, (_, i) =>
  Math.sin((Math.PI / 2) * (i / N_SPAN_MESH)),
);

function stationCp(f: FlowFoil, M: number, eta: number, k: number, nMesh: number): number {
  const s = Math.min(1, Math.max(0, eta)) * (M - 1);
  const j0 = Math.min(M - 2, Math.floor(s));
  const t = s - j0;
  return f.cp[j0 * nMesh + k] * (1 - t) + f.cp[(j0 + 1) * nMesh + k] * t;
}

/** One foil as a closed mesh (span from −b/2 to b/2, with tip caps). */
export class FoilMesh {
  readonly mesh: THREE.Mesh;
  private geo = new THREE.BufferGeometry();
  private nNodes = 0;

  constructor(material: THREE.Material) {
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
  }

  update(f: FlowFoil, state: FlowState, colouring: FoilColouring) {
    const nNodes = f.meshNodes.length / 2;
    const stations = [
      ...meshEta
        .slice(1)
        .map((e) => -e)
        .reverse(),
      ...meshEta,
    ];
    const nS = stations.length;
    const nV = nS * nNodes + 2 * nNodes;
    if (nNodes !== this.nNodes || !this.geo.getAttribute('position')) {
      this.nNodes = nNodes;
      this.geo.dispose();
      this.geo = new THREE.BufferGeometry();
      this.geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3 * nV), 3));
      this.geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(3 * nV), 3));
      const idx: number[] = [];
      for (let s = 0; s < nS - 1; s++) {
        for (let k = 0; k < nNodes - 1; k++) {
          const a = s * nNodes + k,
            b = a + 1,
            c = a + nNodes,
            d = c + 1;
          idx.push(a, c, b, b, c, d);
        }
      }
      // tip caps: strip between matching upper and lower nodes
      for (const [cap, flip] of [
        [nS * nNodes, false],
        [nS * nNodes + nNodes, true],
      ] as const) {
        for (let k = 0; k < Math.floor((nNodes - 1) / 2); k++) {
          const u0 = cap + k,
            u1 = cap + k + 1,
            l0 = cap + nNodes - 1 - k,
            l1 = cap + nNodes - 2 - k;
          if (flip) idx.push(u0, u1, l0, u1, l1, l0);
          else idx.push(u0, l0, u1, u1, l0, l1);
        }
      }
      this.geo.setIndex(idx);
      this.mesh.geometry = this.geo;
    }
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    const col = this.geo.getAttribute('color') as THREE.BufferAttribute;
    const cP = Math.cos(f.pitch),
      sP = Math.sin(f.pitch);
    const M = state.nStation;
    const sigma = f.op.sigma;
    const c3 = new THREE.Color();
    const put = (vi: number, eta: number, side: number, k: number) => {
      const c = Math.max(f.cr * chordRatio(f.planform, f.lambda, Math.abs(eta)), 0.004 * f.cr);
      const X = (f.meshNodes[2 * k] - 0.25) * c,
        Z = f.meshNodes[2 * k + 1] * c;
      const y = (side * Math.abs(eta) * f.b) / 2;
      pos.setXYZ(vi, f.x0 + X * cP + Z * sP, f.z0 - X * sP + Z * cP, -y);
      let r = 0.62,
        g = 0.66,
        b = 0.7;
      if (colouring !== 'plain') {
        const cp = stationCp(f, M, Math.abs(eta), k, nNodes);
        if (colouring === 'pressure') [r, g, b] = cpColor(cp);
        else {
          // cavitation: grey, amber near the cavitation threshold, magenta where Cp < −σ
          const m = cp + sigma;
          if (m < 0) [r, g, b] = [0.95, 0.15, 0.85];
          else if (m < 0.25 * sigma) [r, g, b] = [0.98, 0.7, 0.2];
        }
      }
      c3.setRGB(r, g, b, THREE.SRGBColorSpace);
      col.setXYZ(vi, c3.r, c3.g, c3.b);
    };
    stations.forEach((eta, s) => {
      const side = s < N_SPAN_MESH ? -1 : 1;
      for (let k = 0; k < nNodes; k++) put(s * nNodes + k, eta, side, k);
    });
    for (let k = 0; k < nNodes; k++) {
      put(nS * nNodes + k, 1, -1, k);
      put(nS * nNodes + nNodes + k, 1, 1, k);
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.geo.computeVertexNormals();
    this.geo.computeBoundingSphere();
  }

  dispose() {
    this.geo.dispose();
  }
}

/** Flat cross-section of a foil at semi-span fraction eta (shown where the foil is cut away). */
export function sectionCap(f: FlowFoil, eta: number, material: THREE.Material): THREE.Mesh {
  const n = f.meshNodes.length / 2;
  const c = Math.max(f.cr * chordRatio(f.planform, f.lambda, Math.min(1, eta)), 0.004 * f.cr);
  const cP = Math.cos(f.pitch),
    sP = Math.sin(f.pitch);
  const y = (eta * f.b) / 2;
  const pos = new Float32Array(3 * n);
  for (let k = 0; k < n; k++) {
    const X = (f.meshNodes[2 * k] - 0.25) * c,
      Z = f.meshNodes[2 * k + 1] * c;
    // a hair on the kept side of the cut so it is not clipped itself
    pos.set([f.x0 + X * cP + Z * sP, f.z0 - X * sP + Z * cP, -y - 1e-4 * f.cr], 3 * k);
  }
  const idx: number[] = [];
  for (let k = 0; k < Math.floor((n - 1) / 2); k++)
    idx.push(k, n - 1 - k, k + 1, k + 1, n - 1 - k, n - 2 - k);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  return mesh;
}

/** Symmetric NACA 00xx half-thickness at x (unit chord). */
function nacaT(x: number, t: number) {
  return (
    5 * t * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)
  );
}

/** Strut dimensions used for display and for its surface wake (typical, not designed). */
export function strutSize(main: FlowFoil) {
  const chord = Math.min(0.5, Math.max(0.06, 0.8 * main.cr));
  const tc = 0.13;
  return { chord, tc, area: 0.685 * tc * chord * chord };
}

/** Vertical strut from the main foil up to the board, plus fuselage when there are two foils, plus the board. */
export function buildCraft(
  state: FlowState,
  clearance: number,
  material: THREE.Material,
  boardMaterial: THREE.Material,
) {
  const group = new THREE.Group();
  const main = state.foils[0];
  const { chord, tc } = strutSize(main);
  // strut: extruded NACA 00xx outline, vertical
  const shape = new THREE.Shape();
  const n = 40;
  for (let i = 0; i <= n; i++) {
    const x = (1 - Math.cos((Math.PI * i) / n)) / 2;
    const p = new THREE.Vector2((x - 0.25) * chord, nacaT(x, tc) * chord);
    if (i === 0) shape.moveTo(p.x, p.y);
    else shape.lineTo(p.x, p.y);
  }
  for (let i = n - 1; i >= 1; i--) {
    const x = (1 - Math.cos((Math.PI * i) / n)) / 2;
    shape.lineTo((x - 0.25) * chord, -nacaT(x, tc) * chord);
  }
  const height = -main.z0 + clearance;
  const strutGeo = new THREE.ExtrudeGeometry(shape, {
    depth: height,
    bevelEnabled: false,
    steps: 1,
  });
  // extrusion runs along +z of the shape; turn it upright (three y)
  strutGeo.rotateX(-Math.PI / 2);
  const strut = new THREE.Mesh(strutGeo, material);
  strut.position.copy(toThree(main.x0, 0, main.z0));
  group.add(strut);

  const second = state.foils[1];
  if (second) {
    const r = Math.max(0.01, 0.1 * main.cr);
    const xa = Math.min(main.x0, second.x0) - 0.6 * main.cr;
    const xb = Math.max(main.x0, second.x0) + 0.6 * second.cr;
    const fus = new THREE.Mesh(new THREE.CapsuleGeometry(r, xb - xa - 2 * r, 6, 16), material);
    fus.rotation.z = Math.PI / 2;
    fus.position.copy(toThree((xa + xb) / 2, 0, main.z0));
    group.add(fus);
    if (Math.abs(second.z0 - main.z0) > 0.5 * r) {
      const len = Math.abs(second.z0 - main.z0);
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.6 * r, 0.6 * r, len, 12), material);
      post.position.copy(toThree(second.x0, 0, (second.z0 + main.z0) / 2));
      group.add(post);
    }
  }

  // board, sized from the span of the main foil (illustrative)
  const L = Math.min(6, Math.max(1.1, 0.8 * main.b + 0.6));
  const W = Math.min(2, Math.max(0.45, 0.4 * L));
  const T = Math.min(0.25, Math.max(0.07, 0.06 * L));
  const outline = new THREE.Shape();
  const m = 48;
  for (let i = 0; i <= m; i++) {
    const t = (i / m) * Math.PI * 2;
    // rounded nose, squarer tail
    const cx = Math.cos(t),
      cy = Math.sin(t);
    const x = (cx >= 0 ? Math.pow(cx, 0.8) : -Math.pow(-cx, 0.35)) * (L / 2);
    const y = Math.sign(cy) * Math.pow(Math.abs(cy), 0.6) * (W / 2);
    if (i === 0) outline.moveTo(x, y);
    else outline.lineTo(x, y);
  }
  const boardGeo = new THREE.ExtrudeGeometry(outline, {
    depth: T,
    bevelEnabled: true,
    bevelThickness: 0.3 * T,
    bevelSize: 0.3 * T,
    bevelSegments: 3,
  });
  boardGeo.rotateX(-Math.PI / 2);
  const board = new THREE.Mesh(boardGeo, boardMaterial);
  // board nose points upstream (−x)
  board.rotation.y = Math.PI;
  board.position.copy(toThree(main.x0 + 0.1 * L, 0, clearance + 0.3 * T));
  group.add(board);
  // where a rider would stand: over the strut, on the deck (bevels add 0.3·T above and below)
  return { group, deck: toThree(main.x0, 0, clearance + 1.6 * T) };
}

/** Standing height of the scale figure, m. */
export const PERSON_HEIGHT = 1.75;

/**
 * Flat silhouette of a 1.75 m adult, front view, feet at the origin, facing +z.
 * Shown standing on the board for scale; the scene turns it to face the camera.
 */
export function buildPerson(material: THREE.Material): THREE.Mesh {
  const H = PERSON_HEIGHT;
  // right half of the outline from the neck down (x, y in m for a 1.75 m figure), mirrored for the left
  const half: [number, number][] = [
    [0.055, 1.5],
    [0.19, 1.44],
    [0.225, 1.4],
    [0.245, 1.12],
    [0.255, 0.86],
    [0.245, 0.8],
    [0.215, 0.81],
    [0.205, 0.95],
    [0.19, 1.25],
    [0.165, 1.12],
    [0.17, 0.93],
    [0.16, 0.5],
    [0.13, 0.07],
    [0.17, 0.02],
    [0.165, 0],
    [0.045, 0],
    [0.05, 0.07],
    [0.055, 0.5],
    [0.02, 0.86],
  ];
  const s = H / 1.75;
  const body = new THREE.Shape();
  half.forEach(([x, y], i) => (i === 0 ? body.moveTo(x * s, y * s) : body.lineTo(x * s, y * s)));
  for (let i = half.length - 1; i >= 0; i--) body.lineTo(-half[i][0] * s, half[i][1] * s);
  const head = new THREE.Shape();
  head.absellipse(0, 1.625 * s, 0.095 * s, 0.118 * s, 0, Math.PI * 2, false, 0);
  const neck = new THREE.Shape();
  neck.moveTo(-0.05 * s, 1.49 * s);
  neck.lineTo(0.05 * s, 1.49 * s);
  neck.lineTo(0.045 * s, 1.54 * s);
  neck.lineTo(-0.045 * s, 1.54 * s);
  const mesh = new THREE.Mesh(new THREE.ShapeGeometry([body, neck, head], 24), material);
  mesh.frustumCulled = false;
  return mesh;
}
