import type { ReactElement } from 'react';

export interface LogoMarkProps {
  /** Rendered pixel size (applies to both width and height). */
  size: number;
  /** `default` for light surfaces (dark bracket), `inverse` for dark surfaces (light bracket). */
  variant?: 'default' | 'inverse';
  /** Optional accessible label. */
  label?: string;
}

/**
 * LogoMark — the 开达 / OpenDeploy brand mark.
 *
 * Design: B-2 bracket → orange dot (from `design/logo-options-v2.html`).
 * - Left side: rounded opening brace (开 = open / code).
 * - Right side: Claude Code terracotta `#D97757` solid circle with an
 *   ivory inset dot (达 = aim / deliver).
 *
 * Source of truth SVG lives at `resources/icon.svg`.
 */
export function LogoMark({ size, variant = 'default', label }: LogoMarkProps): ReactElement {
  const strokeColor = variant === 'inverse' ? '#fafaf7' : '#141414';
  const accent = '#D97757';
  const inset = '#fafaf7';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path
        d="M18 10 Q12 10 12 16 L12 22 Q12 24 8 24 Q12 24 12 26 L12 32 Q12 38 18 38"
        stroke={strokeColor}
        strokeWidth={2.5}
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={32} cy={24} r={6} fill={accent} />
      <circle cx={32} cy={24} r={2} fill={inset} />
    </svg>
  );
}

export default LogoMark;
