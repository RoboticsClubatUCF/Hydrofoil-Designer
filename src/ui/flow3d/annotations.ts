/**
 * Measurements and force arrows over the foils in the 3-D view: dimension
 * lines with labels for span, chords and depth, and the lift and drag carried
 * along the span drawn as arrows from the quarter chord and trailing edge.
 */
import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  angleMarker,
  chordAt,
  chordPoint,
  foilDimensions,
  spanLoads,
  type Dimension,
  type Vec3,
} from '../../flow3d/loads';
import type { FlowFoil, FlowState } from '../../flow3d/types';
import { toThree } from './craft';

/** Drag arrows are drawn this many times longer than lift arrows of the same force. */
export const DRAG_MAGNIFY = 10;

/** Arrows per half span. */
const N_ARROW = 8;

export interface AnnotationFormat {
  span: (m: number) => string;
  chord: (m: number) => string;
  depth: (m: number) => string;
  area: (m2: number) => string;
  force: (N: number) => string;
}

const COLOUR = { dim: 0xf2f6f8, lift: 0x3ddc84, drag: 0xffa23d };

const v3 = (p: Vec3) => toThree(p[0], p[1], p[2]);

function label(text: string, cls: string, at: THREE.Vector3, anchorY = 0.5) {
  const el = document.createElement('div');
  el.className = `f3-tag ${cls}`;
  el.textContent = text;
  const o = new CSS2DObject(el);
  o.position.copy(at);
  o.center.set(0.5, anchorY);
  return o;
}

/** Cone with its tip at `tip`, pointing along `dir` (three.js frame). */
function cone(tip: THREE.Vector3, dir: THREE.Vector3, length: number) {
  const g = new THREE.ConeGeometry(0.32 * length, length, 12);
  g.translate(0, -length / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir));
  g.translate(tip.x, tip.y, tip.z);
  return g;
}

export class Annotations {
  readonly group = new THREE.Group();
  private dims = new THREE.Group();
  private forces = new THREE.Group();
  private lineMats: LineMaterial[];
  private dimLine: LineMaterial;
  private liftLine: LineMaterial;
  private dragLine: LineMaterial;
  private dimHead: THREE.MeshBasicMaterial;
  private liftHead: THREE.MeshBasicMaterial;
  private dragHead: THREE.MeshBasicMaterial;
  /** arrow length per N/m of lift, m; kept between updates so arrows grow with the load */
  private scale = 0;
  private labelsShown = true;
  private clip: THREE.Plane | null = null;

  constructor() {
    // dimensions are drawn over everything; force arrows sit in the scene and are hidden by the foil
    // (they write depth so the water surface, drawn later, does not paint over them)
    const line = (color: number, overlay: boolean) =>
      new LineMaterial({
        color,
        linewidth: overlay ? 1.5 : 2,
        depthTest: !overlay,
        depthWrite: !overlay,
        transparent: overlay,
        fog: false,
      });
    const head = (color: number, overlay: boolean) =>
      new THREE.MeshBasicMaterial({
        color,
        depthTest: !overlay,
        depthWrite: !overlay,
        transparent: overlay,
        fog: false,
      });
    this.dimLine = line(COLOUR.dim, true);
    this.liftLine = line(COLOUR.lift, false);
    this.dragLine = line(COLOUR.drag, false);
    this.lineMats = [this.dimLine, this.liftLine, this.dragLine];
    this.dimHead = head(COLOUR.dim, true);
    this.liftHead = head(COLOUR.lift, false);
    this.dragHead = head(COLOUR.drag, false);
    this.group.add(this.dims, this.forces);
  }

  setVisible(dims: boolean, forces: boolean) {
    this.dims.visible = dims;
    this.forces.visible = forces;
    this.applyLabels();
  }

  /** Labels are hidden when the camera is far away, where they would pile up on each other. */
  setLabelsVisible(v: boolean) {
    if (v === this.labelsShown) return;
    this.labelsShown = v;
    this.applyLabels();
  }

  /** Cut away the same side as the foils (null: nothing cut). */
  setClip(plane: THREE.Plane | null) {
    this.clip = plane;
    const planes = plane ? [plane] : [];
    for (const m of [...this.lineMats, this.dimHead, this.liftHead, this.dragHead]) {
      if ((m.clippingPlanes?.length ?? 0) !== planes.length) m.needsUpdate = true;
      m.clippingPlanes = planes;
    }
    this.applyLabels();
  }

