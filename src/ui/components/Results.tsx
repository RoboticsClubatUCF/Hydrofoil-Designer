import { useMemo, useState } from 'react';
import { useStore, unitFor } from '../../state/store';
import { fmt, fromSI, getUnit, SYSTEM_DEFAULTS } from '../../physics/units';
import { toSelig } from '../../physics/profile/parse';
import { VAR } from '../../solver/variables';
import type { Derivation } from '../../solver/types';
import { buildDxf } from '../../export/dxf';
import { sectionXyz, sectionsCsv } from '../../export/xyz';
import { buildReport } from '../../export/report';
import { LineChart, type Series } from '../charts/LineChart';
import { PlanformView } from '../charts/PlanformView';
import { DerivationView } from './Derivation';
import { displayNumber, download, fmtSci, scrollToVar, slug } from '../format';
import { docOf } from '../../state/store';

type Tab = 'overview' | 'section' | 'span' | 'sweep' | 'calc' | 'export';
const TABS: { id: Tab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'section', label: 'Section' },
  { id: 'span', label: 'Span & structure' },
  { id: 'sweep', label: 'Speed sweep' },
  { id: 'calc', label: 'Calculations' },
  { id: 'export', label: 'Export' },
];

const C1 = 'var(--series-1)';
const C2 = 'var(--series-2)';

