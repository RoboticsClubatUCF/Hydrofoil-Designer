/// <reference lib="webworker" />
import { parseProfile } from '../physics/profile/parse';
import { parsePolar } from '../physics/profile/polar';
import { buildSectionModel, type SectionModel } from '../physics/profile/sectionModel';
import { simulate } from '../simulate/simulate';
import { solveDesign } from '../solver/solve';
import { buildFlow, type FlowSection } from '../flow3d/build';
import { prepareNearField } from '../flow3d/nearField';
import type { SectionSlot, WorkerRequest, WorkerResponse } from './protocol';

const sections: Record<SectionSlot, SectionModel | null> = { 1: null, 2: null };
/** last Reynolds number of each foil, to start the next solve from */
const lastRe: Record<SectionSlot, number | undefined> = { 1: undefined, 2: undefined };

/** near-field data for the 3-D view, built once per section */
const nearFields = new WeakMap<SectionModel, FlowSection>();
function flowSection(slot: SectionSlot): FlowSection | null {
  const model = sections[slot];
  if (!model) return null;
  let f = nearFields.get(model);
  if (!f) {
    f = { model, near: prepareNearField(model.geometry) };
    nearFields.set(model, f);
  }
  return f;
}

const post = (m: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(m);

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data;
  const t0 = performance.now();
  try {
    if (msg.kind === 'section') {
      const slot = msg.slot;
      if (!msg.profileText.trim()) {
        sections[slot] = null;
        post({ kind: 'section', id: msg.id, slot, ok: false, error: '' });
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
      const section = buildSectionModel(profile, polars, msg.kappa);
      sections[slot] = section;
      // the secondary foil may share the main section
      lastRe[2] = undefined;
      if (slot === 1) lastRe[1] = undefined;
      const g = section.geometry;
      post({
        kind: 'section',
        id: msg.id,
        slot,
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
    } else if (msg.kind === 'flow') {
      const state = buildFlow(msg.request, flowSection);
      post({ kind: 'flow', id: msg.id, ok: true, state, ms: performance.now() - t0 });
    } else {
      const foil2 = msg.input.foil2;
      const section2 = foil2 && !foil2.sameSection ? sections[2] : null;
      const result = solveDesign(msg.input, sections[1], {
        reHint: lastRe[1],
        reHint2: lastRe[2],
        section2,
      });
      if (Number.isFinite(result.values.Re)) lastRe[1] = result.values.Re;
      if (Number.isFinite(result.values.Re2)) lastRe[2] = result.values.Re2;
      const sim = simulate(msg.input, sections[1], result, section2);
      post({ kind: 'solve', id: msg.id, ok: true, result, sim, ms: performance.now() - t0 });
    }
  } catch (e) {
    if (msg.kind === 'section') sections[msg.slot] = null;
    post({
      kind: msg.kind,
      id: msg.id,
      ...(msg.kind === 'section' ? { slot: msg.slot } : {}),
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    } as WorkerResponse);
  }
};