  private applyLabels() {
    for (const g of [this.dims, this.forces])
      for (const o of g.children)
        if (o instanceof CSS2DObject) {
          // with the near side cut away the measurement labels would sit over the section: hide them
          o.visible =
            this.labelsShown &&
            (!this.clip || (g !== this.dims && this.clip.distanceToPoint(o.position) >= 0));
          // hide at once: the label renderer only runs while the view is on screen
          if (!o.visible || !g.visible) o.element.style.display = 'none';
        }
  }

  setResolution(w: number, h: number) {
    for (const m of this.lineMats) m.resolution.set(w, h);
  }

  update(state: FlowState, fmt: AnnotationFormat) {
    this.clear();
    this.buildDims(state, fmt);
    this.buildForces(state, fmt);
    this.applyLabels();
  }

  private addLines(group: THREE.Group, pts: THREE.Vector3[], mat: LineMaterial, order: number) {
    if (!pts.length) return;
    const g = new LineSegmentsGeometry();
    g.setPositions(pts.flatMap((p) => [p.x, p.y, p.z]));
    const l = new LineSegments2(g, mat);
    l.renderOrder = order;
    group.add(l);
  }

  private addHeads(
    group: THREE.Group,
    geos: THREE.BufferGeometry[],
    mat: THREE.Material,
    order: number,
  ) {
    if (!geos.length) return;
    const merged = mergeGeometries(geos);
    geos.forEach((g) => g.dispose());
    if (!merged) return;
    const m = new THREE.Mesh(merged, mat);
    m.renderOrder = order;
    group.add(m);
  }

  private buildDims(state: FlowState, fmt: AnnotationFormat) {
    const lines: THREE.Vector3[] = [];
    const heads: THREE.BufferGeometry[] = [];
    for (const f of state.foils) {
      const dims = foilDimensions(f);
      for (const d of dims) {
        const a = v3(d.a),
          b = v3(d.b);
        const len = a.distanceTo(b);
        const hl = Math.min(0.2 * len, 0.12 * f.cr);
        const dir = b.clone().sub(a).normalize();
        // line between the arrowheads, arrowheads pointing out to the extension lines
        lines.push(a.clone().addScaledVector(dir, hl), b.clone().addScaledVector(dir, -hl));
        heads.push(cone(a, dir.clone().negate(), hl), cone(b, dir, hl));
        for (const [p, q] of d.ext) lines.push(v3(p), v3(q));
        // the span label sits over the far half so it does not crowd the labels at the root
        const tag = label(
          dimText(d, fmt),
          'dim',
          a.clone().lerp(b, d.kind === 'span' ? 0.75 : 0.5),
        );
        if (d.kind === 'span') {
          const sub = document.createElement('small');
          sub.textContent = `area ${fmt.area(f.S)} · AR ${f.AR.toFixed(1)}`;
          tag.element.append(sub);
        }
        this.dims.add(tag);
      }

      // angle of attack: horizontal and chord line side by side, beyond the far tip
      const m = angleMarker(f);
      lines.push(v3(m.ref[0]), v3(m.ref[1]), v3(m.chord[0]), v3(m.chord[1]));
      for (let i = 0; i < m.arc.length - 1; i++) lines.push(v3(m.arc[i]), v3(m.arc[i + 1]));
      const tag = label(`angle of attack ${degText(f.op.alpha)}`, 'dim', v3(m.label), 1);
      // with two foils the other's downwash or upwash tilts the flow the foil meets
      if (Math.abs(f.pitch - f.op.alpha) > (0.05 * Math.PI) / 180) {
        const sub = document.createElement('small');
        sub.textContent = `chord ${degText(f.pitch)} to the free stream`;
        tag.element.append(sub);
      }
      this.dims.add(tag);
    }
    this.addLines(this.dims, lines, this.dimLine, 10);
    this.addHeads(this.dims, heads, this.dimHead, 10);
  }

