import { lazy, Suspense, useMemo } from 'react';
import { useStore, unitFor } from '../../state/store';
import { useUi, type ResultsTab } from '../../state/ui';
import { fmt, fromSI, getUnit, SYSTEM_DEFAULTS } from '../../physics/units';
import { toSelig } from '../../physics/profile/parse';
import { VAR, foilId, foilValues } from '../../solver/variables';
import type { Derivation } from '../../solver/types';
import type { FoilSimulation, SweepResult } from '../../simulate/simulate';
import { buildDxf } from '../../export/dxf';
import { sectionXyz, sectionsCsv } from '../../export/xyz';
import { buildReport } from '../../export/report';
import { LineChart, type Series } from '../charts/LineChart';
import { PlanformView } from '../charts/PlanformView';
import { DerivationView } from './Derivation';
import { FoilSwitch } from './FoilSwitch';
import { displayNumber, download, fmtSci, scrollToVar, slug } from '../format';
import { docOf } from '../../state/store';
import { Help } from './Help';
import { TAB_HELP } from '../help';

const FlowView = lazy(() => import('../flow3d/FlowView'));

const TABS: { id: ResultsTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'section', label: 'Section' },
  { id: 'span', label: 'Span & structure' },
  { id: 'sweep', label: 'Speed sweep' },
  { id: 'flow3d', label: '3D flow' },
  { id: 'calc', label: 'Calculations' },
  { id: 'export', label: 'Export' },
];

const C1 = 'var(--series-1)';
const C2 = 'var(--series-2)';
const C3 = 'var(--series-3)';

export function Results() {
  const tab = useUi((s) => s.resultsTab);
  const setTab = useUi((s) => s.setResultsTab);
  const two = useStore((s) => s.foil2.enabled);
  const label = TABS.find((t) => t.id === tab)?.label ?? '';
  return (
    <section className="card" aria-label="Results" data-tour="results">
      <div className="tabs-row">
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        <Help label={`${label} tab`}>{TAB_HELP[tab]}</Help>
      </div>
      {two && ['overview', 'section', 'span', 'export'].includes(tab) && (
        <FoilSwitch label="Foil shown in the results" />
      )}
      <div role="tabpanel">
        {tab === 'overview' && <Overview />}
        {tab === 'section' && <SectionTab />}
        {tab === 'span' && <SpanTab />}
        {tab === 'sweep' && <SweepTab />}
        {tab === 'flow3d' && (
          <Suspense fallback={<div className="empty">Loading the 3-D view…</div>}>
            <FlowView />
          </Suspense>
        )}
        {tab === 'calc' && <CalcTab />}
        {tab === 'export' && <ExportTab />}
      </div>
    </section>
  );
}

function useUnit(id: string) {
  const s = useStore();
  return unitFor(s, id);
}

function useConv(id: string) {
  const u = useUnit(id);
  return { unit: u, f: (v: number) => fromSI(v, u) };
}

/** The foil the results show: its values (by main-foil id), simulation, planform and section. */
function useFoil() {
  const s = useStore();
  const two = s.foil2.enabled;
  const foil: 1 | 2 = two ? s.viewFoil : 1;
  const same = s.foil2.sameSection;
  return {
    s,
    two,
    foil,
    values: s.result ? foilValues(s.result.values, foil) : null,
    sim: (foil === 2 ? (s.sim?.second ?? null) : s.sim) as FoilSimulation | null,
    planform: foil === 2 ? s.foil2.planform : s.planform,
    profile: foil === 2 && !same ? s.profile2 : s.profile,
    sectionInfo: foil === 2 && !same ? s.sectionInfo2 : s.sectionInfo,
  };
}

const STATUS_WORD: Record<string, string> = {
  input: 'entered',
  section: 'from section',
  material: 'from material',
  constant: 'fixed',
};

const TILE_IDS = [
  'S',
  'b',
  'cr',
  'ct',
  'AR',
  'alpha',
  'CL',
  'D',
  'P',
  'LD',
  'Vto',
  'stallMargin',
  'cavMargin',
  'SF',
  'deflTip',
  'massFoil',
  'Re',
];

const CRAFT_TILE_IDS = ['VtoCraft', 'Dtot', 'Ptot', 'LDtot', 'massTot'];

