import type { ScreenStatus } from '../screens';

/** Small outline icons for step status. Colour comes from the surrounding text. */
export function StatusIcon({ status }: { status: ScreenStatus }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 16 16',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
  } as const;
  if (status === 'done')
    return (
      <svg {...common}>
        <path d="M3 8.5l3.2 3L13 4.5" />
      </svg>
    );
  if (status === 'current')
    return (
      <svg {...common}>
        <path d="M3 8h9M8.5 4l4 4-4 4" />
      </svg>
    );
  if (status === 'locked')
    return (
      <svg {...common}>
        <rect x="3.5" y="7" width="9" height="6.5" rx="1.5" />
        <path d="M5.5 7V5.5a2.5 2.5 0 015 0V7" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="8" cy="8" r="4" />
    </svg>
  );
}
