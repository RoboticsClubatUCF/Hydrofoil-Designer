import { useMemo, useState } from 'react';
import { useStore } from '../../state/store';
import { MATERIALS } from '../../physics/structure/materials';
import { PLANFORM_LABEL, type PlanformType } from '../../physics/wing/planform';
import type { WaterType } from '../../physics/fluid';
import type { GroupId } from '../../solver/types';
import { Field } from './Field';

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
  const planform = useStore((s) => s.planform);
  const setPlanform = useStore((s) => s.setPlanform);
  const waterType = useStore((s) => s.waterType);
  const customSalinity = useStore((s) => s.customSalinity);
  const setWater = useStore((s) => s.setWater);
  const materialId = useStore((s) => s.materialId);
  const setMaterial = useStore((s) => s.setMaterial);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const usedBy = useMemo(() => {
    const m: Record<string, string[]> = {};
    if (!result) return m;
    for (const d of Object.values(result.derivations))
      for (const i of d.inputs) (m[i] ??= []).push(d.varId);
    return m;
  }, [result]);

  const hide = (id: string) =>
    (id === 'lambda' && planform !== 'tapered') ||
    (planform === 'elliptical' && (id === 'ct' || id === 'tTip'));

  return (
    <section className="card" aria-labelledby="design-title">
      <h2 id="design-title">
        <span className="step">2</span> Design
      </h2>
      <p className="card-sub">
        Fill in only what you know or want. Everything that follows is calculated and greyed out;
        press <em>ƒ</em> to see how.
      </p>
      {GROUPS.map((g) => {
        const showMore = expanded[g.id];
        const fields = [...g.fields, ...(showMore ? (g.more ?? []) : [])].filter((f) => !hide(f));
        return (
          <div className="group" key={g.id} role="group" aria-labelledby={`grp-${g.id}`}>
            <div className="group-head">
              <h3 id={`grp-${g.id}`}>{g.title}</h3>
              <p>{g.blurb}</p>
            </div>
            {g.id === 'planform' && (
              <div className="group-controls row">
                <span className="small muted">Planform</span>
                <div className="seg" role="group" aria-label="Planform shape">
                  {(Object.keys(PLANFORM_LABEL) as PlanformType[]).map((p) => (
                    <button key={p} aria-pressed={planform === p} onClick={() => setPlanform(p)}>
                      {PLANFORM_LABEL[p]}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {g.id === 'structure' && (
              <div className="group-controls row">
                <label className="small muted" htmlFor="material">
                  Material
                </label>
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
              </div>
            )}
            {g.id === 'water' && (
              <div className="group-controls row">
                <label className="small muted" htmlFor="water">
                  Water
                </label>
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
            {fields.map((f) => (
              <Field key={f} id={f} usedBy={usedBy[f] ?? []} />
            ))}
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