function Tile({ id, label }: { id: string; label?: string }) {
  const s = useStore();
  const d = s.result?.derivations[id];
  const u = unitFor(s, id);
  return (
    <button
      className="tile"
      onClick={() => {
        scrollToVar(id);
        s.flashVar(id);
      }}
    >
      <div className="t-label">{label ?? VAR[id].label}</div>
      <div className="t-value">
        {d ? displayNumber(d.value, u, id) : '—'}
        {d && u.label && <span className="t-unit">{u.label}</span>}
      </div>
      <div className="t-state">{d ? (STATUS_WORD[d.status] ?? d.status) : 'not yet known'}</div>
    </button>
  );
}

function Overview() {
  const { s, two, foil, planform } = useFoil();
  const { result, sim } = s;
  if (!result)
    return (
      <div className="empty">Results appear here as soon as there is something to calculate.</div>
    );
  const v = result.values;
  const lenU = unitFor(s, 'b');
  const drawings = [
    { name: 'Main foil', outline: sim?.outline, b: v.b, cr: v.cr, ct: v.ct, planform: s.planform },
    ...(two
      ? [
          {
            name: 'Secondary foil',
            outline: sim?.second?.outline,
            b: v.b2,
            cr: v.cr2,
            ct: v.ct2,
            planform: s.foil2.planform,
          },
        ]
      : []),
  ];
  const spans = drawings.map((d) => d.b).filter((b) => Number.isFinite(b));
  const refSpan = spans.length ? Math.max(...spans) : undefined;
  return (
    <>
      {two && (
        <>
          <h3 className="tiles-head">Both foils</h3>
          <div className="tiles">
            {CRAFT_TILE_IDS.map((id) => (
              <Tile key={id} id={id} />
            ))}
          </div>
          <h3 className="tiles-head">{foil === 2 ? 'Secondary foil' : 'Main foil'}</h3>
        </>
      )}
      <div className="tiles">
        {TILE_IDS.filter((id) => !(planform === 'elliptical' && id === 'ct')).map((id) => (
          <Tile key={id} id={foilId(id, foil)} label={VAR[id].label} />
        ))}
      </div>
      <h3 className="tiles-head planform-head">
        {two ? 'Planforms' : 'Planform'}
        <span className="planform-note">
          Top view, looking down on the {two ? 'foils' : 'foil'}. Water flows from the top of the
          drawing.
        </span>
      </h3>
      {drawings.map((d) =>
        d.outline && Number.isFinite(d.b) && Number.isFinite(d.cr) ? (
          <figure className="planform-fig" key={d.name}>
            {two && <figcaption>{d.name}</figcaption>}
            <PlanformView
              outline={d.outline}
              span={d.b}
              rootChord={d.cr}
              tipChord={d.planform === 'elliptical' ? null : (d.ct ?? null)}
              unitId={lenU.id}
              refSpan={two ? refSpan : undefined}
              name={two ? d.name : undefined}
            />
          </figure>
        ) : (
          <div className="empty" key={d.name}>
            The {two ? d.name.toLowerCase() : 'foil'} drawing appears once span and root chord are
            known.
          </div>
        ),
      )}
    </>
  );
}

