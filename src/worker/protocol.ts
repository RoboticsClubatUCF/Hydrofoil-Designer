import type { Simulation } from '../simulate/simulate';
import type { DesignInput, SolveResult } from '../solver/types';
import type { SectionMode } from '../physics/profile/sectionModel';
import type { Pt } from '../physics/profile/parse';
import type { FlowRequest, FlowState } from '../flow3d/types';

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

/** 1 = main foil's section, 2 = the secondary foil's own section */
export type SectionSlot = 1 | 2;

export type WorkerRequest =
  | {
      kind: 'section';
      id: number;
      slot: SectionSlot;
      profileText: string;
      polarTexts: string[];
      kappa: number;
    }
  | { kind: 'solve'; id: number; input: DesignInput }
  | { kind: 'flow'; id: number; request: FlowRequest };

export type WorkerResponse =
  | { kind: 'section'; id: number; slot: SectionSlot; ok: true; info: SectionInfo; ms: number }
  | { kind: 'section'; id: number; slot: SectionSlot; ok: false; error: string }
  | { kind: 'solve'; id: number; ok: true; result: SolveResult; sim: Simulation; ms: number }
  | { kind: 'solve'; id: number; ok: false; error: string }
  | { kind: 'flow'; id: number; ok: true; state: FlowState; ms: number }
  | { kind: 'flow'; id: number; ok: false; error: string };
