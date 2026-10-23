/** App state: the design document, results from the worker, and persistence. */
import { create } from 'zustand';
import { WATER_SALINITY, type WaterType } from '../physics/fluid';
import { parseProfile, type ParsedProfile } from '../physics/profile/parse';
import { parsePolar, type Polar } from '../physics/profile/polar';
import { DEFAULT_KAPPA } from '../physics/profile/sectionModel';
import { MATERIALS, materialById } from '../physics/structure/materials';
import { SYSTEM_DEFAULTS, getUnit } from '../physics/units';
import type { PlanformType } from '../physics/wing/planform';
import type { Simulation } from '../simulate/simulate';
import { VAR, foilId } from '../solver/variables';
import {
  DEFAULT_REQUIREMENTS,
  type DesignInput,
  type Objective,
  type Requirements,
  type SolveResult,
} from '../solver/types';
import type { SectionInfo, SectionSlot, WorkerRequest, WorkerResponse } from '../worker/protocol';
import type { FlowRequest, FlowState } from '../flow3d/types';

/** The secondary foil: whether it is included and which section it uses. */
export interface SecondFoilDoc {
  enabled: boolean;
  /** true: same section (profile and polars) as the main foil */
  sameSection: boolean;
  profileText: string;
  polarTexts: string[];
  planform: PlanformType;
}

export const BLANK_FOIL2: SecondFoilDoc = {
  enabled: false,
  sameSection: true,
  profileText: '',
  polarTexts: [],
  planform: 'rectangular',
};

export interface DocState {
  version: 1;
  profileText: string;
  polarTexts: string[];
  kappa: number;
  inputs: Record<string, number>;
  units: Record<string, string>;
  unitSystem: 'SI' | 'US';
  planform: PlanformType;
  waterType: WaterType;
  customSalinity: number;
  materialId: string;
  requirements: Requirements;
  objective: Objective;
  foil2: SecondFoilDoc;
}

export const BLANK_DOC: DocState = {
  version: 1,
  profileText: '',
  polarTexts: [],
  kappa: DEFAULT_KAPPA,
  inputs: {},
  units: {},
  unitSystem: 'SI',
  planform: 'rectangular',
  waterType: 'fresh',
  customSalinity: 0,
  materialId: MATERIALS[0].id,
  requirements: DEFAULT_REQUIREMENTS,
  objective: 'minDrag',
  foil2: BLANK_FOIL2,
};

export interface PolarEntry {
  text: string;
  polar: Polar | null;
  error: string | null;
}

export type Theme = 'auto' | 'light' | 'dark';

interface AppState extends DocState {
  profile: ParsedProfile | null;
  profileError: string | null;
  polars: PolarEntry[];
  sectionInfo: SectionInfo | null;
  sectionBusy: boolean;
  result: SolveResult | null;
  sim: Simulation | null;
  solving: boolean;
  solveMs: number;
  workerError: string | null;
  theme: Theme;
  flash: string | null;
  /** secondary foil's own profile (when it does not share the main section) */
  profile2: ParsedProfile | null;
  profileError2: string | null;
  polars2: PolarEntry[];
  sectionInfo2: SectionInfo | null;
  sectionBusy2: boolean;
  /** foil shown in the design form and results */
  viewFoil: 1 | 2;

  setProfileText(t: string, slot?: SectionSlot): void;
  addPolar(t: string, slot?: SectionSlot): void;
  removePolar(i: number, slot?: SectionSlot): void;
  setKappa(k: number): void;
  setInput(id: string, si: number | null): void;
  setUnit(id: string, unit: string): void;
  setUnitSystem(s: 'SI' | 'US'): void;
  setPlanform(p: PlanformType, foil?: 1 | 2): void;
  setFoil2(patch: Partial<Pick<SecondFoilDoc, 'enabled' | 'sameSection'>>): void;
  setViewFoil(f: 1 | 2): void;
  setWater(t: WaterType, custom?: number): void;
  setMaterial(id: string): void;
  setRequirement<K extends keyof Requirements>(k: K, v: Requirements[K]): void;
  setObjective(o: Objective): void;
  setTheme(t: Theme): void;
  loadDoc(d: Partial<DocState>): void;
  reset(): void;
  flashVar(id: string): void;
}

