/// <reference lib="webworker" />
/**
 * Runs the free-surface wave simulation for the 3-D view at a steady rate and
 * posts the surface elevation. Also traces streamlines on request.
 */
import { SurfaceSim, gridFor, type SurfaceGrid, type SurfaceParams } from './surface';
import type { FlowState } from './types';
import { traceStreamline } from './velocity';

export type SurfaceWorkerIn =
  | { kind: 'params'; params: SurfaceParams; lref: number }
  | { kind: 'clock'; playing: boolean; timeScale: number }
  | { kind: 'streamlines'; id: number; state: FlowState; seeds: number[]; xEnd: number };

export type SurfaceWorkerOut =
  | { kind: 'frame'; grid: SurfaceGrid; eta: Float32Array; simTime: number; stepMs: number }
  | { kind: 'streamlines'; id: number; lines: { pts: Float32Array; cp: Float32Array }[] };

const RATE = 30;
let sim: SurfaceSim | null = null;
let pending: { params: SurfaceParams; lref: number } | null = null;
let playing = true;
let timeScale = 0.1;
let simTime = 0;
let lastStepMs = 0;

const post = (m: SurfaceWorkerOut, transfer: Transferable[] = []) =>
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(m, transfer);

function apply() {
  if (!pending) return;
  const { params, lref } = pending;
  pending = null;
  const dt = timeScale / RATE;
  const want = gridFor(params.U, lref);
  const g = sim?.grid;
  // re-grid when the wake length scale has changed a lot; otherwise keep the waves and let them evolve
  if (!g || want.Lx / g.Lx > 1.35 || want.Lx / g.Lx < 0.74) {
    sim = new SurfaceSim(want);
    sim.setParams(params, dt);
    sim.initSteady(30);
  } else {
    sim!.setParams(params, dt);
  }
  send();
}

function send() {
  if (!sim) return;
  const eta = new Float32Array(sim.eta);
  post({ kind: 'frame', grid: sim.grid, eta, simTime, stepMs: lastStepMs }, [eta.buffer]);
}

setInterval(() => {
  apply();
  if (!sim || !playing) return;
  const t0 = performance.now();
  sim.step();
  simTime += sim.timeStep;
  lastStepMs = performance.now() - t0;
  send();
}, 1000 / RATE);

self.onmessage = (ev: MessageEvent<SurfaceWorkerIn>) => {
  const m = ev.data;
  if (m.kind === 'params') {
    pending = { params: m.params, lref: m.lref };
  } else if (m.kind === 'clock') {
    playing = m.playing;
    if (m.timeScale !== timeScale) {
      timeScale = m.timeScale;
      const cur = sim?.current;
      if (sim && cur) sim.setParams(cur, timeScale / RATE);
    }
  } else if (m.kind === 'streamlines') {
    const lines = [];
    for (let i = 0; i < m.seeds.length; i += 3) {
      lines.push(traceStreamline(m.state, [m.seeds[i], m.seeds[i + 1], m.seeds[i + 2]], m.xEnd));
    }
    post(
      { kind: 'streamlines', id: m.id, lines },
      lines.flatMap((l) => [l.pts.buffer, l.cp.buffer]),
    );
  }
};