function SectionTab() {
  const { values, sim, sectionInfo } = useFoil();
  const sec = sim?.section;
  if (!sec || !sectionInfo)
    return (
      <div className="empty">Paste a profile to see its pressure distribution and polars.</div>
    );
  const cp = sec.cp;
  const up = cp ? cp.x.map((x, i) => ({ x, y: cp.cp[i], u: cp.upper[i] })) : [];
  const upper = up.filter((p) => p.u).sort((a, b) => a.x - b.x);
  const lower = up.filter((p) => !p.u).sort((a, b) => a.x - b.x);
  const sigma = values?.sigma;
  const clmax = values?.clmax;
  const series: Series[] = [
    {
      id: 'u',
      label: 'Upper (suction) side',
      x: upper.map((p) => p.x),
      y: upper.map((p) => p.y),
      color: C1,
    },
    {
      id: 'l',
      label: 'Lower (pressure) side',
      x: lower.map((p) => p.x),
      y: lower.map((p) => p.y),
      color: C2,
    },
  ];
  return (
    <>
      <p className="small muted" style={{ marginTop: 0 }}>
        {sectionInfo.mode === 'polar'
          ? 'Lift and drag from your pasted polars'
          : 'Lift and drag estimated (panel method + boundary layer)'}{' '}
        at Re = {fmtSci(sec.Re)}. Pressures from the inviscid panel method.
      </p>
      <div className="charts">
        <LineChart
          title="Pressure distribution"
          help="Water pressure along the top and bottom of the foil shape, from the front (0) to the back (1). Low pressure on top is what pulls the foil up, so it is drawn upward. If the top curve goes past the dashed cavitation line, bubbles form there."
          subtitle={
            sec.cl !== null
              ? `At section cl = ${fmt(sec.cl, 3)} (most-loaded station at cruise). Suction plotted upward.`
              : 'At cl = 0.5'
          }
          xLabel="x/c"
          yLabel="Cp"
          invertY
          series={series}
          refLines={
            Number.isFinite(sigma)
              ? [{ y: -sigma!, label: `−σ = ${fmt(-sigma!, 3)} (cavitation if Cp falls below)` }]
              : []
          }
        />
        <LineChart
          title="Section lift curve"
          help="How much lift the shape makes as it tilts more. Lift rises steadily, then levels off and drops when the shape stalls. The dot is where the foil works at cruise."
          subtitle="2-D section; the dot is the most-loaded station at cruise"
          xLabel="α (°)"
          yLabel="cl"
          series={[
            { id: 'cl', label: 'cl', x: sec.liftCurve.alphaDeg, y: sec.liftCurve.cl, color: C1 },
          ]}
          points={sec.op ? [{ x: sec.op.alphaDeg, y: sec.op.cl, label: 'cruise' }] : []}
          refLines={Number.isFinite(clmax) ? [{ y: clmax!, label: 'cl,max' }] : []}
        />
        <LineChart
          title="Section drag"
          help="Drag against lift for the shape. Where the curve is lowest, the shape makes lift with the least drag. The dot is where the foil works at cruise."
          subtitle="Drag coefficient against lift coefficient"
          xLabel="cl"
          yLabel="cd"
          series={[{ id: 'cd', label: 'cd', x: sec.dragPolar.cl, y: sec.dragPolar.cd, color: C1 }]}
          points={sec.op ? [{ x: sec.op.cl, y: sec.op.cd, label: 'cruise' }] : []}
          yFmt={(v) => fmt(v, 2)}
        />
      </div>
    </>
  );
}

function SpanTab() {
  const { s, values, sim } = useFoil();
  const span = sim?.span;
  const len = useConv('b');
  const force = getUnit('force', s.units.L ?? SYSTEM_DEFAULTS[s.unitSystem].force);
  const mom = useConv('Mroot');
  const str = useConv('sigmaMax');
  const def = useConv('deflTip');
  if (!span)
    return (
      <div className="empty">
        Spanwise loading appears once the foil is sized (span, chord, lift and lift coefficient
        known).
      </div>
    );
  const y = span.y.map(len.f);
  const xl = `Distance from centre (${len.unit.label})`;
  const perLen = `${force.label}/${len.unit.label}`;
  const sy = values?.sy;
  return (
    <div className="charts">
      <LineChart
        title="Local lift coefficient"
        help="How hard each part of the foil works, from the middle (0) out to the tip. Where the line reaches the cl,max line, that part stalls first."
        subtitle="Section cl along the span (lifting line). Stall starts where it first reaches cl,max."
        xLabel={xl}
        yLabel="cl"
        series={[{ id: 'cl', label: 'cl', x: y, y: span.clLocal, color: C1 }]}
        refLines={[{ y: span.clmax, label: 'cl,max' }]}
        includeZero
      />
      <LineChart
        title="Lift per unit span"
        help="How the lift is spread from the middle of the foil out to the tip. Most of the lift is made near the middle."
        xLabel={xl}
        yLabel={perLen}
        series={[
          {
            id: 'l',
            label: 'lift',
            x: y,
            y: span.liftPerSpan.map((v) => fromSI(v, force) * len.unit.factor),
            color: C1,
          },
        ]}
        includeZero
      />
      <LineChart
        title="Bending moment"
        help="How hard the lift tries to bend the foil at each point. It is largest at the middle, where the foil joins the mast."
        xLabel={xl}
        yLabel={mom.unit.label}
        series={[{ id: 'm', label: 'M', x: y, y: span.moment.map(mom.f), color: C1 }]}
        includeZero
      />
      <LineChart
        title="Bending stress (solid section)"
        help="The strain inside the material at each point. It must stay well below the material strength line."
        xLabel={xl}
        yLabel={str.unit.label}
        series={[{ id: 's', label: 'σ', x: y, y: span.stress.map(str.f), color: C1 }]}
        refLines={Number.isFinite(sy) ? [{ y: str.f(sy!), label: 'material strength' }] : []}
        includeZero
      />
      <LineChart
        title="Deflection"
        help="How far each point of the foil bends up under load. The tips bend the most."
        xLabel={xl}
        yLabel={def.unit.label}
        series={[{ id: 'd', label: 'δ', x: y, y: span.deflection.map(def.f), color: C1 }]}
        includeZero
      />
    </div>
  );
}