// ---------- worker plumbing ----------
let worker: Worker | null = null;
let seq = 0;
const latestSection: Record<SectionSlot, number> = { 1: 0, 2: 0 };
let latestSolve = 0;
let solveTimer: ReturnType<typeof setTimeout> | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../worker/engine.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (ev: MessageEvent<WorkerResponse>) => handleResponse(ev.data);
    worker.onerror = (e) =>
      useStore.setState({
        workerError: e.message || 'Calculation worker failed',
        solving: false,
        sectionBusy: false,
      });
  }
  return worker;
}

function send(m: WorkerRequest) {
  getWorker().postMessage(m);
}

const flowWaiters = new Map<number, (m: Extract<WorkerResponse, { kind: 'flow' }>) => void>();

/** Ask the worker for the 3-D flow of the current design at an operating point. */
export function requestFlow(request: FlowRequest): Promise<FlowState> {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    flowWaiters.set(id, (m) => (m.ok ? resolve(m.state) : reject(new Error(m.error))));
    send({ kind: 'flow', id, request });
  });
}

function handleResponse(m: WorkerResponse) {
  if (m.kind === 'flow') {
    flowWaiters.get(m.id)?.(m);
    flowWaiters.delete(m.id);
    return;
  }
  if (m.kind === 'section') {
    if (m.id !== latestSection[m.slot]) return;
    const info = m.ok ? m.info : null;
    useStore.setState(
      m.slot === 1
        ? { sectionBusy: false, sectionInfo: info }
        : { sectionBusy2: false, sectionInfo2: info },
    );
  } else {
    if (m.id !== latestSolve) return;
    if (m.ok)
      useStore.setState({
        result: m.result,
        sim: m.sim,
        solving: false,
        solveMs: m.ms,
        workerError: null,
      });
    else useStore.setState({ solving: false, workerError: m.error });
  }
}

export function salinityOf(s: Pick<DocState, 'waterType' | 'customSalinity'>): number {
  return s.waterType === 'custom' ? s.customSalinity : WATER_SALINITY[s.waterType];
}

export function designInput(s: DocState): DesignInput {
  const material = s.materialId === 'custom' ? null : (materialById(s.materialId) ?? null);
  return {
    values: { ...s.inputs },
    planform: s.planform,
    salinity: salinityOf(s),
    material,
    requirements: s.requirements,
    objective: s.objective,
    foil2: s.foil2.enabled
      ? { planform: s.foil2.planform, sameSection: s.foil2.sameSection }
      : null,
  };
}

function requestSection(slot: SectionSlot = 1) {
  const s = useStore.getState();
  const id = ++seq;
  latestSection[slot] = id;
  const profile = slot === 1 ? s.profile : s.profile2;
  const polars = slot === 1 ? s.polars : s.polars2;
  useStore.setState(slot === 1 ? { sectionBusy: !!profile } : { sectionBusy2: !!profile });
  send({
    kind: 'section',
    id,
    slot,
    profileText: profile ? (slot === 1 ? s.profileText : s.foil2.profileText) : '',
    polarTexts: polars.filter((p) => p.polar).map((p) => p.text),
    kappa: s.kappa,
  });
  requestSolve(0);
}

function requestSolve(delay = 180) {
  if (solveTimer) clearTimeout(solveTimer);
  useStore.setState({ solving: true });
  solveTimer = setTimeout(() => {
    const s = useStore.getState();
    latestSolve = ++seq;
    send({ kind: 'solve', id: latestSolve, input: designInput(s) });
    persist(s);
  }, delay);
}

// ---------- persistence ----------
const STORAGE_KEY = 'hydrofoil-designer:v1';

export function docOf(s: DocState): DocState {
  return {
    version: 1,
    profileText: s.profileText,
    polarTexts: s.polarTexts,
    kappa: s.kappa,
    inputs: s.inputs,
    units: s.units,
    unitSystem: s.unitSystem,
    planform: s.planform,
    waterType: s.waterType,
    customSalinity: s.customSalinity,
    materialId: s.materialId,
    requirements: s.requirements,
    objective: s.objective,
    foil2: s.foil2,
  };
}

function persist(s: DocState) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(docOf(s)));
  } catch {
    // storage unavailable (private mode etc.) — the app works without it
  }
}

export function loadStoredDoc(): Partial<DocState> | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Partial<DocState>) : null;
  } catch {
    return null;
  }
}

