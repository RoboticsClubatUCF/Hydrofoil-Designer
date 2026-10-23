/// <reference lib="webworker" />
import { parseProfile } from '../physics/profile/parse';
import { parsePolar } from '../physics/profile/polar';
import { buildSectionModel, type SectionModel } from '../physics/profile/sectionModel';
import { simulate } from '../simulate/simulate';
import { solveDesign } from '../solver/solve';
import type { WorkerRequest, WorkerResponse } from './protocol';

let section: SectionModel | null = null;
let lastRe: number | undefined;

const post = (m: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  const t0 = performance.now();
  try {
    if (msg.kind === 'section') {
      if (!msg.profileText.trim()) {
        section = null;
        post({ kind: 'section', id: msg.id, ok: false, error: '' });
        return;
      }
      const profile = parseProfile(msg.profileText);
      const polars = msg.polarTexts.flatMap((t) => {
        try {
          return [parsePolar(t)];
        } catch {
          return [];
        }
      });
      section = buildSectionModel(profile, polars, msg.kappa);
      lastRe = undefined;
      const g = section.geometry;
      post({
        kind: 'section',
        id: msg.id,
        ok: true,
        ms: performance.now() - t0,
        info: {
          name: g.name,
          mode: section.mode,
          notes: section.notes,
          reRange: section.reRange,
          tMax: g.tMax,
          xTMax: g.xTMax,
          camberMax: g.camberMax,
          xCamberMax: g.xCamberMax,
          leRadius: g.leRadius,
          teGap: g.teGap,
          teAngleDeg: g.teAngleDeg,
          area: g.area,
          ixx: g.ixx,
          sectionModulus: g.sectionModulus,
          centroid: g.centroid,
          upper: g.upper.filter((_, i) => i % 3 === 0 || i === g.upper.length - 1),
          lower: g.lower.filter((_, i) => i % 3 === 0 || i === g.lower.length - 1),
          camberLine: g.camberLine.filter((_, i) => i % 4 === 0),
          inviscidA0: section.inviscid.a0,
          inviscidAlphaL0: section.inviscid.alphaL0,
          kappa: section.kappa,
        },
      });
    } else {
      const result = solveDesign(msg.input, section, { reHint: lastRe });
      if (Number.isFinite(result.values.Re)) lastRe = result.values.Re;
      const sim = simulate(msg.input, section, result);
      post({ kind: 'solve', id: msg.id, ok: true, result, sim, ms: performance.now() - t0 });
    }
  } catch (e) {
    if (msg.kind === 'section') section = null;
    post({
      kind: msg.kind,
      id: msg.id,
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    } as WorkerResponse);
  }
};
