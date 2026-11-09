import type { ParamSpec } from '@noesis/registry';

/** One input for one setting, chosen by the setting's type. Used wherever settings can be edited. */
export function ParamEditor({
  id,
  spec,
  value,
  onChange,
  disabled,
}: {
  id: string;
  spec: ParamSpec;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}) {
  const off = disabled ?? false;
  if (spec.type === 'enum')
    return (
      <select
        id={id}
        value={String(value ?? '')}
        disabled={off}
        onChange={(e) => onChange(e.target.value)}
      >
        {value === null || value === undefined ? <option value="">not set</option> : null}
        {(spec.options ?? []).map((o) => (
          <option key={String(o)} value={String(o)}>
            {String(o)}
          </option>
        ))}
      </select>
    );
  if (spec.type === 'bool')
    return (
      <input
        id={id}
        type="checkbox"
        checked={value === true}
        disabled={off}
        onChange={(e) => onChange(e.target.checked)}
      />
    );
  if (spec.type === 'int' || spec.type === 'float' || spec.type === 'number')
    return (
      <input
        id={id}
        type="number"
        disabled={off}
        value={value === null || value === undefined ? '' : Number(value)}
        {...(spec.min !== undefined ? { min: spec.min } : {})}
        {...(spec.max !== undefined ? { max: spec.max } : {})}
        step={spec.type === 'int' ? 1 : 'any'}
        placeholder={spec.default === null ? 'not in use' : String(spec.default)}
        onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        style={{ width: 100 }}
      />
    );
  if (spec.type === 'ints' || spec.type === 'floats')
    return (
      <input
        id={id}
        type="text"
        disabled={off}
        defaultValue={Array.isArray(value) ? value.join(', ') : ''}
        aria-label="Comma-separated numbers"
        onBlur={(e) => {
          const numbers = e.target.value
            .split(',')
            .map((t) => Number(t.trim()))
            .filter((n) => t_isNumber(n));
          if (numbers.length > 0) onChange(numbers);
        }}
        style={{ width: 140 }}
      />
    );
  return (
    <span className="mono">
      {Array.isArray(value) ? value.join(', ') : String(value ?? 'not set')}
    </span>
  );
}

const t_isNumber = (n: number): boolean => Number.isFinite(n);
