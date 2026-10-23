import { useStore } from '../../state/store';
import { VAR } from '../../solver/variables';
import { scrollToVar } from '../format';
import { loadExampleDesign } from '../example';
import { Help } from './Help';

export function StatusCard() {
  const { result, workerError, profile, flashVar, profileText, inputs } = useStore();
  const empty = !profileText.trim() && Object.keys(inputs).length === 0;
  const items: { kind: 'info' | 'warn' | 'error' | 'good'; text: string; vars?: string[] }[] = [];
  if (workerError) items.push({ kind: 'error', text: `Calculation error: ${workerError}` });
  if (!profile)
    items.push({
      kind: 'info',
      text: 'Start by pasting a section profile, or load the NACA 63-412 example.',
    });
  for (const m of result?.missing ?? [])
    if (profile || !m.startsWith('Section')) items.push({ kind: 'info', text: m });
  for (const c of result?.conflicts ?? [])
    items.push({ kind: 'error', text: c.message, vars: c.vars });
  if (result?.optimisation) {
    const o = result.optimisation;
    const bad = result.requirements.some((r) => r.ok === false);
    items.push({ kind: bad ? 'warn' : o.ran ? 'good' : 'info', text: o.message, vars: o.dofs });
  }
  for (const w of result?.warnings ?? []) items.push({ kind: 'warn', text: w });
  if (!items.length) return null;
  const icon = { info: 'i', warn: '!', error: '!', good: '✓' };
  return (
    <section className="card" aria-label="Design status" aria-live="polite" data-tour="status">
      <h2>
        Status
        <Help label="Status">
          Messages about your design: what is still needed, what needs fixing, and what the program
          chose for you. Click a name in a message to jump to that value.
        </Help>
      </h2>
      {empty && (
        <div className="notice good">
          <span className="icon" aria-hidden>
            ?
          </span>
          <span>
            Not sure where to start? Fill in an example design and change it from there.
            <span className="row" style={{ marginTop: 6 }}>
              <button className="btn primary" onClick={() => void loadExampleDesign()}>
                Try an example design
              </button>
            </span>
          </span>
        </div>
      )}
      {items.map((it, i) => (
        <div className={`notice ${it.kind}`} key={i}>
          <span className="icon" aria-hidden>
            {icon[it.kind]}
          </span>
          <span>
            {it.text}
            {it.vars && it.vars.length > 0 && (
              <span className="row" style={{ marginTop: 4, gap: 4 }}>
                {it.vars.map((v) => (
                  <button
                    key={v}
                    className="linkchip"
                    onClick={() => {
                      scrollToVar(v);
                      flashVar(v);
                    }}
                  >
                    {VAR[v]?.label ?? v}
                  </button>
                ))}
              </span>
            )}
          </span>
        </div>
      ))}
    </section>
  );
}
