import type { ReactElement } from 'react';
import type { Structure, WeightLayer } from '../../training/events';

const W = 520;
const H = 260;
const MAX_NODES = 10;

interface Column {
  label: string;
  /** Units this column stands for, and how many are drawn. */
  units: number;
  drawn: number;
}

const columnsOf = (s: Structure): Column[] => [
  { label: 'Inputs', units: s.inputUnits, drawn: Math.min(s.inputUnits, MAX_NODES) },
  ...s.layers.map((l, i) => ({
    label: `Layer ${i + 1}`,
    units: l.units,
    drawn: Math.min(l.units, MAX_NODES),
  })),
  { label: 'Output', units: s.outputUnits, drawn: Math.min(s.outputUnits, MAX_NODES) },
];

/**
 * The network as layers of units with a line for each connection. When weights have arrived, line
 * thickness shows how strong a connection is and its colour whether it pushes up or down. Layers
 * wider than the picture are drawn with fewer units, and the label says how many they stand for.
 */
export function NetworkView({
  structure,
  weights,
  epoch,
}: {
  structure: Structure;
  weights: WeightLayer[] | null;
  epoch: number | null;
}) {
  const cols = columnsOf(structure);
  const x = (c: number): number => 50 + (c * (W - 100)) / Math.max(1, cols.length - 1);
  const y = (col: Column, i: number): number => 34 + ((H - 68) * (i + 0.5)) / col.drawn;
  const maxAbs = Math.max(
    1e-9,
    ...(weights ?? []).map((l) => Math.max(Math.abs(l.min ?? 0), Math.abs(l.max ?? 0))),
  );

  const edges: ReactElement[] = [];
  for (let c = 0; c < cols.length - 1; c++) {
    const from = cols[c] as Column;
    const to = cols[c + 1] as Column;
    const m = weights?.[c]?.matrix;
    for (let i = 0; i < from.drawn; i++) {
      for (let j = 0; j < to.drawn; j++) {
        let w = 0;
        if (m && m.length > 0 && (m[0]?.length ?? 0) > 0) {
          const row = m[
            Math.min(m.length - 1, Math.floor((i / from.drawn) * m.length))
          ] as number[];
          w = row[Math.min(row.length - 1, Math.floor((j / to.drawn) * row.length))] ?? 0;
        }
        const strength = m ? Math.min(1, Math.abs(w) / maxAbs) : 0.08;
        edges.push(
          <line
            key={`${c}-${i}-${j}`}
            x1={x(c)}
            y1={y(from, i)}
            x2={x(c + 1)}
            y2={y(to, j)}
            className={w >= 0 ? 'edge pos' : 'edge neg'}
            strokeWidth={0.4 + strength * 2.6}
            opacity={m ? 0.15 + strength * 0.75 : 0.25}
          />,
        );
      }
    }
  }

  return (
    <figure className="chart network">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Neural network with ${structure.layers.length} hidden layers and ${structure.paramCount.toLocaleString('en-GB')} adjustable numbers${epoch ? `, weights after epoch ${epoch}` : ''}.`}
      >
        {edges}
        {cols.map((col, c) => (
          <g key={col.label}>
            {Array.from({ length: col.drawn }, (_, i) => (
              <circle key={i} cx={x(c)} cy={y(col, i)} r={6} className="unit" />
            ))}
            <text x={x(c)} y={H - 8} textAnchor="middle" className="axis">
              {col.label}
              {col.units > col.drawn
                ? ` (${col.units} units, ${Math.ceil(col.units / col.drawn)} per dot)`
                : ` (${col.units})`}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="muted small">
        {structure.paramCount.toLocaleString('en-GB')} adjustable numbers.{' '}
        {weights
          ? `Line thickness is connection strength after epoch ${epoch}.`
          : 'Strengths appear after the first epoch.'}{' '}
        <span className="live-tag">live</span>
      </figcaption>
    </figure>
  );
}
