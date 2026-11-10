import { useEffect, useState } from 'react';

interface Item {
  feature: string;
  value: number | null;
}

/**
 * Horizontal bars for importances or coefficients, longest first. With `animate`, the bars grow
 * from zero when they first appear, which is how a closed-form fit is shown: as a replay.
 */
export function Bars({
  items,
  signed,
  animate,
  limit = 12,
  label,
}: {
  items: Item[];
  signed: boolean;
  animate?: boolean;
  limit?: number;
  label: string;
}) {
  const [grown, setGrown] = useState(!animate);
  useEffect(() => {
    if (!animate) return;
    setGrown(false);
    const id = setTimeout(() => setGrown(true), 30);
    return () => clearTimeout(id);
  }, [animate, items]);
  const shown = [...items]
    .filter((i): i is { feature: string; value: number } => i.value !== null)
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, limit);
  const top = Math.max(1e-12, ...shown.map((i) => Math.abs(i.value)));
  return (
    <ul className="bars" aria-label={label}>
      {shown.map((i) => {
        const share = (Math.abs(i.value) / top) * (signed ? 50 : 100);
        return (
          <li key={i.feature}>
            <span className="mono bar-name" title={i.feature}>
              {i.feature}
            </span>
            <span className="bar-track">
              <i
                className={i.value < 0 ? 'neg' : 'pos'}
                style={{
                  width: grown ? `${share}%` : '0%',
                  ...(signed ? { left: i.value < 0 ? `${50 - share}%` : '50%' } : {}),
                }}
              />
            </span>
            <span className="mono small">
              {Math.abs(i.value) >= 100 ? i.value.toFixed(0) : i.value.toFixed(3)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
