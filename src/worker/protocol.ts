import type { Simulation } from '../simulate/simulate';
import type { DesignInput, SolveResult } from '../solver/types';
import type { SectionMode } from '../physics/profile/sectionModel';
import type { Pt } from '../physics/profile/parse';

export interface SectionInfo {
  name: string;
  mode: SectionMode;
  notes: string[];
  reRange: [number, number] | null;
  tMax: number;
  xTMax: number;
  camberMax: number;
  xCamberMax: number;
  leRadius: number;
  teGap: number;
  teAngleDeg: number;
  area: number;
  ixx: number;
  sectionModulus: number;
  centroid: Pt;
  upper: Pt[];
  lower: Pt[];
  camberLine: Pt[];
  inviscidA0: number;
  inviscidAlphaL0: number;
  kappa: number;
}

export type WorkerRequest =
  | { kind: 'section'; id: number; profileText: string; polarTexts: string[]; kappa: number }
  | { kind: 'solve'; id: number; input: DesignInput };

export type WorkerResponse =
  | { kind: 'section'; id: number; ok: true; info: SectionInfo; ms: number }
  | { kind: 'section'; id: number; ok: false; error: string }
  | { kind: 'solve'; id: number; ok: true; result: SolveResult; sim: Simulation; ms: number }
  | { kind: 'solve'; id: number; ok: false; error: string };
