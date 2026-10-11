/**
 * A small hand-rolled icon set, not a dependency -- this app's only need
 * for icons is pairing a handful of existing action labels with a visual
 * cue (approve/reject/escalate/edit) plus a few status markers, which
 * doesn't justify a whole icon library. Each icon is a plain stroke-based
 * SVG matching a 24x24 viewBox convention; `className` controls size/color
 * via Tailwind (e.g. `h-5 w-5 text-approve`).
 */
export interface IconProps {
  className?: string;
}

function baseProps(className?: string) {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  };
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function CheckCircleIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  );
}

export function XIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  );
}

export function AlertTriangleIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <path d="M10.3 3.9 2.6 18a1.5 1.5 0 0 0 1.3 2.2h16.2a1.5 1.5 0 0 0 1.3-2.2L13.7 3.9a1.5 1.5 0 0 0-2.6 0Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

export function PencilIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <path d="M17 3a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
      <path d="m14.5 5.5 3 3" />
    </svg>
  );
}

export function WifiOffIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <path d="M2 2l20 20" />
      <path d="M8.5 16.5a5 5 0 0 1 7 0" />
      <path d="M5 12.5a9.5 9.5 0 0 1 3-2" />
      <path d="M12.5 8.01a9.5 9.5 0 0 1 6.5 2.5" />
      <path d="M16 12.5c.3.2.6.4.8.6" />
      <path d="M12 20h.01" />
    </svg>
  );
}

export function LoaderIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <path d="M12 3v3" />
      <path d="M12 18v3" />
      <path d="m5.6 5.6 2.1 2.1" />
      <path d="m16.3 16.3 2.1 2.1" />
      <path d="M3 12h3" />
      <path d="M18 12h3" />
      <path d="m5.6 18.4 2.1-2.1" />
      <path d="m16.3 7.7 2.1-2.1" />
    </svg>
  );
}

export function ChevronRightIcon({ className }: IconProps) {
  return (
    <svg {...baseProps(className)}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}
