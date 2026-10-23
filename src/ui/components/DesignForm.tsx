import { useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { MATERIALS } from '../../physics/structure/materials';
import { PLANFORM_LABEL, type PlanformType } from '../../physics/wing/planform';
import type { WaterType } from '../../physics/fluid';
import type { GroupId } from '../../solver/types';
import { VAR, foilId } from '../../solver/variables';
import { Field } from './Field';
import { FoilSwitch } from './FoilSwitch';
import { Help } from './Help';
import { GROUP_HELP, MATERIAL_HELP, PLANFORM_HELP, WATER_HELP } from '../help';

interface GroupSpec {
  id: GroupId;
  title: string;
  blurb: string;
  fields: string[];
  more?: string[];
}

const GROUPS: GroupSpec[] = [
  {
    id: 'load',
    title: 'Load',
    blurb: 'What this foil has to hold up',
    fields: ['m', 'share', 'L'],
  },
  {
    id: 'speed',
    title: 'Speed',
    blurb: 'Cruise, and when it should lift off',
    fields: ['V', 'Vto'],
    more: ['q', 'ReTo'],
  },
  {
    id: 'planform',
    title: 'Size & shape',
    blurb: 'Span, chords and area',
    fields: ['b', 'cr', 'ct', 'lambda', 'S', 'AR', 'tRoot'],
    more: ['cbar', 'mac', 'tTip'],
  },
  {
    id: 'operating',
    title: 'Operating point',
    blurb: 'Angle, lift and depth at cruise',
    fields: ['alpha', 'CL', 'h'],
    more: ['kFS', 'hc', 'Re'],
  },
  {
    id: 'performance',
    title: 'Performance',
    blurb: 'Drag, power, efficiency, stall',
    fields: ['D', 'P', 'LD', 'stallMargin', 'CLmax'],
    more: ['CDp', 'CDi', 'CD', 'alphaStall', 'CLa', 'e', 'kPeak', 'CLmaxTo'],
  },
  {
    id: 'craft',
    title: 'Both foils',
    blurb: 'Main and secondary foil together',
    fields: ['VtoCraft', 'Dtot', 'Ptot', 'LDtot', 'massTot'],
    more: ['VcavCraft'],
  },
  {
    id: 'surface',
    title: 'Cavitation',
    blurb: 'Does the water boil on the suction side?',
    fields: ['cavMargin', 'Vcav'],
    more: ['sigma', 'cpMin', 'clPeak'],
  },
  {
    id: 'structure',
    title: 'Structure',
    blurb: 'Solid foil on a centre strut',
    fields: ['SF', 'sigmaMax', 'deflTip', 'massFoil'],
    more: ['Mroot', 'deflRatio', 'etaBar', 'kSigma', 'E', 'sy', 'rhoM'],
  },
  {
    id: 'water',
    title: 'Water',
    blurb: 'Fluid properties',
    fields: ['T', 'rho', 'nu'],
    more: ['pv', 'patm'],
  },
  {
    id: 'section',
    title: 'From the section',
    blurb: 'Read from the profile (and polars)',
    fields: ['tc', 'alphaL0', 'a0', 'clmax'],
    more: ['clmaxTo', 'cm0', 'A1', 'Z1', 'I1'],
  },
];

export function DesignForm() {
  const result = useStore((s) => s.result);
  const mainPlanform = useStore((s) => s.planform);
  const setPlanform = useStore((s) => s.setPlanform);
  const waterType = useStore((s) => s.waterType);
  const customSalinity = useStore((s) => s.customSalinity);
  const setWater = useStore((s) => s.setWater);
  const materialId = useStore((s) => s.materialId);
  const setMaterial = useStore((s) => s.setMaterial);
  const foil2 = useStore((s) => s.foil2);
  const viewFoil = useStore((s) => s.viewFoil);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const usedBy = useMemo(() => {
    const m: Record<string, string[]> = {};
    if (!result) return m;
    for (const d of Object.values(result.derivations))
      for (const i of d.inputs) (m[i] ??= []).push(d.varId);
    return m;
  }, [result]);

  const two = foil2.enabled;
  const foil: 1 | 2 = two ? viewFoil : 1;
  const planform = foil === 2 ? foil2.planform : mainPlanform;
  const hide = (base: string) =>
    (base === 'lambda' && planform !== 'tapered') ||
    (planform === 'elliptical' && (base === 'ct' || base === 'tTip'));
  const groups = GROUPS.filter((g) => two || g.id !== 'craft');

  return (
    <section className="card" aria-labelledby="design-title" data-tour="design">
      <h2 id="design-title">
        <span className="step">2</span> Design
        <Help label="Design">
          <p>
            Every box can be typed in or left blank. Type what you know or want, and the program
            works out the rest. Values that follow from yours are greyed out and locked.
          </p>
          <p>
            Press <b>ƒ</b> next to a value to see how it was worked out, and <b>i</b> for what it
            means.
          </p>
        </Help>
      </h2>
      <p className="card-sub">
        Fill in only what you know or want. Everything that follows is calculated and greyed out;
        press <em>ƒ</em> to see how. To start, you only need the craft mass and cruise speed.
      </p>
      {two && <FoilSwitch label="Foil shown in the design form" />}
      {groups.map((g) => {
        const showMore = expanded[g.id];
        const fields = [...g.fields, ...(showMore ? (g.more ?? []) : [])].filter((f) => !hide(f));
        const perFoil = g.fields.some((f) => VAR[f].foil === 1);
        return (
          <div className="group" key={g.id} role="group" aria-labelledby={`grp-${g.id}`}>
            <div className="group-head">
              <span className="label-help">
                <h3 id={`grp-${g.id}`}>{g.title}</h3>
                <Help label={g.title}>{GROUP_HELP[g.id]}</Help>
              </span>
              <p>
                {two && perFoil && (
                  <span className={`foil-tag foil-${foil}`}>
                    {foil === 2 ? 'Secondary foil' : 'Main foil'}
                  </span>
                )}
                {g.blurb}
              </p>
            </div>
            {g.id === 'planform' && (
              <div className="group-controls row">
                <span className="small muted label-help">
                  Planform
                  <Help label="Planform">{PLANFORM_HELP}</Help>
                </span>
                <div className="seg" role="group" aria-label="Planform shape">
                  {(Object.keys(PLANFORM_LABEL) as PlanformType[]).map((p) => (
                    <button
                      key={p}
                      aria-pressed={planform === p}
                      onClick={() => setPlanform(p, foil)}
                    >
                      {PLANFORM_LABEL[p]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {g.id === 'structure' && (
              <div className="group-controls row">
                <span className="label-help">
                  <label className="small muted" htmlFor="material">
                    Material
                  </label>
                  <Help label="Material">{MATERIAL_HELP}</Help>
                </span>
                <select
                  id="material"
                  value={materialId}
                  onChange={(e) => setMaterial(e.target.value)}
                >
                  {MATERIALS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                  <option value="custom">Custom (type E, strength, density)</option>
                </select>
                {two && <span className="small muted">(both foils)</span>}
              </div>
            )}
            {g.id === 'water' && (
              <div className="group-controls row">
                <span className="label-help">
                  <label className="small muted" htmlFor="water">
                    Water
                  </label>
                  <Help label="Water type">{WATER_HELP}</Help>
                </span>
                <select
                  id="water"
                  value={waterType}
                  onChange={(e) => setWater(e.target.value as WaterType)}
                >
                  <option value="fresh">Fresh (0 g/kg)</option>
                  <option value="brackish">Brackish (15 g/kg)</option>
                  <option value="salt">Sea water (35 g/kg)</option>
                  <option value="custom">Custom salinity</option>
                </select>
                {waterType === 'custom' && (
                  <>
                    <input
                      type="number"
                      aria-label="Salinity in grams per kilogram"
                      style={{ width: 80 }}
                      min={0}
                      max={60}
                      step={1}
                      value={customSalinity}
                      onChange={(e) =>
                        setWater('custom', Math.max(0, Math.min(60, Number(e.target.value) || 0)))
                      }
                    />
                    <span className="small muted">g/kg</span>
                  </>
                )}
              </div>
            )}
            {fields.map((base) => {
              const id = foilId(base, foil);
              return (
                <Field
                  key={id}
                  id={id}
                  usedBy={usedBy[id] ?? []}
                  label={id === base ? undefined : VAR[base].label}
                />
              );
            })}
            {g.more && (
              <button
                className="more-toggle"
                aria-expanded={!!showMore}
                onClick={() => setExpanded((e) => ({ ...e, [g.id]: !e[g.id] }))}
              >
                {showMore ? 'Fewer details' : `More (${g.more.filter((f) => !hide(f)).length})`}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
