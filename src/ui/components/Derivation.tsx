import { useStore, unitFor } from '../../state/store';
import { fmtQ, SI_LABEL } from '../../physics/units';
import { VAR } from '../../solver/variables';
import type { Derivation as D } from '../../solver/types';
import { Tex } from '../Tex';
import { scrollToVar } from '../format';

const HEADINGS: Record<string, string> = {
  input: 'You entered this',
  calculated: 'How it was calculated',
  assumed: 'Assumed',
  optimised: 'Chosen by the optimiser',
  section: 'From the section data',
  material: 'From the material',
  constant: 'Fixed by the planform',
  conflict: 'Conflict',
};

export function VarChip({ id }: { id: string }) {
  const flashVar = useStore((s) => s.flashVar);
  const def = VAR[id];
  if (!def) return null;
  return (
    <button
      className="linkchip"
      onClick={() => {
        scrollToVar(id);
        flashVar(id);
      }}
    >
      {def.label}
    </button>
  );
}

export function DerivationView({ d, usedBy }: { d: D; usedBy: string[] }) {
  const s = useStore();
  const def = VAR[d.varId];
  const unit = unitFor(s, d.varId);
  const siLabel = SI_LABEL[def.quantity];
  const display = fmtQ(d.value, def.quantity, unit.id, 5);
  const si = fmtQ(d.value, def.quantity, undefined, 5);
  return (
    <div className={`deriv ${d.status}`}>
      <h4>
        {HEADINGS[d.status] ?? d.status}
        {d.title && d.status === 'calculated' ? ` — ${d.title}` : ''}
      </h4>
      {d.formula && <Tex tex={d.formula} block />}
      {d.substitution && <Tex tex={d.substitution} block />}
      {d.status !== 'input' && (
        <div className="method">
          Result: <strong>{display}</strong>
          {unit.factor !== 1 || unit.offset
            ? ` (= ${si}${siLabel && !si.includes(siLabel) ? ' ' + siLabel : ''} in SI)`
            : ''}
        </div>
      )}
      {d.method && d.status !== 'input' && <div className="method">{d.method}</div>}
      {d.note && <div className="note">{d.note}</div>}
      {(d.inputs.length > 0 || usedBy.length > 0) && (
        <div className="links">
          {d.inputs.length > 0 && <span className="muted">From:</span>}
          {d.inputs.map((i) => (
            <VarChip key={i} id={i} />
          ))}
          {usedBy.length > 0 && (
            <span className="muted" style={{ marginLeft: d.inputs.length ? 8 : 0 }}>
              Used for:
            </span>
          )}
          {usedBy.slice(0, 12).map((i) => (
            <VarChip key={i} id={i} />
          ))}
        </div>
      )}
    </div>
  );
}