  private buildForces(state: FlowState, fmt: AnnotationFormat) {
    const L = state.lref;
    // arrows at the middle of equal strips of the span, so none hides inside the strut
    const at = Array.from({ length: N_ARROW }, (_, i) => (i + 0.5) / N_ARROW);
    const etaArrow = [...at.map((e) => -e).reverse(), ...at];
    const etaCurve = Array.from({ length: 61 }, (_, i) => -1 + (2 * i) / 60);
    const loads = state.foils.map((f) => ({
      f,
      arrows: spanLoads(f, etaArrow),
      curve: spanLoads(f, etaCurve),
    }));

    // one scale for every foil; reset only when the arrows would be far too short, or so long
    // they would reach the surface (the water hides anything above it)
    const peak = Math.max(...loads.flatMap((x) => x.curve.lift.map(Math.abs)), 1e-9);
    const depth = Math.min(...state.foils.map((f) => -f.z0));
    const target = Math.min(0.25 * L, 0.6 * depth);
    const longest = Math.min(0.5 * L, 0.85 * depth);
    if (!(this.scale > 0) || this.scale * peak < 0.4 * target || this.scale * peak > longest)
      this.scale = target / peak;
    const kL = this.scale;
    const kD = this.scale * DRAG_MAGNIFY;
    // sized to the chord as well, so on a long, slender wing they do not swamp the section view
    const headLen = Math.min(0.03 * L, 0.3 * Math.min(...state.foils.map((f) => f.cr)));

    const liftLines: THREE.Vector3[] = [];
    const dragLines: THREE.Vector3[] = [];
    const liftHeads: THREE.BufferGeometry[] = [];
    const dragHeads: THREE.BufferGeometry[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    const down = new THREE.Vector3(0, -1, 0);
    const aft = new THREE.Vector3(1, 0, 0);
    const arrow = (
      from: THREE.Vector3,
      dir: THREE.Vector3,
      len: number,
      lines: THREE.Vector3[],
      heads: THREE.BufferGeometry[],
    ) => {
      if (len < 1e-6) return;
      const hl = Math.min(headLen, 0.6 * len);
      const tip = from.clone().addScaledVector(dir, len);
      lines.push(from, tip.clone().addScaledVector(dir, -0.9 * hl));
      heads.push(cone(tip, dir, hl));
    };
    const quarter = (f: FlowFoil, eta: number) => v3(chordPoint(f, 0, (eta * f.b) / 2));
    const trailing = (f: FlowFoil, eta: number) =>
      v3(chordPoint(f, 0.75 * chordAt(f, eta), (eta * f.b) / 2));

    for (const { f, arrows, curve } of loads) {
      arrows.eta.forEach((e, i) => {
        const l = arrows.lift[i];
        arrow(quarter(f, e), l >= 0 ? up : down, Math.abs(l) * kL, liftLines, liftHeads);
        arrow(trailing(f, e), aft, Math.max(0, arrows.drag[i]) * kD, dragLines, dragHeads);
      });
      // envelopes through the arrow tips
      const liftPts = curve.eta.map((e, i) =>
        quarter(f, e).add(new THREE.Vector3(0, curve.lift[i] * kL, 0)),
      );
      const dragPts = curve.eta.map((e, i) =>
        trailing(f, e).add(new THREE.Vector3(curve.drag[i] * kD, 0, 0)),
      );
      for (let i = 0; i < etaCurve.length - 1; i++) {
        liftLines.push(liftPts[i], liftPts[i + 1]);
        dragLines.push(dragPts[i], dragPts[i + 1]);
      }
      const mid = (etaCurve.length - 1) / 2;
      const nearHalf = mid / 2;
      const lift = label(
        `lift ${fmt.force(f.op.L)}`,
        'lift',
        liftPts[mid].clone(),
        f.op.L >= 0 ? 1.15 : -0.15,
      );
      const drag = label(
        `drag ${fmt.force(f.op.D)} (drawn ×${DRAG_MAGNIFY})`,
        'drag',
        dragPts[nearHalf].clone().add(new THREE.Vector3(0.02 * L, 0, 0)),
      );
      drag.center.set(0, 0.5);
      this.forces.add(lift, drag);
    }
    this.addLines(this.forces, liftLines, this.liftLine, 0);
    this.addLines(this.forces, dragLines, this.dragLine, 0);
    this.addHeads(this.forces, liftHeads, this.liftHead, 0);
    this.addHeads(this.forces, dragHeads, this.dragHead, 0);
  }

  private clear() {
    for (const g of [this.dims, this.forces]) {
      for (const o of g.children) {
        if (o instanceof THREE.Mesh || o instanceof LineSegments2) o.geometry.dispose();
      }
      // removing a CSS2DObject also takes its element out of the page
      g.clear();
    }
  }

  dispose() {
    this.clear();
    for (const m of [...this.lineMats, this.dimHead, this.liftHead, this.dragHead]) m.dispose();
  }
}

const degText = (r: number) => `${((r * 180) / Math.PI).toFixed(2)}°`;

function dimText(d: Dimension, fmt: AnnotationFormat) {
  switch (d.kind) {
    case 'span':
      return `span ${fmt.span(d.value)}`;
    case 'rootChord':
      return `root chord ${fmt.chord(d.value)}`;
    case 'tipChord':
      return `tip chord ${fmt.chord(d.value)}`;
    case 'depth':
      return `depth ${fmt.depth(d.value)}`;
  }
}
