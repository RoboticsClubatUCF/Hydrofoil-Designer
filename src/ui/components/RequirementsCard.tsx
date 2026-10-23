import { useState } from 'react';
import { useStore, unitFor } from '../../state/store';
import { toSI, type Unit } from '../../physics/units';
import type { Objective, RequirementCheck, Requirements } from '../../solver/types';
import { displayNumber, parseTyped } from '../format';
import { Help } from './Help';
import { REQUIREMENT_HELP } from '../help';

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

/** One dot for a requirement on every foil: not met if any foil misses it. */
function StatusDot({ cs }: { cs: RequirementCheck[] }) {
  const done = cs.filter((c) => c.ok !== null);
  if (!done.length)
    return (
      <span className="st na" title="Not evaluated yet">
        ·
      </span>
    );
  const ok = done.every((c) => c.ok);
  const active = done.some((c) => c.active);
  const where = (c: RequirementCheck) => (c.foil === 2 ? 'secondary foil' : 'main foil');
  const bad = done.filter((c) => !c.ok);
  return (
    <span
      className={`st ${ok ? 'ok' : 'bad'}${active ? ' active' : ''}`}
      title={
        ok
          ? active
            ? 'Met — limiting the design'
            : 'Met'
          : cs.length > 1
            ? `Not met on the ${bad.map(where).join(' and ')}`
            : 'Not met'
      }
    >
      {ok ? '✓' : '✕'}
    </span>
  );
}

export function RequirementsCard() {
  const store = useStore();
  const { requirements, setRequirement, objective, setObjective, result } = store;
  const checks: Partial<Record<keyof Requirements, RequirementCheck[]>> = {};
  for (const c of result?.requirements ?? []) (checks[c.id] ??= []).push(c);
  const two = store.foil2.enabled;
  return (
    <section className="card" aria-labelledby="req-title" data-tour="requirements">
      <h2 id="req-title">
        <span className="step">3</span> Requirements
        <Help label="Requirements">
          <p>
            Limits the design must stay within, such as the widest the foil may be. When the program
            fills in values you left blank, it keeps to these limits. Leave a box empty for no
            limit.
          </p>
          <p>
            The dot on each row shows the result: a green tick means the limit is met, a red cross
            means it is not, and a yellow ring means this limit is the one holding the design back.
          </p>
        </Help>
      </h2>
      <p className="card-sub">
        Limits the designer must respect when it fills in anything you left blank. Empty = no limit.
        {two && ' Each limit applies to both foils.'}
      </p>
      <div className="row" style={{ marginBottom: 8 }}>
        <span className="label-help">
          <label htmlFor="objective" className="small muted">
            Optimise for
          </label>
          <Help label="Optimise for">
            <p>When the program picks values for you, this is what it tries to make best:</p>
            <p>
              <b>Minimum drag</b>: the least effort at cruise speed. <b>Lowest take-off speed</b>:
              gets you out of the water sooner. <b>Lightest foil</b>: the least weight.
            </p>
          </Help>
        </span>
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
        const cs = checks[r.key] ?? [];
        const shown = cs.filter((c) => c.actual !== null);
        const limiting = cs.some((c) => c.active && c.ok);
        return (
          <div key={r.key}>
            <div className="req">
              <StatusDot cs={cs} />
              <span className="label-help small">
                <label>{r.label}</label>
                <Help label={r.label}>{REQUIREMENT_HELP[r.key]}</Help>
              </span>
              <ReqInput
                value={requirements[r.key]}
                unit={unit}
                label={r.label}
                onChange={(v) => setRequirement(r.key, v)}
              />
              <span className="small muted">{unit.label}</span>
            </div>
            {shown.length > 0 && (
              <div className="req">
                <span />
                <span className="actual">
                  now{' '}
                  {shown
                    .map(
                      (c) =>
                        `${two ? (c.foil === 2 ? 'secondary ' : 'main ') : ''}${displayNumber(c.actual!, unit)} ${unit.label}`,
                    )
                    .join(' · ')}
                  {limiting ? ' · limiting' : ''}
                </span>
              </div>
            )}
          </div>
        );
      })}
      <div className="req">
        <StatusDot cs={checks.noCavitation ?? []} />
        <span className="label-help small">
          <label htmlFor="nocav">
            No cavitation at cruise <span className="muted">(needs depth)</span>
          </label>
          <Help label="No cavitation">{REQUIREMENT_HELP.noCavitation}</Help>
        </span>
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
