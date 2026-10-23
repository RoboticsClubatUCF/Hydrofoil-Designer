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
import { VAR } from '../solver/variables';
import {
  DEFAULT_REQUIREMENTS,
  type DesignInput,
  type Objective,
  type Requirements,
  type SolveResult,
} from '../solver/types';
import type { SectionInfo, WorkerRequest, WorkerResponse } from '../worker/protocol';

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

  setProfileText(t: string): void;
  addPolar(t: string): void;
  removePolar(i: number): void;
  setKappa(k: number): void;
  setInput(id: string, si: number | null): void;
  setUnit(id: string, unit: string): void;
  setUnitSystem(s: 'SI' | 'US'): void;
  setPlanform(p: PlanformType): void;
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
let latestSection = 0;
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

function handleResponse(m: WorkerResponse) {
  if (m.kind === 'section') {
    if (m.id !== latestSection) return;
    useStore.setState({ sectionBusy: false, sectionInfo: m.ok ? m.info : null });
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
  };
}

function requestSection() {
  const s = useStore.getState();
  latestSection = ++seq;
  useStore.setState({ sectionBusy: !!s.profile });
  send({
    kind: 'section',
    id: latestSection,
    profileText: s.profile ? s.profileText : '',
    polarTexts: s.polars.filter((p) => p.polar).map((p) => p.text),
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

  setProfileText(t) {
    set({ profileText: t, ...parseProfileSafe(t) });
    requestSection();
  },
  addPolar(t) {
    const polarTexts = [...get().polarTexts, t];
    set({ polarTexts, polars: polarEntries(polarTexts) });
    requestSection();
  },
  removePolar(i) {
    const polarTexts = get().polarTexts.filter((_, j) => j !== i);
    set({ polarTexts, polars: polarEntries(polarTexts) });
    requestSection();
  },
  setKappa(k) {
    set({ kappa: k });
    requestSection();
  },
  setInput(id, si) {
    const inputs = { ...get().inputs };
    if (si === null || !Number.isFinite(si)) delete inputs[id];
    else inputs[id] = si;
    set({ inputs });
    requestSolve();
  },
  setUnit(id, unit) {
    set({ units: { ...get().units, [id]: unit } });
    persist(get());
  },
  setUnitSystem(sys) {
    set({ unitSystem: sys, units: {} });
    persist(get());
  },
  setPlanform(p) {
    const inputs = { ...get().inputs };
    if (p !== 'tapered') delete inputs.lambda;
    if (p === 'elliptical') {
      delete inputs.ct;
      delete inputs.tTip;
    }
    set({ planform: p, inputs });
    requestSolve(0);
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
    set({
      ...doc,
      ...parseProfileSafe(doc.profileText),
      polars: polarEntries(doc.polarTexts),
      result: null,
      sim: null,
    });
    requestSection();
  },
  reset() {
    set({
      ...BLANK_DOC,
      profile: null,
      profileError: null,
      polars: [],
      sectionInfo: null,
      result: null,
      sim: null,
    });
    requestSection();
  },
  flashVar(id) {
    set({ flash: id });
    setTimeout(() => {
      if (get().flash === id) set({ flash: null });
    }, 1600);
  },
}));

/** Display unit for a variable (user choice, else the unit-system default). */
export function unitFor(s: Pick<DocState, 'units' | 'unitSystem'>, id: string) {
  const q = VAR[id]?.quantity ?? 'none';
  return getUnit(q, s.units[id] ?? SYSTEM_DEFAULTS[s.unitSystem][q]);
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
