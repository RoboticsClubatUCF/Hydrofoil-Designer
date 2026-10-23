import { scaleLinear } from 'd3-scale';
import { line } from 'd3-shape';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { fmt } from '../../physics/units';
import { Help } from '../components/Help';

export interface Series {
  id: string;
  label: string;
  x: number[];
  y: number[];
  color: string;
}

export interface RefLine {
  x?: number;
  y?: number;
  label: string;
}

export interface Point {
  x: number;
  y: number;
  label: string;
}

interface Props {
  title: string;
  subtitle?: string;
  xLabel: string;
  yLabel: string;
  series: Series[];
  refLines?: RefLine[];
  points?: Point[];
  height?: number;
  invertY?: boolean;
  xFmt?: (v: number) => string;
  yFmt?: (v: number) => string;
  includeZero?: boolean;
  /** plain explanation shown by an info button next to the title */
  help?: string;
}

const M = { top: 10, right: 14, bottom: 32, left: 50 };

function nearestIndex(xs: number[], x: number): number {
  let lo = 0,
    hi = xs.length - 1;
  if (hi < 0) return -1;
  const asc = xs[hi] >= xs[0];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (asc ? xs[mid] <= x : xs[mid] >= x) lo = mid;
    else hi = mid;
  }
  return Math.abs(xs[lo] - x) <= Math.abs(xs[hi] - x) ? lo : hi;
}