function SweepTab() {
  const s = useStore();
  const two = s.foil2.enabled;
  const sw = s.sim?.sweep;
  const sw2 = two ? (s.sim?.second?.sweep ?? null) : null;
  const tot = two ? (s.sim?.total ?? null) : null;
  const spd = useConv('V');
  const ang = useConv('alpha');
  const frc = useConv('D');
  const pow = useConv('P');
  if (!sw)
    return (
      <div className="empty">
        The speed sweep appears once lift, area and aspect ratio are known.
      </div>
    );
  const x = sw.V.map(spd.f);
  const mask = (arr: number[], stalled: boolean[]) => arr.map((v, i) => (stalled[i] ? NaN : v));
  const mk = tot?.markers ?? sw.markers;
  const markers = [
    mk.Vto !== undefined && Number.isFinite(mk.Vto)
      ? { x: spd.f(mk.Vto), label: 'take-off' }
      : null,
    mk.V !== undefined && Number.isFinite(mk.V) ? { x: spd.f(mk.V), label: 'cruise' } : null,
    mk.Vcav !== undefined ? { x: spd.f(mk.Vcav), label: 'cavitation' } : null,
  ].filter(Boolean) as { x: number; label: string }[];
  const xl = `Speed (${spd.unit.label})`;
  // the main foil, plus the secondary foil and both together when there are two
  const series = (
    pick: (w: SweepResult) => number[] | null,
    conv: (v: number) => number = (v) => v,
    total?: number[],
  ): Series[] => {
    const parts = [
      { id: 'main', label: 'Main foil', ys: pick(sw), stalled: sw.stalled, color: C1 },
      ...(sw2
        ? [
            {
              id: 'second',
              label: 'Secondary foil',
              ys: pick(sw2),
              stalled: sw2.stalled,
              color: C2,
            },
          ]
        : []),
      ...(tot && total
        ? [{ id: 'total', label: 'Both foils', ys: total, stalled: tot.stalled, color: C3 }]
        : []),
    ];
    return parts.flatMap((p) =>
      p.ys
        ? [{ id: p.id, label: p.label, x, y: mask(p.ys.map(conv), p.stalled), color: p.color }]
        : [],
    );
  };
  return (
    <>
      <p className="small muted" style={{ marginTop: 0 }}>
        {two ? 'The foils' : 'The foil'} as designed, carrying the same load at different speeds.
        Below take-off speed {two ? 'a foil' : 'it'} cannot carry {two ? 'its share of ' : ''}the
        load (stalled points omitted).
      </p>
      <div className="charts">
        <LineChart
          title="Angle of attack needed"
          help="How much the foil must tilt to hold the load at each speed. Slower speeds need more tilt. Where the line reaches the stall line, the foil can no longer hold the load: that is the take-off speed."
          xLabel={xl}
          yLabel={`α (${ang.unit.label})`}
          series={series((w) => w.alpha, ang.f)}
          refLines={[
            ...markers,
            ...(Number.isFinite(sw.alphaStall)
              ? [{ y: ang.f(sw.alphaStall), label: sw2 ? 'stall (main)' : 'stall' }]
              : []),
            ...(sw2 && Number.isFinite(sw2.alphaStall)
              ? [{ y: ang.f(sw2.alphaStall), label: 'stall (secondary)' }]
              : []),
          ]}
        />
        <LineChart
          title="Drag"
          help="Drag at each speed. At low speed most drag comes from making lift; at high speed most comes from water rubbing on the surface. The lowest point is the most efficient speed."
          xLabel={xl}
          yLabel={frc.unit.label}
          series={series((w) => w.D, frc.f, tot?.D)}
          refLines={markers}
          includeZero
        />
        <LineChart
          title="Power to overcome drag"
          help="The power needed to push the foil at each speed (drag × speed)."
          xLabel={xl}
          yLabel={pow.unit.label}
          series={series((w) => w.P, pow.f, tot?.P)}
          refLines={markers}
          includeZero
        />
        <LineChart
          title="Lift ÷ drag"
          help="How much weight is carried for each unit of drag, at each speed. The peak is the most efficient speed."
          xLabel={xl}
          yLabel="L/D"
          series={series((w) => w.LD, undefined, tot?.LD)}
          refLines={markers}
          includeZero
        />
        {(sw.cavMargin || sw2?.cavMargin) && (
          <LineChart
            title="Cavitation margin"
            help="Below zero, bubbles are predicted on the foil. The speed where the line crosses zero is where cavitation starts."
            subtitle="σ + Cp,min — cavitation is predicted below zero"
            xLabel={xl}
            yLabel="σ + Cp,min"
            series={series((w) => w.cavMargin)}
            refLines={[...markers, { y: 0, label: 'cavitation' }]}
          />
        )}
      </div>
    </>
  );
}

