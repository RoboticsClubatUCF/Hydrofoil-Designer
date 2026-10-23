import { useEffect, useMemo, useRef, useState } from 'react';
import { requestFlow, unitFor, useStore } from '../../state/store';
import { fmt, fromSI, type Unit } from '../../physics/units';
import { foilValues } from '../../solver/variables';
import { kelvinWavelength } from '../../flow3d/surface';
import { defaultPeakPeriod, seaComponents } from '../../flow3d/seaState';
import type { FlowFoilRequest, FlowState } from '../../flow3d/types';
import type { SurfaceWorkerIn, SurfaceWorkerOut } from '../../flow3d/surface.worker';
import { G } from '../../physics/fluid';
import { DRAG_MAGNIFY } from './annotations';
import { strutSize } from './craft';
import { Help } from '../components/Help';
import {
  FlowScene,
  type CameraPreset,
  type GustReadout,
  type SeedMode,
  type ViewSettings,
} from './scene';

const SETTINGS_KEY = 'hydrofoil-designer:3d-view';

interface UiSettings extends ViewSettings {
  showHud: boolean;
}

const DEFAULT_SETTINGS: UiSettings = {
  showHud: true,
  playing: true,
  timeScale: 0,
  particles: true,
  particleCount: 8000,
  seed: 'volume',
  sliceY: 0.3,
  colourBy: 'pressure',
  streak: 1,
  streamlines: false,
  foilColour: 'pressure',
  showCraft: true,
  showPerson: true,
  dimensions: true,
  forces: true,
  cutaway: true,
  surface: true,
  surfaceStyle: 'realistic',
  contours: false,
  exaggeration: 1,
};

function loadSettings(): UiSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw), playing: true, timeScale: 0 };
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_SETTINGS;
}

function saveSettings(s: UiSettings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

const ok = (x: number | undefined): x is number => x !== undefined && Number.isFinite(x);

const CAMERAS: { id: CameraPreset; label: string }[] = [
  { id: 'three-quarter', label: 'Under water' },
  { id: 'section', label: 'Section' },
  { id: 'front', label: 'Front' },
  { id: 'behind', label: 'Wake & tips' },
  { id: 'above', label: 'Above' },
  { id: 'wake', label: 'Surface wake' },
];

const SEEDS: { id: SeedMode; label: string }[] = [
  { id: 'volume', label: 'Around the foil' },
  { id: 'slice', label: 'One section' },
  { id: 'tips', label: 'Tips' },
  { id: 'surface', label: 'Near the surface' },
];

/** Default value of a control, restored by its reset button. */
interface Resettable<T> {
  reset?: T;
}

/** Small ↺ button that puts one control back to its default (greyed out when it already is). */
function ResetButton(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="f3-reset"
      onClick={props.onClick}
      disabled={!props.active}
      aria-label={`Reset ${props.label}`}
      title={props.active ? `Reset ${props.label} to its default` : 'At its default'}
    >
      ↺
    </button>
  );
}

const near = (a: number, b: number) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

/** A labelled range input; log = logarithmic scale. */
function Slider(
  props: {
    label: string;
    value: number;
    min: number;
    max: number;
    onChange: (v: number) => void;
    display: string;
    log?: boolean;
    step?: number;
    help?: string;
  } & Resettable<number>,
) {
  const { label, value, min, max, onChange, display, log, help, reset } = props;
  const N = 1000;
  const toPos = (v: number) =>
    log ? (Math.log(v / min) / Math.log(max / min)) * N : ((v - min) / (max - min)) * N;
  const fromPos = (p: number) =>
    log ? min * Math.pow(max / min, p / N) : min + ((max - min) * p) / N;
  const pos = Math.min(N, Math.max(0, toPos(value)));
  return (
    <div className="f3-slider">
      <span className="f3-slider-head">
        <span className="label-help">
          {label}
          {help && <Help label={label}>{help}</Help>}
        </span>
        <span className="f3-val">
          {display}
          {reset !== undefined && (
            <ResetButton
              label={label}
              active={!near(value, reset)}
              onClick={() => onChange(reset)}
            />
          )}
        </span>
      </span>
      <input
        type="range"
        min={0}
        max={N}
        step={props.step ?? 1}
        value={Number.isFinite(pos) ? pos : 0}
        onChange={(e) => onChange(fromPos(Number(e.target.value)))}
        aria-label={label}
      />
    </div>
  );
}

function Toggle(
  props: {
    label: string;
    checked: boolean;
    onChange: (v: boolean) => void;
    help?: string;
  } & Resettable<boolean>,
) {
  const { reset } = props;
  return (
    <span className="f3-opt">
      <label className="f3-toggle">
        <input
          type="checkbox"
          checked={props.checked}
          onChange={(e) => props.onChange(e.target.checked)}
        />
        {props.label}
      </label>
      {props.help && <Help label={props.label}>{props.help}</Help>}
      {reset !== undefined && (
        <ResetButton
          label={props.label}
          active={props.checked !== reset}
          onClick={() => props.onChange(reset)}
        />
      )}
    </span>
  );
}

