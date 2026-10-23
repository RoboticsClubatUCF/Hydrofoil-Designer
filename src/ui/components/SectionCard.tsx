import { useRef, useState, type DragEvent } from 'react';
import { useStore, unitFor } from '../../state/store';
import { fmt } from '../../physics/units';
import { foilId } from '../../solver/variables';
import { displayNumber } from '../format';
import type { SectionSlot } from '../../worker/protocol';
import { ProfilePlot } from '../charts/ProfilePlot';
import { Help } from './Help';

const EXAMPLES: Record<SectionSlot, { url: string; name: string }> = {
  1: { url: `${import.meta.env.BASE_URL}examples/naca63412.dat`, name: 'NACA 63-412' },
  // symmetric sections are a common choice for a stabiliser
  2: { url: `${import.meta.env.BASE_URL}examples/naca0012.dat`, name: 'NACA 0012' },
};

function readFiles(files: FileList | null, onText: (t: string) => void) {
  if (!files) return;
  for (const f of Array.from(files)) {
    const reader = new FileReader();
    reader.onload = () => onText(String(reader.result ?? ''));
    reader.readAsText(f);
  }
}

/** Profile and polars of one section slot (main foil, or the secondary foil's own). */
function useSectionSlot(slot: SectionSlot) {
  const s = useStore();
  return slot === 1
    ? {
        profileText: s.profileText,
        profile: s.profile,
        profileError: s.profileError,
        info: s.sectionInfo,
        busy: s.sectionBusy,
        polars: s.polars,
      }
    : {
        profileText: s.foil2.profileText,
        profile: s.profile2,
        profileError: s.profileError2,
        info: s.sectionInfo2,
        busy: s.sectionBusy2,
        polars: s.polars2,
      };
}

export function SectionCard() {
  const { info, busy } = useSectionSlot(1);
  return (
    <section className="card" aria-labelledby="section-title" data-tour="section">
      <h2 id="section-title">
        <span className="step">1</span> Section
        <Help label="Section">
          <p>
            The section is the shape you would see if you sliced the foil from front to back: a
            rounded nose and a thin tail, like a plane wing. It decides how much lift and drag the
            foil makes.
          </p>
          <p>Not sure which to use? The example (NACA 63-412) is a common, all-round shape.</p>
        </Help>
        {info && <ModeBadge mode={info.mode} />}
        {busy && <span className="busy">analysing…</span>}
      </h2>
      <p className="card-sub">
        Paste a profile <code>.dat</code> from{' '}
        <a href="http://airfoiltools.com/" target="_blank" rel="noreferrer">
          airfoiltools.com
        </a>{' '}
        (Lednicer or Selig format).
        <Help label="Profile files">
          <p>
            A <code>.dat</code> file is a plain text list of points that trace the outline of the
            shape. Lednicer and Selig are two ways of ordering those points; both work here.
          </p>
          <p>
            On airfoiltools.com, open a shape, copy its .dat text and paste it below, or download
            the file and press Upload .dat.
          </p>
        </Help>
      </p>
      <SectionEditor slot={1} />
    </section>
  );
}