export function sanitiseDoc(d: Partial<DocState>): DocState {
  const out: DocState = { ...BLANK_DOC, ...d, version: 1 };
  out.requirements = { ...DEFAULT_REQUIREMENTS, ...(d.requirements ?? {}) };
  out.inputs = Object.fromEntries(
    Object.entries(d.inputs ?? {}).filter(
      ([k, v]) => VAR[k]?.input && typeof v === 'number' && Number.isFinite(v),
    ),
  );
  out.polarTexts = Array.isArray(d.polarTexts)
    ? d.polarTexts.filter((t) => typeof t === 'string')
    : [];
  out.profileText = typeof d.profileText === 'string' ? d.profileText : '';
  if (!['rectangular', 'tapered', 'elliptical'].includes(out.planform))
    out.planform = 'rectangular';
  if (!['SI', 'US'].includes(out.unitSystem)) out.unitSystem = 'SI';
  const f2: Partial<SecondFoilDoc> = d.foil2 && typeof d.foil2 === 'object' ? d.foil2 : {};
  out.foil2 = {
    enabled: f2.enabled === true,
    sameSection: f2.sameSection !== false,
    profileText: typeof f2.profileText === 'string' ? f2.profileText : '',
    polarTexts: Array.isArray(f2.polarTexts)
      ? f2.polarTexts.filter((t) => typeof t === 'string')
      : [],
    planform: ['rectangular', 'tapered', 'elliptical'].includes(f2.planform as string)
      ? (f2.planform as PlanformType)
      : 'rectangular',
  };
  return out;
}

function parseProfileSafe(text: string): {
  profile: ParsedProfile | null;
  profileError: string | null;
} {
  if (!text.trim()) return { profile: null, profileError: null };
  try {
    return { profile: parseProfile(text), profileError: null };
  } catch (e) {
    return { profile: null, profileError: e instanceof Error ? e.message : String(e) };
  }
}