function Select<T extends string | number>(
  props: {
    label: string;
    value: T;
    options: { id: T; label: string }[];
    onChange: (v: T) => void;
    help?: string;
  } & Resettable<T>,
) {
  const { reset } = props;
  return (
    <span className="f3-opt">
      <label className="f3-select">
        <span>{props.label}</span>
        <select
          value={String(props.value)}
          onChange={(e) => {
            const o = props.options.find((x) => String(x.id) === e.target.value);
            if (o) props.onChange(o.id);
          }}
        >
          {props.options.map((o) => (
            <option key={String(o.id)} value={String(o.id)}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      {props.help && <Help label={props.label}>{props.help}</Help>}
      {reset !== undefined && (
        <ResetButton
          label={props.label}
          active={props.value !== reset}
          onClick={() => props.onChange(reset)}
        />
      )}
    </span>
  );
}

const show = (si: number, u: Unit, sig = 3) =>
  Number.isFinite(si) ? `${fmt(fromSI(si, u), sig)} ${u.label}` : '—';
const deg = (r: number, d = 1) =>
  Number.isFinite(r) ? `${((r * 180) / Math.PI).toFixed(d)}°` : '—';

export default function FlowView() {
  const result = useStore((s) => s.result);
  const sim = useStore((s) => s.sim);
  const planform = useStore((s) => s.planform);
  const foil2 = useStore((s) => s.foil2);
  const units = useStore((s) => s.units);
  const unitSystem = useStore((s) => s.unitSystem);
  const sectionInfo = useStore((s) => s.sectionInfo);
  const sectionInfo2 = useStore((s) => s.sectionInfo2);
  const u = useMemo(() => {
    const st = { units, unitSystem };
    return {
      V: unitFor(st, 'V'),
      h: unitFor(st, 'h'),
      b: unitFor(st, 'b'),
      cr: unitFor(st, 'cr'),
      S: unitFor(st, 'S'),
      m: unitFor(st, 'm'),
      L: unitFor(st, 'L'),
      D: unitFor(st, 'D'),
      P: unitFor(st, 'P'),
    };
  }, [units, unitSystem]);

  const v = result?.values;
  const main = v ?? null;
  const two = foil2.enabled && !!v && ok(v.b2) && ok(v.cr2) && ok(v.L2);
  const sec = useMemo(() => (two && v ? foilValues(v, 2) : null), [two, v]);
  const ready =
    !!main &&
    ok(main.b) &&
    ok(main.cr) &&
    ok(main.L) &&
    main.L > 0 &&
    !!sectionInfo &&
    (!two || foil2.sameSection || !!sectionInfo2);

  // ---------------- operating point chosen here (SI)
  const designV = ok(main?.V) ? main!.V : ok(main?.Vto) ? 1.3 * main!.Vto : 5;
  const mac = ok(main?.mac) ? main!.mac : (main?.cr ?? 0.15);
  const designH = ok(main?.h) ? main!.h : Math.max(0.3, 3 * mac);
  const [op, setOp] = useState({ V: designV, load: 1, h: designH, x2: 0.8 * (main?.b ?? 1) });
  const [sea, setSea] = useState({ Hs: 0, Tp: defaultPeakPeriod(0.3), dir: 0 });
  const designKey = `${designV}|${designH}|${main?.b}`;
  const lastDesign = useRef(designKey);
  useEffect(() => {
    if (lastDesign.current === designKey) return;
    lastDesign.current = designKey;
    setOp((o) => ({ ...o, V: designV, h: designH, x2: 0.8 * (main?.b ?? 1) }));
  }, [designKey, designV, designH, main?.b]);

  // ---------------- view settings
  const [settings, setSettings] = useState<UiSettings>(loadSettings);
  const set = (patch: Partial<UiSettings>) => setSettings((s) => ({ ...s, ...patch }));
  useEffect(() => saveSettings(settings), [settings]);

  // ---------------- scene, workers
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<FlowScene | null>(null);
  const surfRef = useRef<Worker | null>(null);
  const lineRef = useRef<Worker | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flow, setFlow] = useState<FlowState | null>(null);
  const [gust, setGust] = useState<GustReadout | null>(null);
  const [fps, setFps] = useState(0);
  const [stepMs, setStepMs] = useState(0);
  const [full, setFull] = useState(false);
  const [busy, setBusy] = useState(false);
  const [contour, setContour] = useState(0);

  const sweep = sim?.sweep;
  const vLo = sweep ? sweep.V[0] : 0.3 * designV;
  // up to the sweep's top speed, and past cavitation inception (at the depth and load set here) so it can be seen
  const vCavs = (flow?.foils ?? [])
    .map((f) => f.op.Vcav)
    .filter((x): x is number => x !== null && Number.isFinite(x));
  const vCav = vCavs.length ? Math.min(...vCavs) : v && ok(v.Vcav) ? v.Vcav : undefined;
  const vHi = Math.max(
    sweep ? sweep.V[sweep.V.length - 1] : 2 * designV,
    vCav !== undefined ? 1.15 * vCav : 0,
  );

  const autoTimeScale = useMemo(() => {
    const lref = flow?.lref ?? main?.b ?? 1;
    return Math.min(1, Math.max(0.01, lref / (2.5 * op.V)));
  }, [flow?.lref, main?.b, op.V]);
  const timeScale = settings.timeScale > 0 ? settings.timeScale : autoTimeScale;
  const eff = useMemo(() => ({ ...settings, timeScale }), [settings, timeScale]);

  useEffect(() => {
    if (!ready || !canvasRef.current) return;
    let scene: FlowScene;
    try {
      scene = new FlowScene(canvasRef.current, eff);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      queueMicrotask(() => setError(`3-D view unavailable: ${msg}`));
      return;
    }
    sceneRef.current = scene;
    scene.onGust = setGust;
    scene.onFrame = setFps;
    scene.onContour = setContour;
    const surf = new Worker(new URL('../../flow3d/surface.worker.ts', import.meta.url), {
      type: 'module',
    });
    surf.onmessage = (ev: MessageEvent<SurfaceWorkerOut>) => {
      const m = ev.data;
      if (m.kind === 'frame') {
        scene.setSurface(m.grid, m.eta);
        setStepMs(m.stepMs);
      }
    };
    surfRef.current = surf;
    const lines = new Worker(new URL('../../flow3d/surface.worker.ts', import.meta.url), {
      type: 'module',
    });
    lines.postMessage({ kind: 'clock', playing: false, timeScale: 1 } satisfies SurfaceWorkerIn);
    lineRef.current = lines;
    const ro = new ResizeObserver(() => {
      const el = stageRef.current;
      if (el) scene.resize(el.clientWidth, el.clientHeight);
    });
    if (stageRef.current) ro.observe(stageRef.current);
    const io = new IntersectionObserver((es) => scene.setVisible(es.some((e) => e.isIntersecting)));
    if (stageRef.current) io.observe(stageRef.current);
    if (import.meta.env.DEV) (window as unknown as { __flow3d: FlowScene }).__flow3d = scene;
    return () => {
      ro.disconnect();
      io.disconnect();
      surf.terminate();
      lines.terminate();
      scene.dispose();
      sceneRef.current = null;
      surfRef.current = null;
      lineRef.current = null;
    };
    // the scene lives as long as the design can be shown; settings are pushed below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  useEffect(() => {
    sceneRef.current?.setFormat({
      span: (x) => show(x, u.b),
      chord: (x) => show(x, u.cr),
      depth: (x) => show(x, u.h),
      area: (x) => show(x, u.S),
      force: (x) => show(x, u.L),
    });
  }, [u, ready]);

  useEffect(() => {
    sceneRef.current?.applySettings(eff);
    surfRef.current?.postMessage({
      kind: 'clock',
      playing: eff.playing,
      timeScale: eff.timeScale,
    } satisfies SurfaceWorkerIn);
  }, [eff]);

  // ---------------- flow requests (one in flight, latest wins)
  const request = useMemo(() => {
    if (!ready || !main) return null;
    const foils: FlowFoilRequest[] = [
      { name: 'Main foil', slot: 1, planform, values: main, x0: 0, h: op.h },
    ];
    if (two && sec) {
      const h2 = (ok(sec.h) ? sec.h : designH) + (op.h - designH);
      foils.push({
        name: 'Secondary foil',
        slot: foil2.sameSection ? 1 : 2,
        planform: foil2.planform,
        values: sec,
        x0: op.x2,
        h: Math.max(0.02, h2),
      });
    }
    return { V: op.V, loadFactor: op.load, foils, nSpan: 16 };
  }, [ready, main, sec, two, planform, foil2.planform, foil2.sameSection, op, designH]);

  const inFlight = useRef(false);
  const queued = useRef<typeof request>(null);
  useEffect(() => {
    if (!request) return;
    const send = (r: NonNullable<typeof request>) => {
      inFlight.current = true;
      setBusy(true);
      requestFlow(r)
        .then((st) => {
          setFlow(st);
          setError(null);
        })
        .catch((e) => setError(e instanceof Error ? e.message : String(e)))
        .finally(() => {
          inFlight.current = false;
          const next = queued.current;
          queued.current = null;
          if (next) send(next);
          else setBusy(false);
        });
    };
    if (inFlight.current) queued.current = request;
    else send(request);
  }, [request]);

  // push new flow to the scene and the surface worker
  useEffect(() => {
    const scene = sceneRef.current;
    if (!flow || !scene) return;
    scene.setFlow(flow);
    const mainF = flow.foils[0];
    const strut = strutSize(mainF);
    surfRef.current?.postMessage({
      kind: 'params',
      lref: flow.lref,
      params: {
        U: flow.V,
        depth: Infinity,
        strut: settings.showCraft
          ? { x: mainF.x0 + (0.42 - 0.25) * strut.chord, depth: -mainF.z0, area: strut.area }
          : null,
        foils: flow.foils.map((f) => {
          const n = flow.nStation;
          const y = Array.from({ length: n }, (_, j) => ((j / (n - 1)) * f.b) / 2);
          const c = Array.from({ length: n }, (_, j) => f.st[4 * j]);
          return {
            x0: f.x0,
            h: -f.z0,
            y,
            gamma: Array.from(f.stGamma),
            area: c.map((cc) => f.area1 * cc * cc),
            xArea: c.map((cc) => f.xCentroid * cc),
          };
        }),
      },
    } satisfies SurfaceWorkerIn);
  }, [flow, settings.showCraft]);

  // ambient sea
  const hasFlow = flow !== null;
  useEffect(() => {
    sceneRef.current?.setSea(seaComponents(sea.Hs, sea.Tp, sea.dir));
  }, [sea, hasFlow]);

  // streamlines
  const lineId = useRef(0);
  useEffect(() => {
    const w = lineRef.current;
    const scene = sceneRef.current;
    if (!scene || !w) return;
    if (!settings.streamlines || !flow) {
      scene.setStreamlines(null);
      return;
    }
    const id = ++lineId.current;
    const seeds = streamlineSeeds(flow, settings.seed, settings.sliceY);
    const xEnd = Math.max(...flow.foils.map((f) => f.x0)) + 2.4 * flow.lref;
    w.onmessage = (ev: MessageEvent<SurfaceWorkerOut>) => {
      const m = ev.data;
      if (m.kind === 'streamlines' && m.id === lineId.current) scene.setStreamlines(m.lines);
    };
    w.postMessage({ kind: 'streamlines', id, state: flow, seeds, xEnd } satisfies SurfaceWorkerIn);
  }, [flow, settings.streamlines, settings.seed, settings.sliceY]);

  if (!ready)
    return (
      <div className="empty">
        The 3-D view appears once the foil is sized and its load is known (span, root chord and
        lift), and a section profile is loaded.
      </div>
    );

  const f1 = flow?.foils[0];
  const crossing = f1 ? (flow!.lref / flow!.V).toFixed(2) : '—';
  const status = flowStatus(flow, gust, settings.foilColour);
  const lam = kelvinWavelength(op.V);
  // with two foils the section view can look at either one
  const cameraChips = CAMERAS.flatMap((c) =>
    c.id === 'section' && (flow?.foils.length ?? 0) > 1
      ? [
          { ...c, key: 'section-0', foil: 0, label: 'Main section' },
          { ...c, key: 'section-1', foil: 1, label: 'Secondary section' },
        ]
      : [{ ...c, key: c.id, foil: 0 }],
  );
  const FrH = op.V / Math.sqrt(G * op.h);
  return (
    <div className={`f3${full ? ' f3-full' : ''}`}>
      <div className="f3-stage" ref={stageRef}>
        <canvas ref={canvasRef} className="f3-canvas" />
        {error && <div className="f3-error">{error}</div>}
        <div className="f3-cams" role="group" aria-label="Camera">
          <Help label="Moving the view">
            <p>
              Drag to turn the view, right-drag to move it, and scroll or pinch to zoom. The buttons
              jump to ready-made views.
            </p>
            <p>
              Colours on the foil and the water: blue where the pressure is low (suction), red where
              it is high.
            </p>
            <p>
              Messages along the bottom warn about stall (not enough lift), cavitation (bubbles) and
              ventilation (air from the surface reaching the foil).
            </p>
          </Help>
          {cameraChips.map((c) => (
            <button
              key={c.key}
              className="f3-chip"
              onClick={() => {
                sceneRef.current?.preset(c.id, false, c.foil);
                // the foil's own waves are centimetres high: show them as heights and contours from above
                if (c.id === 'wake')
                  set({ surface: true, surfaceStyle: 'elevation', contours: true });
              }}
            >
              {c.label}
            </button>
          ))}
          <button
            className="f3-chip"
            onClick={() => set({ showHud: !settings.showHud })}
            aria-pressed={settings.showHud}
          >
            Readouts
          </button>
          <button
            className="f3-chip"
            onClick={() => set({ dimensions: !settings.dimensions })}
            aria-pressed={settings.dimensions}
            title="Show span, chords, area, depth and angle of attack"
          >
            Dimensions
          </button>
          <button
            className="f3-chip"
            onClick={() => set({ forces: !settings.forces })}
            aria-pressed={settings.forces}
            title="Show lift and drag arrows"
          >
            Forces
          </button>
          <button className="f3-chip" onClick={() => setFull((x) => !x)} aria-pressed={full}>
            {full ? 'Exit full screen' : 'Full screen'}
          </button>
        </div>
        {flow && settings.showHud && (
          <div className="f3-hud" aria-live="polite">
            {flow.foils.map((f) => (
              <div key={f.name} className="f3-hud-col">
                {flow.foils.length > 1 && <div className="f3-hud-title">{f.name}</div>}
                <div>
                  <span>α to flow</span>
                  <b>{deg(f.op.alpha, 2)}</b>
                </div>
                {Math.abs(f.op.otherAngle) > 1e-4 && (
                  <div title="Angle induced here by the other foil; the foil is trimmed by it so it meets its design angle">
                    <span>{f.op.otherAngle < 0 ? 'downwash' : 'upwash'}</span>
                    <b>{deg(Math.abs(f.op.otherAngle), 2)}</b>
                  </div>
                )}
                <div>
                  <span>C_L</span>
                  <b>{f.op.CL.toFixed(3)}</b>
                </div>
                <div>
                  <span>lift</span>
                  <b className={f.op.stalled ? 'bad' : ''}>
                    {show(f.op.L, u.L)}
                    {f.op.stalled && ` of ${show(f.op.Lreq, u.L)}`}
                  </b>
                </div>
                <div>
                  <span>drag</span>
                  <b>{show(f.op.D, u.D)}</b>
                </div>
                <div>
                  <span>L/D</span>
                  <b>{f.op.LD.toFixed(1)}</b>
                </div>
                <div>
                  <span>power</span>
                  <b>{show(f.op.P, u.P)}</b>
                </div>
                <div>
                  <span>stall margin</span>
                  <b
                    className={
                      f.op.stallMargin < 0
                        ? 'bad'
                        : f.op.stallMargin < (2 * Math.PI) / 180
                          ? 'warn'
                          : ''
                    }
                  >
                    {deg(f.op.stallMargin)}
                  </b>
                </div>
                <div>
                  <span>σ + C_p,min</span>
                  <b className={f.op.cavMargin < 0 ? 'bad' : f.op.cavMargin < 0.1 ? 'warn' : ''}>
                    {f.op.cavMargin.toFixed(2)}
                  </b>
                </div>
                <div>
                  <span>free-surface k</span>
                  <b>{f.op.kFS.toFixed(3)}</b>
                </div>
                <div>
                  <span>Re</span>
                  <b>{f.op.Re.toExponential(2)}</b>
                </div>
              </div>
            ))}
            <div className="f3-hud-foot">
              <Help label="Live numbers">
                <ul className="help-list">
                  <li>
                    <b>α to flow</b>: how much the foil is tilted compared with the water flowing at
                    it.
                  </li>
                  <li>
                    <b>downwash / upwash</b>: how much the other foil bends the flow here.
                  </li>
                  <li>
                    <b>C_L</b>: how hard the foil is working to make lift.
                  </li>
                  <li>
                    <b>lift, drag, power</b>: the forces on the foil and the power to push it.{' '}
                    <b>L/D</b> is lift ÷ drag; higher is better.
                  </li>
                  <li>
                    <b>stall margin</b>: degrees of tilt left before the foil stalls. Yellow means
                    little is left; red means it has stalled.
                  </li>
                  <li>
                    <b>σ + C_p,min</b>: the cavitation margin. Below zero (red), bubbles are
                    expected on the foil.
                  </li>
                  <li>
                    <b>free-surface k</b>: lift left because the surface is close (1 means no loss).
                  </li>
                  <li>
                    <b>Re</b>: the Reynolds number, which describes how the water flows over the
                    foil.
                  </li>
                  <li>
                    <b>Fr_h</b>: speed compared with depth; it decides what kind of surface waves
                    the foil makes. <b>Kelvin wave</b>: the length of those waves.
                  </li>
                  <li>
                    <b>waves</b>: how far the lift and tilt swing up and down in the sea waves.
                  </li>
                </ul>
              </Help>
              Fr<sub>h</sub> {FrH.toFixed(2)} · Kelvin wave {show(lam, u.b, 3)}
              {gust && sea.Hs > 0 && flow.foils.length > 0 && (
                <>
                  {' '}
                  · waves: lift ±{(100 * gust.liftSwing).toFixed(0)} %, α ±{deg(gust.alphaSwing)}
                </>
              )}
            </div>
          </div>
        )}
        {status.length > 0 && (
          <div className="f3-status">
            {status.map((s) => (
              <span key={s.text} className={`f3-pill ${s.level}`}>
                {s.text}
              </span>
            ))}
          </div>
        )}
        <div className="f3-legend" aria-hidden>
          <span>suction</span>
          <i className="f3-ramp" />
          <span>pressure</span>
          <span className="f3-legend-note">C_p −1.2 … +1</span>
        </div>
        <div className="f3-meta">
          {busy ? 'updating…' : `${fps.toFixed(0)} fps`} · surface step {stepMs.toFixed(0)} ms ·
          time ×{fmt(timeScale, 2)}
        </div>
      </div>

      <div className="f3-controls">
        <fieldset>
          <legend>
            Operating point
            <Help label="Operating point">
              Try your foil in other conditions. These sliders only change this view, not your
              design. Back to design point puts them back.
            </Help>
          </legend>
          <Slider
            label="Speed"
            value={op.V}
            min={Math.max(0.2, vLo)}
            max={vHi}
            onChange={(V) => setOp((o) => ({ ...o, V }))}
            display={show(op.V, u.V)}
            reset={designV}
            help="How fast the water flows past the foil. The foil holds the same weight at every speed, so it tilts more when slow and less when fast. Cruise, Take-off and Cavitation jump to those speeds."
          />
          <div className="row f3-snap">
            {ok(main!.V) && (
              <button className="btn" onClick={() => setOp((o) => ({ ...o, V: main!.V }))}>
                Cruise
              </button>
            )}
            {ok(main!.Vto) && (
              <button
                className="btn"
                onClick={() =>
                  setOp((o) => ({
                    ...o,
                    V: 1.01 * (two && ok(v!.VtoCraft) ? v!.VtoCraft : main!.Vto),
                  }))
                }
              >
                Take-off
              </button>
            )}
            {vCav !== undefined && (
              <button className="btn" onClick={() => setOp((o) => ({ ...o, V: 1.02 * vCav }))}>
                Cavitation
              </button>
            )}
          </div>
          <Slider
            label="Load"
            value={op.load}
            min={0.4}
            max={2}
            onChange={(load) => setOp((o) => ({ ...o, load }))}
            reset={1}
            display={
              ok(v!.m)
                ? `${show(v!.m * op.load, u.m)} (×${op.load.toFixed(2)})`
                : `×${op.load.toFixed(2)}`
            }
            help="How much weight the foil carries, as a multiple of your design weight. Try more than 1 for a heavier rider, or for the extra load in a hard turn."
          />
          <Slider
            label={two ? 'Ride depth (main foil)' : 'Foil depth'}
            value={op.h}
            min={0.03}
            max={Math.max(2 * designH, 1.5 * main!.b, 0.5)}
            onChange={(h) => setOp((o) => ({ ...o, h }))}
            display={show(op.h, u.h)}
            reset={designH}
            help="How deep the foil is under the calm water surface. Close to the surface it loses some lift and can suck down air."
          />
          {two && (
            <Slider
              label="Secondary foil position"
              value={op.x2}
              min={-2 * main!.b}
              max={2 * main!.b}
              onChange={(x2) => setOp((o) => ({ ...o, x2 }))}
              reset={0.8 * main!.b}
              display={`${show(Math.abs(op.x2), u.b)} ${op.x2 >= 0 ? 'behind' : 'ahead'}`}
              help="The distance between the two foils (the length of the bar that joins them). It is not part of the design, but it changes how the water coming off the front foil meets the back one."
            />
          )}
          <button
            className="btn ghost"
            onClick={() => setOp({ V: designV, load: 1, h: designH, x2: 0.8 * main!.b })}
          >
            Back to design point
          </button>
        </fieldset>

        <fieldset>
          <legend>
            Water
            <Help label="Water">Add sea waves and change how the water surface is drawn.</Help>
          </legend>
          <Slider
            label="Sea: wave height H_s"
            value={sea.Hs}
            min={0}
            max={Math.max(1.5, 3 * designH)}
            onChange={(Hs) =>
              setSea((s) => ({ ...s, Hs: Hs < 0.01 ? 0 : Hs, Tp: defaultPeakPeriod(Hs) }))
            }
            display={sea.Hs > 0 ? show(sea.Hs, u.h) : 'calm'}
            reset={0}
            help="How big the sea waves are, as a sailor would judge it. Zero is flat calm. Waves make the lift on the foil rise and fall."
          />
          {sea.Hs > 0 && (
            <>
              <Slider
                label="Wave period T_p"
                value={sea.Tp}
                min={1}
                max={14}
                onChange={(Tp) => setSea((s) => ({ ...s, Tp }))}
                display={`${sea.Tp.toFixed(1)} s`}
                reset={defaultPeakPeriod(sea.Hs)}
                help="Time between one wave crest and the next. Longer times mean longer, smoother waves."
              />
              <Slider
                label="Waves from"
                value={sea.dir}
                min={0}
                max={180}
                onChange={(dir) => setSea((s) => ({ ...s, dir }))}
                reset={0}
                help="Which way the waves come from, compared with the way you are going."
                display={
                  sea.dir < 22
                    ? 'ahead'
                    : sea.dir < 67
                      ? 'bow quarter'
                      : sea.dir < 113
                        ? 'the side'
                        : sea.dir < 158
                          ? 'stern quarter'
                          : 'behind'
                }
              />
            </>
          )}
          <Slider
            label="Wake height ×"
            value={settings.exaggeration}
            min={1}
            max={50}
            log
            onChange={(x) => set({ exaggeration: x < 1.05 ? 1 : x })}
            reset={DEFAULT_SETTINGS.exaggeration}
            display={
              settings.exaggeration === 1 ? 'true scale' : `×${settings.exaggeration.toFixed(1)}`
            }
            help="The waves your foil makes are only millimetres to centimetres high. This draws them taller so you can see them. Sea waves are always drawn at true size."
          />
          <div className="row">
            <Toggle
              label="Surface"
              checked={settings.surface}
              onChange={(x) => set({ surface: x })}
              reset={DEFAULT_SETTINGS.surface}
              help="Show or hide the water surface."
            />
            <Toggle
              label="Contours"
              checked={settings.contours}
              onChange={(x) => set({ contours: x })}
              reset={DEFAULT_SETTINGS.contours}
              help="Lines joining points of equal height on the waves your foil makes, like the lines on a hiking map."
            />
            <Select
              label="Colour"
              value={settings.surfaceStyle}
              options={[
                { id: 'realistic', label: 'Water' },
                { id: 'elevation', label: 'Height' },
              ]}
              onChange={(x) => set({ surfaceStyle: x })}
              reset={DEFAULT_SETTINGS.surfaceStyle}
              help="Water: looks like real water. Height: coloured by how high or low the surface is, which makes the foil's waves easier to see."
            />
          </div>
          {settings.contours && contour > 0 && (
            <p className="small muted f3-note">
              Contour spacing {show(contour, u.h, 2)} (true scale).
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend>
            Flow
            <Help label="Flow">Show how the water moves around the foil.</Help>
          </legend>
          <div className="row">
            <Toggle
              label="Particles"
              checked={settings.particles}
              onChange={(x) => set({ particles: x })}
              reset={DEFAULT_SETTINGS.particles}
              help="Small moving dots carried along by the water."
            />
            <Toggle
              label="Streamlines"
              checked={settings.streamlines}
              onChange={(x) => set({ streamlines: x })}
              reset={DEFAULT_SETTINGS.streamlines}
              help="Lines that trace the path the water takes past the foil."
            />
          </div>
          <Select
            label="Release"
            value={settings.seed}
            options={SEEDS}
            onChange={(x) => set({ seed: x })}
            reset={DEFAULT_SETTINGS.seed}
            help="Where the dots and lines start from: all around the foil, from one slice of it, at the tips (to see the swirls that form there), or near the surface."
          />
          {settings.seed === 'slice' && (
            <>
              <Slider
                label="Section position"
                value={settings.sliceY}
                min={0}
                max={0.98}
                onChange={(x) => set({ sliceY: x })}
                reset={DEFAULT_SETTINGS.sliceY}
                display={`${(100 * settings.sliceY).toFixed(0)} % of semi-span`}
                help="Where along the foil the slice is, from the middle (0 %) out to the tip (100 %)."
              />
              <Toggle
                label="Cut away the near side"
                checked={settings.cutaway}
                onChange={(x) => set({ cutaway: x })}
                reset={DEFAULT_SETTINGS.cutaway}
                help="Hide the part of the foil nearest to you so you can see the water flowing over the slice."
              />
            </>
          )}
          <div className="row">
            <Select
              label="Colour by"
              value={settings.colourBy}
              options={[
                { id: 'pressure', label: 'Pressure C_p' },
                { id: 'speed', label: 'Speed' },
                { id: 'white', label: 'Plain' },
              ]}
              onChange={(x) => set({ colourBy: x })}
              reset={DEFAULT_SETTINGS.colourBy}
              help="Pressure: blue where the water pressure is low (suction), red where it is high. Speed: how fast the water is moving. Plain: one colour."
            />
            <Select
              label="Count"
              value={settings.particleCount}
              options={[4000, 8000, 12000, 20000, 32000].map((n) => ({
                id: n,
                label: `${n / 1000}k`,
              }))}
              onChange={(x) => set({ particleCount: x })}
              reset={DEFAULT_SETTINGS.particleCount}
              help="How many dots to draw. Fewer dots run more smoothly on slower computers."
            />
          </div>
          <Slider
            label="Streak length"
            value={settings.streak}
            min={0.2}
            max={6}
            log
            onChange={(x) => set({ streak: x })}
            reset={DEFAULT_SETTINGS.streak}
            display={`×${settings.streak.toFixed(1)}`}
            help="How long a trail each dot leaves behind it."
          />
        </fieldset>

        <fieldset>
          <legend>
            Display
            <Help label="Display">What else to show, and how fast the animation runs.</Help>
          </legend>
          <div className="row">
            <button
              className="btn"
              onClick={() => set({ playing: !settings.playing })}
              aria-pressed={!settings.playing}
            >
              {settings.playing ? 'Pause' : 'Play'}
            </button>
            <Toggle
              label="Strut & board"
              checked={settings.showCraft}
              onChange={(x) => set({ showCraft: x })}
              reset={DEFAULT_SETTINGS.showCraft}
              help="A typical mast and board, so you can judge the size. They are not part of the design. While shown, the waves the mast makes are included."
            />
            <Toggle
              label="Person"
              checked={settings.showPerson}
              onChange={(x) => set({ showPerson: x })}
              reset={DEFAULT_SETTINGS.showPerson}
              help="A 1.75 m (5 ft 9 in) person standing on the board, so you can judge the size."
            />
          </div>
          <div className="row">
            <Toggle
              label="Dimensions"
              checked={settings.dimensions}
              onChange={(x) => set({ dimensions: x })}
              reset={DEFAULT_SETTINGS.dimensions}
              help="Labels each foil's width, front-to-back lengths, area, aspect ratio, depth and tilt."
            />
            <Toggle
              label="Forces"
              checked={settings.forces}
              onChange={(x) => set({ forces: x })}
              reset={DEFAULT_SETTINGS.forces}
              help={`Arrows along the foil: green for lift, orange for drag. Drag arrows are drawn ${DRAG_MAGNIFY} times longer than lift arrows of the same force, so they are easy to see.`}
            />
          </div>
          <Slider
            label="Time"
            value={timeScale}
            min={0.01}
            max={1}
            log
            onChange={(x) => set({ timeScale: near(x, autoTimeScale) ? 0 : x })}
            reset={autoTimeScale}
            display={`${fmt(timeScale, 2)} × real time`}
            help={`Slows the animation down. At 1 it runs at real speed, and the water takes ${crossing} s to pass the foil.`}
          />
          <Select
            label="Foil colour"
            value={settings.foilColour}
            options={[
              { id: 'pressure', label: 'Surface pressure C_p' },
              { id: 'cavitation', label: 'Cavitation risk' },
              { id: 'plain', label: 'Plain' },
            ]}
            onChange={(x) => set({ foilColour: x })}
            reset={DEFAULT_SETTINGS.foilColour}
            help="Surface pressure: blue where the water pulls on the foil (low pressure), red where it pushes (high pressure). Cavitation risk: grey is safe, amber is close, magenta is where bubbles are expected. Plain: one colour."
          />
        </fieldset>
        <p className="small muted f3-note">
          This shows how the water flows around the foil as designed. It leaves out friction effects
          such as the swirling wake behind the foil; stall and cavitation are flagged from the
          design checks instead.
          <Help label="How the view is calculated">
            Flow: potential flow of the foil as designed — the section's vortex-panel solution near
            the foil, the lifting-line bound and trailing vortices (rolling up into the tip
            vortices) further away, and their mirror image in the surface. Surface: linearised
            free-surface waves simulated in time. Viscous effects (boundary layer, separation, wake
            turbulence) are not shown; stall and cavitation are flagged from the design checks.
          </Help>
        </p>
      </div>
    </div>
  );
}

function flowStatus(
  flow: FlowState | null,
  gust: GustReadout | null,
  foilColour: ViewSettings['foilColour'],
) {
  const out: { text: string; level: 'ok' | 'warn' | 'bad' }[] = [];
  if (!flow) return out;
  for (const f of flow.foils) {
    const who = flow.foils.length > 1 ? `${f.name}: ` : '';
    if (f.op.stalled)
      out.push({
        level: 'bad',
        text: `${who}below take-off speed — stalled, carries ${((100 * f.op.L) / f.op.Lreq).toFixed(0)} % of its load`,
      });
    if (f.op.cavMargin < 0)
      out.push({
        level: 'bad',
        text: `${who}cavitation predicted ${foilColour === 'cavitation' ? '(magenta on the foil)' : '— Foil colour: Cavitation risk shows where'}`,
      });
    if (f.op.hc < 0.5)
      out.push({ level: 'warn', text: `${who}very close to the surface — ventilation risk` });
  }
  if (gust && gust.minDepth < 0.5 * flow.foils[0].mac)
    out.push({ level: 'warn', text: 'wave troughs reach the foil — ventilation/breaching risk' });
  if (!out.length)
    out.push({ level: 'ok', text: 'flying: lift = load, no stall or cavitation predicted' });
  return out;
}

/** Streamline seeds (x y z triplets) for the release mode. */
function streamlineSeeds(flow: FlowState, mode: SeedMode, sliceY: number): number[] {
  const main = flow.foils[0];
  const x = Math.min(...flow.foils.map((f) => f.x0)) - 0.6 * flow.lref;
  const out: number[] = [];
  const h = -main.z0;
  if (mode === 'slice') {
    const y = (sliceY * main.b) / 2;
    for (let i = 0; i < 28; i++) {
      const z = main.z0 + (i / 27 - 0.5) * 2 * Math.min(1.2 * main.cr, 0.9 * h);
      out.push(x, y, Math.min(z, -0.01 * h));
    }
  } else if (mode === 'tips') {
    for (const s of [1, -1])
      for (let i = 0; i < 12; i++) {
        const a = (2 * Math.PI * i) / 12;
        out.push(
          x,
          s * (main.b / 2 + 0.25 * main.cr * Math.cos(a)),
          main.z0 + 0.25 * main.cr * Math.sin(a),
        );
      }
  } else if (mode === 'surface') {
    for (let i = 0; i < 24; i++) out.push(x, (i / 23 - 0.5) * 1.4 * flow.lref, -0.15 * h);
  } else {
    for (let i = 0; i < 7; i++)
      for (let j = 0; j < 5; j++) {
        const z = main.z0 + (j / 4 - 0.5) * Math.min(0.6 * flow.lref, 1.6 * h);
        out.push(x, (i / 6 - 0.5) * 1.3 * main.b, Math.min(z, -0.02 * h));
      }
  }
  return out;
}