export function Results() {
  const [tab, setTab] = useState<Tab>('overview');
  return (
    <section className="card" aria-label="Results">
      <div className="tabs" role="tablist">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'overview' && <Overview />}
        {tab === 'section' && <SectionTab />}
        {tab === 'span' && <SpanTab />}
        {tab === 'sweep' && <SweepTab />}
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

function Overview() {
  const s = useStore();
  const { result, sim, planform, flashVar } = s;
  if (!result)
    return (
      <div className="empty">Results appear here as soon as there is something to calculate.</div>
    );
  const v = result.values;
  const lenU = unitFor(s, 'b');
  return (
    <>
      {sim?.outline && Number.isFinite(v.b) && Number.isFinite(v.cr) ? (
        <PlanformView
          outline={sim.outline}
          span={v.b}
          rootChord={v.cr}
          tipChord={planform === 'elliptical' ? null : (v.ct ?? null)}
          unitId={lenU.id}
        />
      ) : (
        <div className="empty">The foil drawing appears once span and root chord are known.</div>
      )}
      <div className="tiles" style={{ marginTop: 12 }}>
        {TILE_IDS.filter((id) => !(planform === 'elliptical' && id === 'ct')).map((id) => {
          const d = result.derivations[id];
          const u = unitFor(s, id);
          return (
            <button
              key={id}
              className="tile"
              onClick={() => {
                scrollToVar(id);
                flashVar(id);
              }}
            >
              <div className="t-label">{VAR[id].label}</div>
              <div className="t-value">
                {d ? displayNumber(d.value, u, id) : '—'}
                {d && u.label && <span className="t-unit">{u.label}</span>}
              </div>
              <div className="t-state">
                {d ? (STATUS_WORD[d.status] ?? d.status) : 'not yet known'}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}

function SectionTab() {
  const s = useStore();
  const { sim, result, sectionInfo } = s;
  const sec = sim?.section;
  if (!sec || !sectionInfo)
    return (
      <div className="empty">Paste a profile to see its pressure distribution and polars.</div>
    );
  const cp = sec.cp;
  const up = cp ? cp.x.map((x, i) => ({ x, y: cp.cp[i], u: cp.upper[i] })) : [];
  const upper = up.filter((p) => p.u).sort((a, b) => a.x - b.x);
  const lower = up.filter((p) => !p.u).sort((a, b) => a.x - b.x);
  const sigma = result?.values.sigma;
  const clmax = result?.values.clmax;
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
  const s = useStore();
  const { sim, result } = s;
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
  const sy = result?.values.sy;
  return (
    <div className="charts">
      <LineChart
        title="Local lift coefficient"
        subtitle="Section cl along the span (lifting line). Stall starts where it first reaches cl,max."
        xLabel={xl}
        yLabel="cl"
        series={[{ id: 'cl', label: 'cl', x: y, y: span.clLocal, color: C1 }]}
        refLines={[{ y: span.clmax, label: 'cl,max' }]}
        includeZero
      />
      <LineChart
        title="Lift per unit span"
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
        xLabel={xl}
        yLabel={mom.unit.label}
        series={[{ id: 'm', label: 'M', x: y, y: span.moment.map(mom.f), color: C1 }]}
        includeZero
      />
      <LineChart
        title="Bending stress (solid section)"
        xLabel={xl}
        yLabel={str.unit.label}
        series={[{ id: 's', label: 'σ', x: y, y: span.stress.map(str.f), color: C1 }]}
        refLines={Number.isFinite(sy) ? [{ y: str.f(sy!), label: 'material strength' }] : []}
        includeZero
      />
      <LineChart
        title="Deflection"
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
  const sw = s.sim?.sweep;
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
  const mask = (arr: number[]) => arr.map((v, i) => (sw.stalled[i] ? NaN : v));
  const markers = [
    sw.markers.Vto !== undefined && Number.isFinite(sw.markers.Vto)
      ? { x: spd.f(sw.markers.Vto), label: 'take-off' }
      : null,
    sw.markers.V !== undefined && Number.isFinite(sw.markers.V)
      ? { x: spd.f(sw.markers.V), label: 'cruise' }
      : null,
    sw.markers.Vcav !== undefined ? { x: spd.f(sw.markers.Vcav), label: 'cavitation' } : null,
  ].filter(Boolean) as { x: number; label: string }[];
  const xl = `Speed (${spd.unit.label})`;
  return (
    <>
      <p className="small muted" style={{ marginTop: 0 }}>
        The foil as designed, carrying the same load at different speeds. Below take-off speed it
        cannot carry the load (stalled points omitted).
      </p>
      <div className="charts">
        <LineChart
          title="Angle of attack needed"
          xLabel={xl}
          yLabel={`α (${ang.unit.label})`}
          series={[{ id: 'a', label: 'α', x, y: mask(sw.alpha.map(ang.f)), color: C1 }]}
          refLines={[
            ...markers,
            ...(Number.isFinite(sw.alphaStall)
              ? [{ y: ang.f(sw.alphaStall), label: 'stall' }]
              : []),
          ]}
        />
        <LineChart
          title="Drag"
          xLabel={xl}
          yLabel={frc.unit.label}
          series={[{ id: 'd', label: 'drag', x, y: mask(sw.D.map(frc.f)), color: C1 }]}
          refLines={markers}
          includeZero
        />
        <LineChart
          title="Power to overcome drag"
          xLabel={xl}
          yLabel={pow.unit.label}
          series={[{ id: 'p', label: 'power', x, y: mask(sw.P.map(pow.f)), color: C1 }]}
          refLines={markers}
          includeZero
        />
        <LineChart
          title="Lift ÷ drag"
          xLabel={xl}
          yLabel="L/D"
          series={[{ id: 'ld', label: 'L/D', x, y: mask(sw.LD), color: C1 }]}
          refLines={markers}
          includeZero
        />
        {sw.cavMargin && (
          <LineChart
            title="Cavitation margin"
            subtitle="σ + Cp,min — cavitation is predicted below zero"
            xLabel={xl}
            yLabel="σ + Cp,min"
            series={[{ id: 'c', label: 'margin', x, y: mask(sw.cavMargin), color: C1 }]}
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
  const s = useStore();
  const { result, profile, planform } = s;
  const v = result?.values ?? {};
  const name = slug(profile?.name ?? 'foil');
  const sized = profile && Number.isFinite(v.cr) && Number.isFinite(v.b);
  const ct = planform === 'elliptical' ? 0 : (v.ct ?? v.cr);
  const lambda = planform === 'tapered' ? (v.lambda ?? 1) : planform === 'rectangular' ? 1 : 0;
  const units = Object.fromEntries(Object.keys(VAR).map((id) => [id, unitFor(s, id).id]));
  return (
    <div className="export-grid">
      <div className="card">
        <strong>DXF drawing</strong>
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
                name: profile!.name,
              }),
              'application/dxf',
            )
          }
        >
          Download .dxf
        </button>
      </div>
      <div className="card">
        <strong>Section point files</strong>
        <p>
          “x y z” in mm for spline import (e.g. SolidWorks Curve Through XYZ Points). Root at z = 0,
          tip at the semi-span.
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
              download(`${name}-sections.csv`, sectionsCsv(profile!, v.cr, ct, v.b / 2), 'text/csv')
            }
          >
            Both .csv
          </button>
        </div>
      </div>
      <div className="card">
        <strong>Calculation report</strong>
        <p>Every value with its formula, numbers substituted and source, as Markdown.</p>
        <button
          className="btn"
          disabled={!result}
          onClick={() =>
            download(
              `${name}-calculations.md`,
              buildReport(result!, `${profile?.name ?? 'Hydrofoil'} — design calculations`, units),
              'text/markdown',
            )
          }
        >
          Download .md
        </button>
      </div>
      <div className="card">
        <strong>Design file</strong>
        <p>
          Everything you entered (profile, polars, values, units, requirements) to reopen later with
          “Open”.
        </p>
        <button
          className="btn"
          onClick={() =>
            download(`${name}-design.json`, JSON.stringify(docOf(s), null, 2), 'application/json')
          }
        >
          Download .json
        </button>
      </div>
      <div className="card">
        <strong>Normalised profile</strong>
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
  );
}
