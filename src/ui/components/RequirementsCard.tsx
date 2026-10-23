import { useState } from 'react';
import { useStore, unitFor } from '../../state/store';
import { toSI, type Unit } from '../../physics/units';
import type { Objective, RequirementCheck, Requirements } from '../../solver/types';
import { displayNumber, parseTyped } from '../format';

type NumKey = Exclude<keyof Requirements, 'noCavitation'>;

const ROWS: { key: NumKey; label: string; varId: string }[] = [
  { key: 'spanMax', label: 'Max span', varId: 'b' },
  { key: 'rootChordMax', label: 'Max root chord', varId: 'cr' },
  { key: 'rootChordMin', label: 'Min root chord', varId: 'cr' },
  { key: 'thicknessMin', label: 'Min root thickness', varId: 'tRoot' },
  { key: 'sfMin', label: 'Min safety factor', varId: 'SF' },
  { key: 'takeoffMax', label: 'Max take-off speed', varId: 'Vto' },
  { key: 'stallMarginMin', label: 'Min stall margin', varId: 'stallMargin' },
  { key: 'arMin', label: 'Min aspect ratio', varId: 'AR' },
  { key: 'arMax', label: 'Max aspect ratio', varId: 'AR' },
  { key: 'deflectionMax', label: 'Max tip deflection (÷ semi-span)', varId: 'deflRatio' },
];

function ReqInput({
  value,
  unit,
  onChange,
  label,
}: {
  value: number | null;
  unit: Unit;
  onChange: (v: number | null) => void;
  label: string;
}) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? (value === null ? '' : displayNumber(value, unit));
  return (
    <input
      type="text"
      inputMode="decimal"
      aria-label={label}
      placeholder="none"
      value={shown}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseTyped(e.target.value);
        if (v === null) onChange(null);
        else if (!Number.isNaN(v)) onChange(toSI(v, unit));
      }}
      onBlur={() => setText(null)}
    />
  );
}

function StatusDot({ c }: { c: RequirementCheck | undefined }) {
  if (!c || c.ok === null)
    return (
      <span className="st na" title="Not evaluated yet">
        ·
      </span>
    );
  return (
    <span
      className={`st ${c.ok ? 'ok' : 'bad'}${c.active ? ' active' : ''}`}
      title={c.ok ? (c.active ? 'Met — limiting the design' : 'Met') : 'Not met'}
    >
      {c.ok ? '✓' : '✕'}
    </span>
  );
}

export function RequirementsCard() {
  const store = useStore();
  const { requirements, setRequirement, objective, setObjective, result } = store;
  const checks = Object.fromEntries((result?.requirements ?? []).map((c) => [c.id, c]));
  return (
    <section className="card" aria-labelledby="req-title">
      <h2 id="req-title">
        <span className="step">3</span> Requirements
      </h2>
      <p className="card-sub">
        Limits the designer must respect when it fills in anything you left blank. Empty = no limit.
      </p>
      <div className="row" style={{ marginBottom: 8 }}>
        <label htmlFor="objective" className="small muted">
          Optimise for
        </label>
        <select
          id="objective"
          value={objective}
          onChange={(e) => setObjective(e.target.value as Objective)}
        >
          <option value="minDrag">Minimum drag at cruise</option>
          <option value="minTakeoff">Lowest take-off speed</option>
          <option value="minMass">Lightest foil</option>
        </select>
      </div>
      {ROWS.map((r) => {
        const unit = unitFor(store, r.varId);
        const c = checks[r.key];
        return (
          <div key={r.key}>
            <div className="req">
              <StatusDot c={c} />
              <label className="small">{r.label}</label>
              <ReqInput
                value={requirements[r.key]}
                unit={unit}
                label={r.label}
                onChange={(v) => setRequirement(r.key, v)}
              />
              <span className="small muted">{unit.label}</span>
            </div>
            {c && c.actual !== null && (
              <div className="req">
                <span />
                <span className="actual">
                  now {displayNumber(c.actual, unit)} {unit.label}
                  {c.active && c.ok ? ' · limiting' : ''}
                </span>
              </div>
            )}
          </div>
        );
      })}
      <div className="req">
        <StatusDot c={checks.noCavitation} />
        <label className="small" htmlFor="nocav">
          No cavitation at cruise <span className="muted">(needs depth)</span>
        </label>
        <input
          id="nocav"
          type="checkbox"
          checked={requirements.noCavitation}
          onChange={(e) => setRequirement('noCavitation', e.target.checked)}
        />
        <span />
      </div>
    </section>
  );
}
