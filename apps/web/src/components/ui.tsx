import type { ReactNode } from 'react';

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="muted small">{hint}</span>}
    </label>
  );
}

export function Notice({
  kind,
  children,
}: {
  kind: 'error' | 'info' | 'warn';
  children: ReactNode;
}) {
  return (
    <div className={`notice ${kind}`} role={kind === 'error' ? 'alert' : 'note'}>
      {children}
    </div>
  );
}

export function Bar({ value, label }: { value: number; label?: string }) {
  return (
    <span className="minibar" title={label}>
      <i style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }} />
    </span>
  );
}

export const percent = (x: number | null | undefined): string =>
  x == null ? '' : `${Math.round(x * 1000) / 10}%`;
export const count = (n: number): string => n.toLocaleString('en-GB');
