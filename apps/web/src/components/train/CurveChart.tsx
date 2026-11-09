import { formatScore } from '../../runs/metrics';
import type { CurveKind, CurvePoint } from '../../training/events';

const W = 520;
const H = 190;
const PAD = { l: 44, r: 12, t: 12, b: 26 };

interface Series {
  name: string;
  points: { x: number; y: number }[];
  className: string;
}

/** A line chart for one or more curves. Small on purpose: SVG is plenty for a few thousand points. */
export function LineChart({
  series,
  total,
  label,
  yLabel,
}: {
  series: Series[];
  total: number | null;
  label: string;
  yLabel: string;
}) {
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) {
    return (
      <div className="chart empty" role="img" aria-label={`${label}: nothing yet`}>
        <span className="muted">Waiting for the first {yLabel.toLowerCase()}…</span>
      </div>
    );
  }
  const xs = all.map((p) => p.x);
  const ys = all.map((p) => p.y);
  const xMax = Math.max(total ?? 0, ...xs, 1);
  let yMin = Math.min(...ys);
  let yMax = Math.max(...ys);
  if (yMin === yMax) {
    yMin -= 0.5;
    yMax += 0.5;
  }
  const pad = (yMax - yMin) * 0.06;
  yMin -= pad;
  yMax += pad;
  const sx = (x: number): number => PAD.l + (x / xMax) * (W - PAD.l - PAD.r);
  const sy = (y: number): number => PAD.t + (1 - (y - yMin) / (yMax - yMin)) * (H - PAD.t - PAD.b);
  const ticks = [yMin + pad, (yMin + yMax) / 2, yMax - pad];
  const summary = series
    .filter((s) => s.points.length > 0)
    .map((s) => `${s.name} ${formatScore(s.points[s.points.length - 1]?.y)}`)
    .join(', ');

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${label}. Latest: ${summary}.`}
        preserveAspectRatio="xMidYMid meet"
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} className="grid" />
            <text x={PAD.l - 6} y={sy(t) + 4} textAnchor="end" className="axis">
              {formatScore(t)}
            </text>
          </g>
        ))}
        <text x={PAD.l} y={H - 6} className="axis">
          1
        </text>
        <text x={W - PAD.r} y={H - 6} textAnchor="end" className="axis">
          {xMax}
        </text>
        {series.map((s) => (
          <polyline
            key={s.name}
            className={`line ${s.className}`}
            fill="none"
            points={s.points.map((p) => `${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(' ')}
          />
        ))}
      </svg>
      <figcaption>
        {series.map((s) => (
          <span key={s.name} className={`legend ${s.className}`}>
            {s.name}
          </span>
        ))}
        <span className="muted small">{label}</span>
      </figcaption>
    </figure>
  );
}

const finite = (v: number | null): v is number => v !== null && Number.isFinite(v);

/** The curve of a run: training and validation, lower or higher being better depending on `kind`. */
export function CurveChart({
  curve,
  total,
  kind,
  label,
}: {
  curve: CurvePoint[];
  total: number | null;
  kind: CurveKind | null;
  label: string;
}) {
  const train = curve.filter((p) => finite(p.train)).map((p) => ({ x: p.x, y: p.train as number }));
  const val = curve.filter((p) => finite(p.val)).map((p) => ({ x: p.x, y: p.val as number }));
  return (
    <LineChart
      series={[
        {
          name: kind === 'score' ? 'Training score' : 'Training',
          points: train,
          className: 'train',
        },
        {
          name: kind === 'score' ? 'Validation score' : 'Validation',
          points: val,
          className: 'val',
        },
      ]}
      total={total}
      label={label || 'Progress'}
      yLabel={kind === 'score' ? 'score' : 'loss'}
    />
  );
}