function orderedDerivations(d: Record<string, Derivation>) {
  const rank: Record<string, number> = {
    input: 0,
    conflict: 0,
    assumed: 1,
    optimised: 1,
    section: 2,
    material: 2,
    constant: 2,
    calculated: 3,
  };
  return Object.values(d).sort(
    (a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9) || a.order - b.order,
  );
}

function CalcTab() {
  const s = useStore();
  const { result, profile } = s;
  const usedBy = useMemo(() => {
    const m: Record<string, string[]> = {};
    if (!result) return m;
    for (const d of Object.values(result.derivations))
      for (const i of d.inputs) (m[i] ??= []).push(d.varId);
    return m;
  }, [result]);
  if (!result || Object.keys(result.derivations).length === 0)
    return <div className="empty">Every value’s worked calculation will be listed here.</div>;
  const units = Object.fromEntries(Object.keys(VAR).map((id) => [id, unitFor(s, id).id]));
  const md = () =>
    buildReport(result, `${profile?.name ?? 'Hydrofoil'} — design calculations`, units);
  return (
    <>
      <div className="row no-print" style={{ marginBottom: 8 }}>
        <button className="btn" onClick={() => navigator.clipboard?.writeText(md())}>
          Copy as Markdown
        </button>
        <button
          className="btn"
          onClick={() =>
            download(`${slug(profile?.name ?? 'hydrofoil')}-calculations.md`, md(), 'text/markdown')
          }
        >
          Download .md
        </button>
        <button className="btn" onClick={() => window.print()}>
          Print
        </button>
      </div>
      <div className="calc-list">
        {orderedDerivations(result.derivations).map((d) => {
          const u = unitFor(s, d.varId);
          return (
            <div className="calc-item" key={d.varId}>
              <h4>
                {VAR[d.varId].label}
                <span className="v">
                  {displayNumber(d.value, u, d.varId)} {u.label}
                </span>
              </h4>
              <DerivationView d={d} usedBy={usedBy[d.varId] ?? []} />
            </div>
          );
        })}
      </div>
    </>
  );
}

