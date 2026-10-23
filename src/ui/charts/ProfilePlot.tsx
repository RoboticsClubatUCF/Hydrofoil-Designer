import type { Pt } from '../../physics/profile/parse';

interface Props {
  upper: Pt[];
  lower: Pt[];
  camber?: Pt[];
  raw?: Pt[];
  tMax?: { x: number; yU: number; yL: number };
  label?: string;
}

/** Section outline at true aspect ratio (chord = 1). */
export function ProfilePlot({ upper, lower, camber, raw, tMax, label }: Props) {
  let yMin = 0,
    yMax = 0;
  for (const p of [...upper, ...lower]) {
    yMin = Math.min(yMin, p.y);
    yMax = Math.max(yMax, p.y);
  }
  const padY = 0.04;
  const W = 1000;
  const sx = (x: number) => 30 + x * (W - 60);
  const scale = (W - 60) / 1;
  const H = Math.max(120, (yMax - yMin + 2 * padY) * scale);
  const sy = (y: number) => (yMax + padY - y) * scale;
  const path = (pts: Pt[]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
  const outline = path([...upper].reverse().concat(lower.slice(1))) + 'Z';
  return (
    <svg
      className="profile-plot"
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label ?? 'Section profile'}
    >
      <line x1={sx(0)} x2={sx(1)} y1={sy(0)} y2={sy(0)} stroke="var(--hairline)" strokeWidth={2} />
      <path
        d={outline}
        fill="var(--accent-wash)"
        stroke="var(--series-1)"
        strokeWidth={3}
        strokeLinejoin="round"
      />
      {camber && <path d={path(camber)} fill="none" stroke="var(--muted)" strokeWidth={2} />}
      {tMax && (
        <line
          x1={sx(tMax.x)}
          x2={sx(tMax.x)}
          y1={sy(tMax.yU)}
          y2={sy(tMax.yL)}
          stroke="var(--series-2)"
          strokeWidth={2.5}
        />
      )}
      {raw?.map((p, i) => (
        <circle key={i} cx={sx(p.x)} cy={sy(p.y)} r={4} fill="var(--ink-2)" opacity={0.55} />
      ))}
    </svg>
  );
}