export function LineChart({
  title,
  subtitle,
  xLabel,
  yLabel,
  series,
  refLines = [],
  points = [],
  height = 210,
  invertY = false,
  xFmt = (v) => fmt(v, 3),
  yFmt = (v) => fmt(v, 3),
  includeZero = false,
  help,
}: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(240, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const { xs, ys, paths } = useMemo(() => {
    let x0 = Infinity,
      x1 = -Infinity,
      y0 = Infinity,
      y1 = -Infinity;
    for (const s of series)
      s.x.forEach((xv, i) => {
        const yv = s.y[i];
        if (!Number.isFinite(xv) || !Number.isFinite(yv)) return;
        x0 = Math.min(x0, xv);
        x1 = Math.max(x1, xv);
        y0 = Math.min(y0, yv);
        y1 = Math.max(y1, yv);
      });
    for (const p of points) {
      if (Number.isFinite(p.y)) {
        y0 = Math.min(y0, p.y);
        y1 = Math.max(y1, p.y);
      }
    }
    for (const r of refLines) {
      if (r.y !== undefined && Number.isFinite(r.y)) {
        y0 = Math.min(y0, r.y);
        y1 = Math.max(y1, r.y);
      }
    }
    if (includeZero) {
      y0 = Math.min(y0, 0);
      y1 = Math.max(y1, 0);
    }
    if (!Number.isFinite(x0)) {
      x0 = 0;
      x1 = 1;
    }
    if (!Number.isFinite(y0)) {
      y0 = 0;
      y1 = 1;
    }
    if (y0 === y1) {
      y0 -= 1;
      y1 += 1;
    }
    const pad = (y1 - y0) * 0.06;
    const padLo = includeZero && y0 >= 0 ? 0 : pad;
    const padHi = includeZero && y1 <= 0 ? 0 : pad;
    const xs = scaleLinear()
      .domain([x0, x1])
      .range([M.left, width - M.right])
      .nice();
    const yRange: [number, number] = invertY
      ? [M.top, height - M.bottom]
      : [height - M.bottom, M.top];
    const ys = scaleLinear()
      .domain([y0 - padLo, y1 + padHi])
      .range(yRange)
      .nice();
    const gen = line<[number, number]>()
      .defined((d) => Number.isFinite(d[0]) && Number.isFinite(d[1]))
      .x((d) => xs(d[0]))
      .y((d) => ys(d[1]));
    const paths = series.map(
      (s) => gen(s.x.map((xv, i) => [xv, s.y[i]] as [number, number])) ?? '',
    );
    return { xs, ys, paths };
  }, [series, points, refLines, width, height, invertY, includeZero]);

  const base = series[0];
  const onMove = (e: PointerEvent<SVGRectElement>) => {
    if (!base) return;
    const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect();
    const xv = xs.invert(e.clientX - r.left);
    setHover(nearestIndex(base.x, xv));
  };
  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (!base) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const step = e.shiftKey ? 5 : 1;
      setHover((h) => {
        const cur = h ?? 0;
        return Math.min(
          base.x.length - 1,
          Math.max(0, cur + (e.key === 'ArrowRight' ? step : -step)),
        );
      });
    } else if (e.key === 'Escape') setHover(null);
  };

  const hx = hover !== null && base ? base.x[hover] : null;
  const rows =
    hx !== null
      ? series.map((s) => {
          const i = nearestIndex(s.x, hx);
          return { s, x: s.x[i], y: s.y[i] };
        })
      : [];
  const tipLeft = hx !== null ? Math.min(width - 150, xs(hx) + 12) : 0;
  const xTicks = xs.ticks(Math.max(3, Math.floor(width / 80)));
  const yTicks = ys.ticks(5);

  // table rows (downsampled)
  const tableRows = useMemo(() => {
    if (!base) return [];
    const stride = Math.max(1, Math.ceil(base.x.length / 40));
    return base.x.filter((_, i) => i % stride === 0 || i === base.x.length - 1).map((xv) => xv);
  }, [base]);

  return (
    <div className="chart" ref={wrap}>
      <h4>
        {title}
        {help && <Help label={title}>{help}</Help>}
      </h4>
      {subtitle && <div className="sub">{subtitle}</div>}
      {series.length > 1 && (
        <div className="legend">
          {series.map((s) => (
            <span key={s.id}>
              <span className="key" style={{ background: s.color }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${title}: ${yLabel} against ${xLabel}. Use left and right arrow keys to read values.`}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
      >
        <g className="grid">
          {yTicks.map((t) => (
            <line key={t} x1={M.left} x2={width - M.right} y1={ys(t)} y2={ys(t)} />
          ))}
        </g>
        <g className="axis">
          <line x1={M.left} x2={width - M.right} y1={height - M.bottom} y2={height - M.bottom} />
          {xTicks.map((t) => (
            <text key={t} x={xs(t)} y={height - M.bottom + 14} textAnchor="middle">
              {xFmt(t)}
            </text>
          ))}
          {yTicks.map((t) => (
            <text key={t} x={M.left - 6} y={ys(t) + 3.5} textAnchor="end">
              {yFmt(t)}
            </text>
          ))}
          <text x={(M.left + width - M.right) / 2} y={height - 3} textAnchor="middle">
            {xLabel}
          </text>
          <text
            transform={`translate(11 ${(M.top + height - M.bottom) / 2}) rotate(-90)`}
            textAnchor="middle"
          >
            {yLabel}
          </text>
        </g>
        <g className="ref">
          {refLines.map((r, i) =>
            r.y !== undefined && Number.isFinite(r.y) ? (
              <g key={i}>
                <line x1={M.left} x2={width - M.right} y1={ys(r.y)} y2={ys(r.y)} />
                <text x={width - M.right - 2} y={ys(r.y) - 4} textAnchor="end">
                  {r.label}
                </text>
              </g>
            ) : r.x !== undefined &&
              Number.isFinite(r.x) &&
              r.x >= xs.domain()[0] &&
              r.x <= xs.domain()[1] ? (
              <g key={i}>
                <line x1={xs(r.x)} x2={xs(r.x)} y1={M.top} y2={height - M.bottom} />
                <text x={xs(r.x) + 3} y={M.top + 9 + (i % 2) * 12}>
                  {r.label}
                </text>
              </g>
            ) : null,
          )}
        </g>
        {series.map((s, i) => (
          <path
            key={s.id}
            d={paths[i]}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ))}
        {points.map((p, i) =>
          Number.isFinite(p.x) && Number.isFinite(p.y) ? (
            <g key={i}>
              <circle
                cx={xs(p.x)}
                cy={ys(p.y)}
                r={5}
                fill="var(--ink)"
                stroke="var(--chart-surface)"
                strokeWidth={2}
              />
              <text x={xs(p.x) + 8} y={ys(p.y) - 6} style={{ fill: 'var(--ink-2)' }}>
                {p.label}
              </text>
            </g>
          ) : null,
        )}
        {hx !== null && (
          <g>
            <line className="crosshair" x1={xs(hx)} x2={xs(hx)} y1={M.top} y2={height - M.bottom} />
            {rows.map(({ s, x, y }) =>
              Number.isFinite(y) ? (
                <circle
                  key={s.id}
                  cx={xs(x)}
                  cy={ys(y)}
                  r={4.5}
                  fill={s.color}
                  stroke="var(--chart-surface)"
                  strokeWidth={2}
                />
              ) : null,
            )}
          </g>
        )}
        <rect
          x={M.left}
          y={M.top}
          width={Math.max(0, width - M.left - M.right)}
          height={Math.max(0, height - M.top - M.bottom)}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {hx !== null && (
        <div className="tooltip" style={{ left: tipLeft, top: 40 }}>
          <div className="tt-x">
            {xLabel}: {xFmt(hx)}
          </div>
          {rows.map(({ s, y }) => (
            <div className="tt-row" key={s.id}>
              <span
                className="key"
                style={{
                  display: 'inline-block',
                  width: 12,
                  height: 2,
                  background: s.color,
                  borderRadius: 2,
                }}
              />
              <strong>{Number.isFinite(y) ? yFmt(y) : '—'}</strong>
              <span>{series.length > 1 ? s.label : yLabel}</span>
            </div>
          ))}
        </div>
      )}
      <button
        className="table-toggle no-print"
        onClick={() => setShowTable((v) => !v)}
        aria-expanded={showTable}
      >
        {showTable ? 'Hide table' : 'Show table'}
      </button>
      {showTable && base && (
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>{xLabel}</th>
                {series.map((s) => (
                  <th key={s.id}>{series.length > 1 ? s.label : yLabel}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tableRows.map((xv) => (
                <tr key={xv}>
                  <td>{xFmt(xv)}</td>
                  {series.map((s) => {
                    const i = nearestIndex(s.x, xv);
                    return <td key={s.id}>{Number.isFinite(s.y[i]) ? yFmt(s.y[i]) : '—'}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