function polarEntries(texts: string[]): PolarEntry[] {
  return texts.map((text) => {
    try {
      return { text, polar: parsePolar(text), error: null };
    } catch (e) {
      return { text, polar: null, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

const initialTheme = (): Theme => {
  try {
    const t = localStorage.getItem('hydrofoil-designer:theme');
    return t === 'light' || t === 'dark' ? t : 'auto';
  } catch {
    return 'auto';
  }
};

export const useStore = create<AppState>((set, get) => ({
  ...BLANK_DOC,
  profile: null,
  profileError: null,
  polars: [],
  sectionInfo: null,
  sectionBusy: false,
  result: null,
  sim: null,
  solving: false,
  solveMs: 0,
  workerError: null,
  theme: initialTheme(),
  flash: null,
  profile2: null,
  profileError2: null,
  polars2: [],
  sectionInfo2: null,
  sectionBusy2: false,
  viewFoil: 1,

  setProfileText(t, slot = 1) {
    if (slot === 1) set({ profileText: t, ...parseProfileSafe(t) });
    else {
      const p = parseProfileSafe(t);
      set({
        foil2: { ...get().foil2, profileText: t },
        profile2: p.profile,
        profileError2: p.profileError,
      });
    }
    requestSection(slot);
  },
  addPolar(t, slot = 1) {
    if (slot === 1) {
      const polarTexts = [...get().polarTexts, t];
      set({ polarTexts, polars: polarEntries(polarTexts) });
    } else {
      const polarTexts = [...get().foil2.polarTexts, t];
      set({ foil2: { ...get().foil2, polarTexts }, polars2: polarEntries(polarTexts) });
    }
    requestSection(slot);
  },
  removePolar(i, slot = 1) {
    if (slot === 1) {
      const polarTexts = get().polarTexts.filter((_, j) => j !== i);
      set({ polarTexts, polars: polarEntries(polarTexts) });
    } else {
      const polarTexts = get().foil2.polarTexts.filter((_, j) => j !== i);
      set({ foil2: { ...get().foil2, polarTexts }, polars2: polarEntries(polarTexts) });
    }
    requestSection(slot);
  },
  setKappa(k) {
    set({ kappa: k });
    requestSection(1);
    requestSection(2);
  },
  setInput(id, si) {
    const inputs = { ...get().inputs };
    if (si === null || !Number.isFinite(si)) delete inputs[id];
    else inputs[id] = si;
    set({ inputs });
    requestSolve();
  },
  setUnit(id, unit) {
    // both foils' versions of a quantity share one unit
    const base = VAR[id]?.base ?? id;
    set({ units: { ...get().units, [base]: unit } });
    persist(get());
  },
  setUnitSystem(sys) {
    set({ unitSystem: sys, units: {} });
    persist(get());
  },
  setPlanform(p, foil = 1) {
    const inputs = { ...get().inputs };
    const id = (base: string) => foilId(base, foil);
    if (p !== 'tapered') delete inputs[id('lambda')];
    if (p === 'elliptical') {
      delete inputs[id('ct')];
      delete inputs[id('tTip')];
    }
    if (foil === 1) set({ planform: p, inputs });
    else set({ foil2: { ...get().foil2, planform: p }, inputs });
    requestSolve(0);
  },
  setFoil2(patch) {
    const foil2 = { ...get().foil2, ...patch };
    set({ foil2, viewFoil: foil2.enabled ? get().viewFoil : 1 });
    requestSolve(0);
  },
  setViewFoil(f) {
    set({ viewFoil: f });
  },
  setWater(t, custom) {
    set({ waterType: t, customSalinity: custom ?? get().customSalinity });
    requestSolve(0);
  },
  setMaterial(id) {
    const inputs = { ...get().inputs };
    if (id !== 'custom') {
      delete inputs.E;
      delete inputs.sy;
      delete inputs.rhoM;
    } else {
      const prev = materialById(get().materialId);
      if (prev) {
        inputs.E = prev.E;
        inputs.sy = prev.yieldStrength;
        inputs.rhoM = prev.density;
      }
    }
    set({ materialId: id, inputs });
    requestSolve(0);
  },
  setRequirement(k, v) {
    set({ requirements: { ...get().requirements, [k]: v } });
    requestSolve();
  },
  setObjective(o) {
    set({ objective: o });
    requestSolve(0);
  },
  setTheme(t) {
    set({ theme: t });
    try {
      localStorage.setItem('hydrofoil-designer:theme', t);
    } catch {
      /* ignore */
    }
  },
  loadDoc(d) {
    const doc = sanitiseDoc(d);
    const p2 = parseProfileSafe(doc.foil2.profileText);
    set({
      ...doc,
      ...parseProfileSafe(doc.profileText),
      polars: polarEntries(doc.polarTexts),
      profile2: p2.profile,
      profileError2: p2.profileError,
      polars2: polarEntries(doc.foil2.polarTexts),
      viewFoil: 1,
      result: null,
      sim: null,
    });
    requestSection(1);
    requestSection(2);
  },
  reset() {
    set({
      ...BLANK_DOC,
      profile: null,
      profileError: null,
      polars: [],
      sectionInfo: null,
      profile2: null,
      profileError2: null,
      polars2: [],
      sectionInfo2: null,
      viewFoil: 1,
      result: null,
      sim: null,
    });
    requestSection(1);
    requestSection(2);
  },
  flashVar(id) {
    // show the foil the variable belongs to
    const foil = VAR[id]?.foil;
    if (get().foil2.enabled && (foil === 1 || foil === 2)) set({ viewFoil: foil });
    set({ flash: id });
    setTimeout(() => {
      if (get().flash === id) set({ flash: null });
    }, 1600);
  },
}));

/** Display unit for a variable (user choice, else the unit-system default). */
export function unitFor(s: Pick<DocState, 'units' | 'unitSystem'>, id: string) {
  const q = VAR[id]?.quantity ?? 'none';
  const base = VAR[id]?.base ?? id;
  return getUnit(q, s.units[base] ?? SYSTEM_DEFAULTS[s.unitSystem][q]);
}

// ---------- share links ----------
async function compress(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'undefined') return 'r' + b64url(bytes);
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const buf = new Uint8Array(await new Response(stream).arrayBuffer());
  return 'z' + b64url(buf);
}

async function decompress(s: string): Promise<string> {
  const bytes = unb64url(s.slice(1));
  if (s[0] === 'r') return new TextDecoder().decode(bytes);
  const stream = new Blob([bytes as BlobPart])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  return await new Response(stream).text();
}

function b64url(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function shareUrl(): Promise<string> {
  const doc = docOf(useStore.getState());
  const enc = await compress(JSON.stringify(doc));
  const u = new URL(window.location.href);
  u.hash = 'd=' + enc;
  return u.toString();
}

export async function docFromHash(hash: string): Promise<Partial<DocState> | null> {
  const m = hash.match(/d=([A-Za-z0-9_-]+)/);
  if (!m) return null;
  try {
    return JSON.parse(await decompress(m[1])) as Partial<DocState>;
  } catch {
    return null;
  }
}

export async function initStore() {
  const fromHash = await docFromHash(window.location.hash);
  const doc = fromHash ?? loadStoredDoc();
  if (fromHash) history.replaceState(null, '', window.location.pathname + window.location.search);
  useStore.getState().loadDoc(doc ?? {});
}
