import { fmtQ, type Quantity } from '../../physics/units';

interface Props {
  outline: { y: number; xLE: number; xTE: number }[];
  span: number;
  rootChord: number;
  tipChord: number | null;
  unitId?: string;
  quantity?: Quantity;
  /** draw at the scale of this span, so foils of different sizes compare */
  refSpan?: number;
  /** name of the foil in the accessible label */
  name?: string;
}

/** Top view of the full foil with span and chord dimensions. Flow comes from the top of the drawing. */
export function PlanformView({
  outline,
  span,
  rootChord,
  tipChord,
  unitId,
  quantity = 'length',
  refSpan,
  name = 'Planform',
}: Props) {
  const W = 640;
  const pad = 44;
  const scale = (W - 2 * pad) / Math.max(span, refSpan ?? 0);
  const maxX = Math.max(...outline.map((p) => p.xTE));
  const minX = Math.min(...outline.map((p) => p.xLE));
  const H = Math.max(140, (maxX - minX) * scale + 2 * pad + 10);
  const cx = W / 2;
  const X = (y: number) => cx + y * scale;
  const Y = (x: number) => pad + (x - minX) * scale;
  const right = outline.map((p) => `${X(p.y)},${Y(p.xLE)}`);
  const rightTE = [...outline].reverse().map((p) => `${X(p.y)},${Y(p.xTE)}`);
  const leftTE = outline.map((p) => `${X(-p.y)},${Y(p.xTE)}`);
  const leftLE = [...outline].reverse().map((p) => `${X(-p.y)},${Y(p.xLE)}`);
  const d = `M${[...right, ...rightTE, ...leftTE, ...leftLE].join('L')}Z`;
  const f = (v: number) => fmtQ(v, quantity, unitId, 3);
  const root = outline[0];
  const tip = outline[outline.length - 1];
  // a foil drawn smaller than the frame gets its tip label beside the tip
  const tipX = X(span / 2);
  const besideTip = W - tipX > 150;
  return (
    <svg
      className="planform-svg"
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      role="img"
      aria-label={`${name}: span ${f(span)}, root chord ${f(rootChord)}`}
    >
      <path
        d={d}
        fill="var(--accent-wash)"
        stroke="var(--series-1)"
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {/* quarter-chord line */}
      <line
        x1={X(-span / 2)}
        x2={X(span / 2)}
        y1={Y(0.25 * rootChord)}
        y2={Y(0.25 * rootChord)}
        stroke="var(--muted)"
        strokeWidth={1}
        opacity={0.6}
      />
      {/* span dimension */}
      <g stroke="var(--ink-2)" strokeWidth={1}>
        <line x1={X(-span / 2)} x2={X(span / 2)} y1={pad - 18} y2={pad - 18} />
        <line x1={X(-span / 2)} x2={X(-span / 2)} y1={pad - 24} y2={pad - 12} />
        <line x1={X(span / 2)} x2={X(span / 2)} y1={pad - 24} y2={pad - 12} />
        {/* root chord */}
        <line x1={cx} x2={cx} y1={Y(root.xLE)} y2={Y(root.xTE)} strokeDasharray="0" />
      </g>
      <text x={cx} y={pad - 24} textAnchor="middle">
        span {f(span)}
      </text>
      <text x={cx + 6} y={Y(root.xTE) + 16}>
        root chord {f(rootChord)}
      </text>
      {tipChord !== null && tipChord > 1e-6 && (
        <text
          x={besideTip ? tipX + 6 : tipX}
          y={besideTip ? Y(tip.xTE) : Y(tip.xTE) + 16}
          textAnchor={besideTip ? 'start' : 'end'}
        >
          tip {f(tipChord)}
        </text>
      )}
      <text x={pad - 30} y={Y(0.25 * rootChord) + 4} style={{ fill: 'var(--muted)' }}>
        ¼c
      </text>
      <text x={W - pad + 4} y={pad - 18 + 4} style={{ fill: 'var(--muted)' }}>
        ↓ flow
      </text>
    </svg>
  );
}
