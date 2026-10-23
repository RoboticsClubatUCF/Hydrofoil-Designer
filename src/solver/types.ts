import type { Quantity } from '../physics/units';
import type { PlanformType } from '../physics/wing/planform';
import type { SectionModel, SectionPoint } from '../physics/profile/sectionModel';
import type { Material } from '../physics/structure/materials';

export type GroupId =
  | 'water'
  | 'load'
  | 'speed'
  | 'planform'
  | 'operating'
  | 'section'
  | 'performance'
  | 'surface'
  | 'structure'
  | 'craft';

export interface VarDef {
  id: string;
  label: string;
  /** LaTeX symbol */
  symbol: string;
  quantity: Quantity;
  group: GroupId;
  help: string;
  /** Can the user type a value? (false = always derived) */
  input: boolean;
  /** Strictly positive (solve in log space) */
  positive: boolean;
  /** Typical SI value used to start numerical solves */
  typical: number;
  /** Plausible SI range for root finding */
  range: [number, number];
  /** Extra display hint, e.g. scientific notation */
  sci?: boolean;
  /** 1 = main foil, 2 = secondary foil, 0 = shared by both or a craft total */
  foil: 0 | 1 | 2;
  /** id of the main-foil variable this one mirrors (its own id unless foil 2) */
  base: string;
}

export type Vals = Record<string, number>;

export interface Ctx {
  planform: PlanformType;
  section: SectionModel;
  /** section characteristics at the current Reynolds-number estimate */
  sec: SectionPoint;
  reEstimate: number;
  salinity: number;
  material: Material | null;
  /** context of the secondary foil, when there is one */
  foil2?: Ctx;
}

export interface SolveForSpec {
  /** LaTeX template of the right-hand side using [varId] placeholders */
  rhs: string;
  /** closed-form evaluation; omitted → solved numerically from the residual */
  calc?: (v: Vals, ctx: Ctx) => number;
}

export interface Relation {
  id: string;
  title: string;
  vars: string[];
  /** canonical equation as a LaTeX template with [varId] placeholders */
  equation: string;
  /** residual (scaled so ~1e-9 means satisfied) */
  residual: (v: Vals, ctx: Ctx) => number;
  solveFor: Record<string, SolveForSpec>;
  /** A plain-language note on the method or source shown with the derivation. */
  explain?: string;
  /** Only applies to these planforms */
  planforms?: PlanformType[];
}

export type Status =
  | 'unknown'
  | 'input'
  | 'calculated'
  | 'assumed'
  | 'optimised'
  | 'section'
  | 'material'
  | 'constant'
  | 'conflict';

export interface Derivation {
  varId: string;
  status: Status;
  value: number;
  relationId?: string;
  title?: string;
  /** LaTeX: symbol = formula */
  formula?: string;
  /** LaTeX: symbol = numbers substituted */
  substitution?: string;
  /** variables this value was computed from */
  inputs: string[];
  method?: string;
  note?: string;
  /** variables solved simultaneously with this one */
  block?: string[];
  order: number;
}

export type Objective = 'minDrag' | 'minTakeoff' | 'minMass';

export interface Requirements {
  spanMax: number | null;
  rootChordMax: number | null;
  rootChordMin: number | null;
  thicknessMin: number | null;
  sfMin: number | null;
  takeoffMax: number | null;
  stallMarginMin: number | null; // rad
  noCavitation: boolean;
  arMin: number | null;
  arMax: number | null;
  deflectionMax: number | null; // fraction of semi-span
}

export const DEFAULT_REQUIREMENTS: Requirements = {
  spanMax: null,
  rootChordMax: null,
  rootChordMin: null,
  thicknessMin: null,
  sfMin: 1.5,
  takeoffMax: null,
  stallMarginMin: (2 * Math.PI) / 180,
  noCavitation: true,
  arMin: 3,
  arMax: 12,
  deflectionMax: null,
};

export interface SecondFoilInput {
  planform: PlanformType;
  /** true: same section (profile and polars) as the main foil */
  sameSection: boolean;
}

export interface DesignInput {
  values: Vals; // user inputs in SI
  planform: PlanformType;
  salinity: number; // g/kg
  material: Material | null;
  requirements: Requirements;
  objective: Objective;
  /** secondary foil, if included */
  foil2?: SecondFoilInput | null;
}

export interface RequirementCheck {
  id: keyof Requirements;
  label: string;
  /** variable the requirement constrains */
  varId: string;
  kind: 'min' | 'max' | 'nonneg';
  limit: number;
  actual: number | null;
  ok: boolean | null; // null = cannot evaluate yet
  /** at (or pressing against) its limit in the optimised design */
  active: boolean;
  /** foil the check applies to */
  foil: 1 | 2;
}

export interface Conflict {
  relationId: string;
  title: string;
  message: string;
  vars: string[];
}

export interface SolveResult {
  values: Vals;
  derivations: Record<string, Derivation>;
  conflicts: Conflict[];
  requirements: RequirementCheck[];
  optimisation: {
    ran: boolean;
    dofs: string[];
    objective: Objective;
    objectiveValue: number | null;
    iterations: number;
    message: string;
  } | null;
  missing: string[];
  reIterations: number;
  warnings: string[];
}