export function SectionEditor({ slot }: { slot: SectionSlot }) {
  const { profileText, profile, profileError, info, polars } = useSectionSlot(slot);
  const setProfileText = useStore((s) => s.setProfileText);
  const addPolar = useStore((s) => s.addPolar);
  const removePolar = useStore((s) => s.removePolar);
  const kappa = useStore((s) => s.kappa);
  const setKappa = useStore((s) => s.setKappa);
  const result = useStore((s) => s.result);
  const units = useStore((s) => s.units);
  const unitSystem = useStore((s) => s.unitSystem);
  const unitState = { units, unitSystem };
  const [polarDraft, setPolarDraft] = useState('');
  const [drag, setDrag] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const polarFileRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const showPaste = editing || !profile;
  const example = EXAMPLES[slot];
  const of = slot === 1 ? '' : 'Secondary ';
  const kappaId = slot === 1 ? 'kappa' : 'kappa-2';

  const setText = (t: string) => setProfileText(t, slot);
  const loadExample = async () => {
    const r = await fetch(example.url);
    setText(await r.text());
    setEditing(false);
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    readFiles(e.dataTransfer.files, (t) => {
      setText(t);
      setEditing(false);
    });
  };

  const pct = (v: number) => `${fmt(v * 100, 3)} %`;
  // real sizes at this foil's root chord, for the info tooltips
  const cr = result?.values[foilId('cr', slot)];
  const hasChord = cr !== undefined && Number.isFinite(cr) && cr > 0;
  const lenU = unitFor(unitState, foilId('tRoot', slot));
  const len = (frac: number) => `${displayNumber(frac * (cr ?? NaN), lenU)} ${lenU.label}`;
  const atRoot = (text: string) =>
    hasChord
      ? ` At the ${len(1)} root chord: ${text}.`
      : ' Enter or size the chord to see real sizes.';
  return (
    <>
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
                <span>
                  Max thickness
                  <SizeTip
                    text={`Thickest point is ${pct(info.tMax)} of the chord, located ${pct(info.xTMax)} of the chord back from the leading edge.${atRoot(`${len(info.tMax)} thick, ${len(info.xTMax)} back`)}`}
                  />
                </span>
                <span>
                  {pct(info.tMax)} at {pct(info.xTMax)}
                </span>
              </div>
              <div>
                <span>
                  Max camber
                  <SizeTip
                    text={`Largest rise of the mean line above the chord line is ${pct(info.camberMax)} of the chord, ${pct(info.xCamberMax)} of the chord back from the leading edge.${atRoot(`${len(info.camberMax)} rise, ${len(info.xCamberMax)} back`)}`}
                  />
                </span>
                <span>
                  {Math.abs(info.camberMax) < 1e-6
                    ? 'none (symmetric)'
                    : `${pct(info.camberMax)} at ${pct(info.xCamberMax)}`}
                </span>
              </div>
              <div>
                <span>
                  Leading-edge radius
                  <SizeTip
                    text={`Radius of the rounded nose as a fraction of the chord (c).${atRoot(`${len(info.leRadius)} radius`)}`}
                  />
                </span>
                <span>{pct(info.leRadius)} c</span>
              </div>
              <div>
                <span>
                  Trailing edge
                  <Help label="Trailing edge">
                    The back edge of the shape. Closed means it ends in a sharp point; a gap means
                    it ends in a thin flat edge. The angle shows how sharp the tail is.
                  </Help>
                </span>
                <span>
                  {info.teGap < 1e-4 ? 'closed' : `${pct(info.teGap)} gap`},{' '}
                  {fmt(info.teAngleDeg, 3)}°
                </span>
              </div>
              <div>
                <span>
                  Zero-lift angle (inviscid)
                  <Help label="Zero-lift angle">
                    The tilt at which this shape makes no lift, worked out from the shape alone
                    (inviscid means the water is treated as having no friction). Curved shapes still
                    lift a little when level, so this is usually a small negative angle.
                  </Help>
                </span>
                <span>{fmt((info.inviscidAlphaL0 * 180) / Math.PI, 3)}°</span>
              </div>
              <div>
                <span>
                  Area ÷ c²
                  <Help label="Section area">
                    The area of the cut-through shape for a foil 1 unit long from front to back (c
                    is that length, the chord). Used to work out the foil’s weight.
                  </Help>
                </span>
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
            aria-label={slot === 1 ? 'Profile coordinates' : 'Secondary profile coordinates'}
            rows={8}
            placeholder={
              'NACA 63-412 AIRFOIL\n      26.       26.\n\n  0.000000  0.000000\n  0.003360  0.010710\n  …'
            }
            value={profileText}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn" onClick={() => fileRef.current?.click()}>
              Upload .dat
            </button>
            <button className="btn" onClick={loadExample}>
              Load example ({example.name})
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
                  setText(t);
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

      <details
        style={{ marginTop: 10 }}
        open={polars.length > 0}
        data-tour={slot === 1 ? 'polars' : undefined}
      >
        <summary>
          Polar data (optional, recommended)
          <Help label="Polar data">
            <p>
              A polar is a table of how much lift and drag the shape makes at each tilt angle, from
              a test or from a program such as XFoil.
            </p>
            <p>
              It makes the results more accurate, but you can skip it: without it the program
              estimates lift and drag from the shape.
            </p>
          </Help>
        </summary>
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
                <button
                  aria-label={`Remove ${of.toLowerCase()}polar`}
                  onClick={() => removePolar(i, slot)}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          rows={4}
          aria-label={`${of}Polar CSV`}
          placeholder="Xfoil polar. Reynolds number fixed…&#10;Alpha,Cl,Cd,Cdp,Cm,Top_Xtr,Bot_Xtr&#10;…"
          value={polarDraft}
          onChange={(e) => setPolarDraft(e.target.value)}
        />
        <div className="row" style={{ marginTop: 6 }}>
          <button
            className="btn"
            disabled={!polarDraft.trim()}
            onClick={() => {
              addPolar(polarDraft, slot);
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
            onChange={(e) => readFiles(e.target.files, (t) => addPolar(t, slot))}
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
            <span className="label-help">
              <label htmlFor={kappaId} className="muted">
                Viscous lift-slope factor κ
              </label>
              <Help label="Lift-slope factor">
                A correction used only when lift is estimated from the shape. Real water friction
                makes a foil lift a little less than the simple estimate. Leave it at 0.93 unless
                you know better.
              </Help>
            </span>
            <input
              id={kappaId}
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
              (estimate mode only; 0.93 matches XFoil for typical 12 % sections
              {slot === 2 ? '; shared with the main section' : ''})
            </span>
          </div>
        )}
      </details>
    </>
  );
}

/** Info button for the section's sizes; the text includes real sizes at the root chord. */
function SizeTip({ text }: { text: string }) {
  return <Help label="Size">{text}</Help>;
}

/** Where the section's lift and drag come from, with an explanation. */
export function ModeBadge({ mode }: { mode: 'polar' | 'estimate' }) {
  return (
    <>
      <span className={`badge ${mode}`}>{mode === 'polar' ? 'Polar data' : 'Estimated'}</span>
      <Help label={mode === 'polar' ? 'Polar data' : 'Estimated'}>
        {mode === 'polar'
          ? 'Lift and drag come from the polar data you pasted. This is usually the most accurate.'
          : 'Lift and drag are estimated from the shape alone. Paste polar data below for more accurate results.'}
      </Help>
    </>
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
