import { useStore } from '../../state/store';
import { ModeBadge, SectionEditor } from './SectionCard';
import { Help } from './Help';

/** Turns the secondary foil on or off and picks its section. */
export function SecondaryFoilCard() {
  const foil2 = useStore((s) => s.foil2);
  const setFoil2 = useStore((s) => s.setFoil2);
  const mainProfile = useStore((s) => s.profile);
  const info2 = useStore((s) => s.sectionInfo2);
  const busy2 = useStore((s) => s.sectionBusy2);
  const own = foil2.enabled && !foil2.sameSection;
  return (
    <section className="card" aria-labelledby="foil2-title" data-tour="foil2">
      <h2 id="foil2-title">
        Secondary foil
        <Help label="Secondary foil">
          <p>
            A second, usually smaller foil. On most foil boards it sits at the back, like the tail
            of a plane, and keeps the nose from pitching up or down.
          </p>
          <p>Leave it off while you are learning. You can add it later.</p>
        </Help>
        {own && info2 && <ModeBadge mode={info2.mode} />}
        {own && busy2 && <span className="busy">analysing…</span>}
        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            aria-label="Include a secondary foil"
            checked={foil2.enabled}
            onChange={(e) => setFoil2({ enabled: e.target.checked })}
          />
          <span aria-hidden>{foil2.enabled ? 'On' : 'Off'}</span>
        </label>
      </h2>
      <p className="card-sub">
        A second foil, such as a rear stabiliser, a canard or a tandem foil, that carries part of
        the weight at the same speed.
      </p>
      {foil2.enabled && (
        <>
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="small muted">Section</span>
            <div className="seg" role="group" aria-label="Secondary foil section">
              <button
                aria-pressed={foil2.sameSection}
                onClick={() => setFoil2({ sameSection: true })}
              >
                Same as main foil
              </button>
              <button
                aria-pressed={!foil2.sameSection}
                onClick={() => setFoil2({ sameSection: false })}
              >
                Different profile
              </button>
            </div>
          </div>
          {foil2.sameSection ? (
            <p className="small muted" style={{ margin: '0 0 6px' }}>
              Uses {mainProfile ? <strong>{mainProfile.name}</strong> : 'the main foil’s section'}{' '}
              and its polars, read at the secondary foil’s own Reynolds number.
            </p>
          ) : (
            <SectionEditor slot={2} />
          )}
          <p className="small muted" style={{ margin: '8px 0 0' }}>
            Its load share, size and shape are under <em>Design → Secondary foil</em>.
          </p>
        </>
      )}
    </section>
  );
}
