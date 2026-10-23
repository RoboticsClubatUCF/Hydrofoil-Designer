import { useState } from 'react';
import { useStore, unitFor } from '../../state/store';
import { UNITS, toSI } from '../../physics/units';
import { VAR } from '../../solver/variables';
import type { Status } from '../../solver/types';
import { displayNumber, parseTyped } from '../format';
import { rootInputs } from '../derive';
import { DerivationView } from './Derivation';

const STATE_LABEL: Partial<Record<Status, string>> = {
  input: 'entered',
  calculated: 'calculated',
  assumed: 'assumed',
  optimised: 'optimised',
  section: 'from section',
  material: 'from material',
  constant: 'fixed',
  conflict: 'conflict',
};

export function Field({ id, usedBy }: { id: string; usedBy: string[] }) {
  const def = VAR[id];
  const store = useStore();
  const { result, inputs, flash, setInput, setUnit } = store;
  const [text, setText] = useState<string | null>(null); // non-null while the user is typing
  const [open, setOpen] = useState(false);
  const unit = unitFor(store, id);
  const d = result?.derivations[id];
  const entered = inputs[id];
  const status: Status = d?.status ?? (entered !== undefined ? 'input' : 'unknown');
  const value = d?.value ?? entered;
  const shown = text ?? (value !== undefined ? displayNumber(value, unit, id) : '');
  const invalid = text !== null && parseTyped(text) !== null && Number.isNaN(parseTyped(text));

  const locked =
    !def.input ||
    ['calculated', 'section', 'material', 'constant'].includes(status) ||
    (status === 'conflict' && entered === undefined);
  const editable = !locked;
  const units = UNITS[def.quantity];

  let title = def.help;
  if (status === 'calculated' && result) {
    const roots = rootInputs(id, result.derivations).map((r) => VAR[r]?.label.toLowerCase() ?? r);
    title = roots.length
      ? `Calculated from ${roots.join(', ')}. Clear one of those to type a value here.`
      : `Calculated. ${def.help}`;
  } else if (status === 'assumed' || status === 'optimised') {
    title = `${status === 'assumed' ? 'Assumed' : 'Chosen by the optimiser'} — type to replace it with your own value.`;
  }

  const commit = (t: string) => {
    const v = parseTyped(t);
    if (v === null) setInput(id, null);
    else if (!Number.isNaN(v)) setInput(id, toSI(v, unit));
  };

  const cls = [
    'val',
    invalid ? 'invalid' : '',
    locked && status === 'unknown' ? 'readonly' : status,
  ].join(' ');
  return (
    <>
      <div className={`field${flash === id ? ' flash' : ''}`} id={`field-${id}`}>
        <div className="field-label" title={def.help}>
          <label htmlFor={`in-${id}`}>{def.label}</label>
          <span className={`state ${status}`}>{STATE_LABEL[status] ?? ''}</span>
        </div>
        <input
          id={`in-${id}`}
          className={cls}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={shown}
          placeholder={def.input ? 'enter…' : '—'}
          readOnly={!editable}
          aria-readonly={!editable}
          aria-invalid={invalid}
          aria-describedby={open ? `deriv-${id}` : undefined}
          title={title}
          onFocus={(e) => {
            if (editable && (status === 'assumed' || status === 'optimised'))
              e.currentTarget.select();
          }}
          onChange={(e) => {
            if (!editable) return;
            setText(e.target.value);
            commit(e.target.value);
          }}
          onBlur={() => setText(null)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape' && status === 'input') {
              setInput(id, null);
              setText(null);
            }
          }}
        />
        {units.length > 1 ? (
          <select
            className="unit"
            aria-label={`${def.label} unit`}
            value={unit.id}
            onChange={(e) => setUnit(id, e.target.value)}
          >
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.label}
              </option>
            ))}
          </select>
        ) : (
          <span className="unit-static">{units[0].label}</span>
        )}
        <button
          className="how"
          aria-expanded={open}
          aria-label={`How ${def.label.toLowerCase()} was found`}
          title={d ? 'Show how this value was found' : 'No value yet'}
          disabled={!d}
          onClick={() => setOpen((o) => !o)}
        >
          ƒ
        </button>
      </div>
      {open && d && (
        <div id={`deriv-${id}`}>
          <DerivationView d={d} usedBy={usedBy} />
        </div>
      )}
    </>
  );
}