function ExportTab() {
  const { s, two, foil, values, planform, profile } = useFoil();
  const { result } = s;
  const v = values ?? {};
  const designName = slug(s.profile?.name ?? 'foil');
  const name = `${slug(profile?.name ?? 'foil')}${foil === 2 ? '-secondary' : ''}`;
  const sized = profile && Number.isFinite(v.cr) && Number.isFinite(v.b);
  const ct = planform === 'elliptical' ? 0 : (v.ct ?? v.cr);
  const lambda = planform === 'tapered' ? (v.lambda ?? 1) : planform === 'rectangular' ? 1 : 0;
  const units = Object.fromEntries(Object.keys(VAR).map((id) => [id, unitFor(s, id).id]));
  const which = foil === 2 ? 'secondary foil' : 'main foil';
  return (
    <>
      {two && (
        <p className="small muted" style={{ marginTop: 0 }}>
          The drawing, point files and profile below are for the {which}. The report and design file
          cover both foils.
        </p>
      )}
      <div className="export-grid">
        <div className="card">
          <strong className="label-help">
            DXF drawing
            <Help label="DXF drawing">
              A DXF is a drawing file that most CAD programs and CNC or laser cutters can open. It
              holds the outline of the foil from above and the foil shape at the middle and the tip,
              all in millimetres.
            </Help>
          </strong>
          <p>
            Root and tip sections (quarter chords aligned) and the half planform, in millimetres, on
            separate layers. Imports into Fusion 360, SolidWorks, Onshape, FreeCAD and CNC/laser
            tools.
          </p>
          <button
            className="btn primary"
            disabled={!sized}
            onClick={() =>
              download(
                `${name}-foil.dxf`,
                buildDxf({
                  profile: profile!,
                  planform,
                  lambda,
                  span: v.b,
                  rootChord: v.cr,
                  tipChord: ct,
                  name: foil === 2 ? `${profile!.name} (secondary foil)` : profile!.name,
                }),
                'application/dxf',
              )
            }
          >
            Download .dxf
          </button>
        </div>
        <div className="card">
          <strong className="label-help">
            Section point files
            <Help label="Section point files">
              Lists of points that trace the foil shape at the middle (root) and at the tip. Many
              CAD programs can draw a smooth curve through them, which you can then use to model the
              foil.
            </Help>
          </strong>
          <p>
            “x y z” in mm for spline import (e.g. SolidWorks Curve Through XYZ Points). Root at z =
            0, tip at the semi-span.
          </p>
          <div className="row">
            <button
              className="btn"
              disabled={!sized}
              onClick={() => download(`${name}-root-xyz.txt`, sectionXyz(profile!, v.cr, 0))}
            >
              Root .txt
            </button>
            <button
              className="btn"
              disabled={!sized || ct <= 0}
              onClick={() => download(`${name}-tip-xyz.txt`, sectionXyz(profile!, ct, v.b / 2))}
            >
              Tip .txt
            </button>
            <button
              className="btn"
              disabled={!sized}
              onClick={() =>
                download(
                  `${name}-sections.csv`,
                  sectionsCsv(profile!, v.cr, ct, v.b / 2),
                  'text/csv',
                )
              }
            >
              Both .csv
            </button>
          </div>
        </div>
        <div className="card">
          <strong className="label-help">
            Calculation report
            <Help label="Calculation report">
              A text file listing every value and how it was worked out. Markdown (.md) files open
              in any text editor.
            </Help>
          </strong>
          <p>Every value with its formula, numbers substituted and source, as Markdown.</p>
          <button
            className="btn"
            disabled={!result}
            onClick={() =>
              download(
                `${designName}-calculations.md`,
                buildReport(
                  result!,
                  `${s.profile?.name ?? 'Hydrofoil'} — design calculations`,
                  units,
                ),
                'text/markdown',
              )
            }
          >
            Download .md
          </button>
        </div>
        <div className="card">
          <strong className="label-help">
            Design file
            <Help label="Design file">
              Saves your whole design, so you can load it again later with the Open button at the
              top.
            </Help>
          </strong>
          <p>
            Everything you entered (profile, polars, values, units, requirements) to reopen later
            with “Open”.
          </p>
          <button
            className="btn"
            onClick={() =>
              download(
                `${designName}-design.json`,
                JSON.stringify(docOf(s), null, 2),
                'application/json',
              )
            }
          >
            Download .json
          </button>
        </div>
        <div className="card">
          <strong className="label-help">
            Normalised profile
            <Help label="Normalised profile">
              Your foil shape cleaned up and saved in the common Selig .dat format, scaled so its
              front-to-back length is 1.
            </Help>
          </strong>
          <p>The pasted section re-written in Selig format at unit chord.</p>
          <button
            className="btn"
            disabled={!profile}
            onClick={() => download(`${name}.dat`, toSelig(profile!))}
          >
            Download .dat
          </button>
        </div>
      </div>
    </>
  );
}
