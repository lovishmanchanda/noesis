/** A tiny bar chart of how a column's values are spread. */
export function Histogram({ counts, label }: { counts: number[]; label: string }) {
  const top = Math.max(1, ...counts);
  const w = 6;
  const gap = 1;
  return (
    <svg
      className="histogram"
      width={counts.length * (w + gap)}
      height={28}
      role="img"
      aria-label={label}
    >
      {counts.map((c, i) => {
        const h = Math.max(1, (c / top) * 26);
        return <rect key={i} x={i * (w + gap)} y={28 - h} width={w} height={h} rx={1} />;
      })}
    </svg>
  );
}

/** A bar from -1 to 1 for a correlation. */
export function CorrelationBar({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="muted">–</span>;
  const width = Math.min(1, Math.abs(value)) * 50;
  return (
    <span className="corr" title={`Correlation with the target: ${value.toFixed(2)}`}>
      <svg width={104} height={12} aria-hidden="true">
        <line x1={52} x2={52} y1={0} y2={12} className="corr-axis" />
        <rect
          x={value >= 0 ? 52 : 52 - width}
          y={2}
          width={width}
          height={8}
          rx={2}
          className={value >= 0 ? 'corr-pos' : 'corr-neg'}
        />
      </svg>
      <span className="mono small">{value.toFixed(2)}</span>
    </span>
  );
}
