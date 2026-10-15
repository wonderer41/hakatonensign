import type { ReactNode } from "react";

// Inline stroke icons on a 24 grid: miter joins, square caps.
// Always decorative: put the accessible name on the button or link, not on the icon.

export interface IconProps {
  /** Rendered width and height in px. Default 16. */
  size?: number;
  /** 1.6 for outline shapes, 1.8 for arrows and the close cross (as in the mockup). */
  strokeWidth?: number;
  className?: string;
}

function Icon({ size = 16, strokeWidth = 1.8, className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinejoin="miter"
      strokeLinecap="square"
      className={className}
    >
      {children}
    </svg>
  );
}

export function ChevronLeftIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M15 5l-7 7 7 7" />
    </Icon>
  );
}

export function ChevronRightIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 5l7 7-7 7" />
    </Icon>
  );
}

/** Card toggle chevron; rotate it 180° when open (transition 350ms). */
export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 9l7 7 7-7" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  );
}

/** Hermes speech bubble. */
export function ChatIcon({ strokeWidth = 1.6, ...props }: IconProps) {
  return (
    <Icon strokeWidth={strokeWidth} {...props}>
      <path d="M4 5h16v11H9l-5 4z" />
    </Icon>
  );
}

/** Broken panel triangle. */
export function WarningIcon({ strokeWidth = 1.6, ...props }: IconProps) {
  return (
    <Icon strokeWidth={strokeWidth} {...props}>
      <path d="M12 3 2 21h20z M12 10v5 M12 18v.5" />
    </Icon>
  );
}

/** Commit dot on a line. */
export function CommitIcon({ strokeWidth = 1.6, ...props }: IconProps) {
  return (
    <Icon strokeWidth={strokeWidth} {...props}>
      <circle cx="12" cy="12" r="3.5" />
      <path d="M2 12h6.5M15.5 12H22" />
    </Icon>
  );
}

export function CheckIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </Icon>
  );
}

/** Opens in a new tab. The mockup also uses a plain "↗" glyph in link text; either is fine. */
export function ExternalIcon({ strokeWidth = 1.6, ...props }: IconProps) {
  return (
    <Icon strokeWidth={strokeWidth} {...props}>
      <path d="M13 4h7v7 M20 4l-9 9 M17 14v6H4V7h6" />
    </Icon>
  );
}
