import { useRef, useState, type DragEvent } from 'react';
import { useStore } from '../../state/store';
import { fmt } from '../../physics/units';
import { ProfilePlot } from '../charts/ProfilePlot';

const EXAMPLE_URL = `${import.meta.env.BASE_URL}examples/naca63412.dat`;

function readFiles(files: FileList | null, onText: (t: string) => void) {
  if (!files) return;
  for (const f of Array.from(files)) {
    const reader = new FileReader();
    reader.onload = () => onText(String(reader.result ?? ''));
    reader.readAsText(f);
  }
}

export function SectionCard() {
  const s = useStore();
  const {
    profileText,
    profile,
    profileError,
    sectionInfo,
    sectionBusy,
    polars,
    setProfileText,
    addPolar,
    removePolar,
    kappa,
    setKappa,
  } = s;
  const [polarDraft, setPolarDraft] = useState('');
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const polarFileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const showPaste = editing || !profile;

  const loadExample = async () => {
    const r = await fetch(EXAMPLE_URL);
    setProfileText(await r.text());
    setEditing(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    readFiles(e.dataTransfer.files, (t) => {
      setProfileText(t);
      setEditing(false);
    });
  };

  const info = sectionInfo;
  const pct = (v: number) => `${fmt(v * 100, 3)} %`;
  return (
    <section className="card" aria-labelledby="section-title">
      <h2 id="section-title">
        <span className="step">1</span> Section
        {info && (
          <span className={`badge ${info.mode}`}>
            {info.mode === 'polar' ? 'Polar data' : 'Estimated'}
          </span>
        )}
        {sectionBusy && <span className="busy">analysing…</span>}
      </h2>
      <p className="card-sub">
        Paste a profile <code>.dat</code> from{' '}
        <a href="http://airfoiltools.com/" target="_blank" rel="noreferrer">
          airfoiltools.com
        </a>{' '}
        (Lednicer or Selig format).
      </p>

      {!showPaste && profile ? (
        <>
          <ProfilePlot
            upper={info?.upper ?? profile.upper}
            lower={info?.lower ?? profile.lower}
            camber={info?.camberLine}
            raw={[...profile.upper, ...profile.lower.slice(1)]}
            tMax={info ? { x: info.xTMax, ...thick(info) } : undefined}
            label={`${profile.name} outline`}
          />
          <div className="row" style={{ marginTop: 8, justifyContent: 'space-between' }}>
            <div>
              <strong>{profile.name}</strong>{' '}
              <span className="small muted">
                {profile.format === 'lednicer' ? 'Lednicer' : 'Selig'} format · {profile.pointCount}{' '}
                points
              </span>
            </div>
            <div className="row">
              <button className="btn" onClick={() => setEditing(true)}>
                Edit / replace
              </button>
            </div>
          </div>
          {profile.warnings.map((w, i) => (
            <div className="notice info" key={i}>
              <span className="icon">i</span>
              <span>{w}</span>
            </div>
          ))}
          {info && (
            <div className="kv">
              <div>
                <span>Max thickness</span>
                <span>
                  {pct(info.tMax)} at {pct(info.xTMax)}
                </span>
              </div>
              <div>
                <span>Max camber</span>
                <span>
                  {pct(info.camberMax)} at {pct(info.xCamberMax)}
                </span>
              </div>
              <div>
                <span>Leading-edge radius</span>
                <span>{pct(info.leRadius)} c</span>
              </div>
              <div>
                <span>Trailing edge</span>
                <span>
                  {info.teGap < 1e-4 ? 'closed' : `${pct(info.teGap)} gap`},{' '}
                  {fmt(info.teAngleDeg, 3)}°
                </span>
              </div>
              <div>
                <span>Zero-lift angle (inviscid)</span>
                <span>{fmt((info.inviscidAlphaL0 * 180) / Math.PI, 3)}°</span>
              </div>
              <div>
                <span>Area ÷ c²</span>
                <span>{fmt(info.area, 4)}</span>
              </div>
            </div>
          )}
        </>
      ) : (
        <div
          className={drag ? 'drop-hint' : undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={onDrop}
        >
          <textarea
            aria-label="Profile coordinates"
            rows={8}
            placeholder={
              'NACA 63-412 AIRFOIL\n      26.       26.\n\n  0.000000  0.000000\n  0.003360  0.010710\n  …'
            }
            value={profileText}
            onChange={(e) => setProfileText(e.target.value)}
          />
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Upload .dat
            </button>
            <button className="btn" onClick={loadExample}>
              Load example (NACA 63-412)
            </button>
            {profile && (
              <button className="btn primary" onClick={() => setEditing(false)}>
                Done
              </button>
            )}
            <input
              ref={fileRef}
              type="file"
              accept=".dat,.txt,.csv,text/plain"
              hidden
              onChange={(e) =>
                readFiles(e.target.files, (t) => {
                  setProfileText(t);
                  setEditing(false);
                })
              }
            />
          </div>
          {profileError && (
            <div className="notice error" role="alert">
              <span className="icon">!</span>
              <span>{profileError}</span>
            </div>
          )}
        </div>
      )}

      <details style={{ marginTop: 10 }} open={polars.length > 0}>
        <summary>Polar data (optional, recommended)</summary>
        <p className="small muted" style={{ marginTop: 0 }}>
          On the airfoil’s airfoiltools page, open a polar (e.g. Re 500,000, Ncrit 9) and paste its
          CSV here. Add several Reynolds numbers and they are interpolated. Without polars, lift and
          drag are estimated from the shape.
        </p>
        {polars.length > 0 && (
          <div className="chips" style={{ marginBottom: 8 }}>
            {polars.map((p, i) => (
              <span className="chip" key={i} title={p.error ?? p.polar?.label}>
                {p.polar ? (
                  <>
                    Re {fmt(p.polar.Re, 3)}
                    {p.polar.ncrit !== null ? ` · Ncrit ${p.polar.ncrit}` : ''} · α{' '}
                    {p.polar.rows[0].alpha}…{p.polar.rows[p.polar.rows.length - 1].alpha}°
                  </>
                ) : (
                  <span className="error-text">Unreadable polar</span>
                )}
                <button aria-label="Remove polar" onClick={() => removePolar(i)}>
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          rows={4}
          aria-label="Polar CSV"
          placeholder="Xfoil polar. Reynolds number fixed…&#10;Alpha,Cl,Cd,Cdp,Cm,Top_Xtr,Bot_Xtr&#10;…"
          value={polarDraft}
          onChange={(e) => setPolarDraft(e.target.value)}
        />
        <div className="row" style={{ marginTop: 6 }}>
          <button
            className="btn"
            disabled={!polarDraft.trim()}
            onClick={() => {
              addPolar(polarDraft);
              setPolarDraft('');
            }}
          >
            Add polar
          </button>
          <button className="btn" onClick={() => polarFileRef.current?.click()}>
            Upload CSV…
          </button>
          <input
            ref={polarFileRef}
            type="file"
            accept=".csv,.txt,.pol,text/plain"
            multiple
            hidden
            onChange={(e) => readFiles(e.target.files, addPolar)}
          />
        </div>
        {polars.some((p) => p.error) && (
          <div className="notice error">
            <span className="icon">!</span>
            <span>{polars.find((p) => p.error)?.error}</span>
          </div>
        )}
        {info?.mode === 'estimate' && (
          <div className="row small" style={{ marginTop: 8 }}>
            <label htmlFor="kappa" className="muted">
              Viscous lift-slope factor κ
            </label>
            <input
              id="kappa"
              type="number"
              min={0.7}
              max={1}
              step={0.01}
              style={{ width: 72 }}
              value={kappa}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (v >= 0.6 && v <= 1) setKappa(v);
              }}
            />
            <span className="muted">
              (estimate mode only; 0.93 matches XFoil for typical 12 % sections)
            </span>
          </div>
        )}
      </details>
    </section>
  );
}

function thick(info: {
  upper: { x: number; y: number }[];
  lower: { x: number; y: number }[];
  xTMax: number;
}) {
  const at = (pts: { x: number; y: number }[], x: number) => {
    for (let i = 1; i < pts.length; i++)
      if (pts[i].x >= x) {
        const a = pts[i - 1],
          b = pts[i];
        return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x || 1);
      }
    return 0;
  };
  return { yU: at(info.upper, info.xTMax), yL: at(info.lower, info.xTMax) };
}
