import type { ColumnProfile } from '@noesis/engine-client';
import type { ReactNode } from 'react';
import { Bar, count, percent } from './ui';

export const TYPE_LABEL: Record<ColumnProfile['dtype'], string> = {
  int: 'whole number',
  float: 'number',
  bool: 'yes / no',
  category: 'category',
  string: 'text',
  datetime: 'date',
};

function example(c: ColumnProfile): string {
  if (c.top && c.top[0]) return c.top[0].value;
  if (c.median != null) return String(Math.round(c.median * 100) / 100);
  return '';
}

/** One row per column: name, type, how empty it is, how many different values, an example. */
export function ColumnTable({
  columns,
  extra,
}: {
  columns: ColumnProfile[];
  extra?: { head: string; cell: (c: ColumnProfile) => ReactNode };
}) {
  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th>Column</th>
            <th>Type</th>
            <th>Empty</th>
            <th>Different values</th>
            <th>Example</th>
            {extra && <th>{extra.head}</th>}
          </tr>
        </thead>
        <tbody>
          {columns.map((c) => (
            <tr key={c.name}>
              <td className="mono">
                {c.name}
                {c.idLike && (
                  <span className="tag" title="Nearly every value is different">
                    identifier?
                  </span>
                )}
              </td>
              <td>{TYPE_LABEL[c.dtype]}</td>
              <td>
                <Bar value={c.missingPct} label={percent(c.missingPct)} />{' '}
                {c.missing > 0 ? percent(c.missingPct) : ''}
              </td>
              <td>{count(c.unique)}</td>
              <td className="mono muted">{example(c)}</td>
              {extra && <td>{extra.cell(c)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
