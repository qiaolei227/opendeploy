import type { ReactElement } from 'react';

export interface LogoMarkProps {
  /** Rendered pixel size (applies to both width and height). */
  size: number;
  /** `default` for light surfaces (dark stem), `inverse` for dark surfaces (light stem). */
  variant?: 'default' | 'inverse';
  /** Optional accessible label. */
  label?: string;
}

/**
 * LogoMark — the 开达 / OpenDeploy brand mark.
 *
 * Design: gourd (葫芦) silhouette in Claude terracotta `#D97757` with a Claude-style
 * 4-point sparkle cut out of the lower bulb — "宝葫芦里装着 AI 工具"。
 * Source of truth SVG lives at `resources/icon.svg`.
 */
export function LogoMark({ size, variant = 'default', label }: LogoMarkProps): ReactElement {
  const stem = variant === 'inverse' ? '#fafaf7' : '#141414';
  const body = '#D97757';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      preserveAspectRatio="xMidYMid meet"
      fill="none"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <path
        fill={body}
        fillRule="evenodd"
        d="M24 10 C28.8 10 30 14 27.5 16.5 C31.5 18 34 23 34 30 C34 38.5 30 42.5 24 42.5 C18 42.5 14 38.5 14 30 C14 23 16.5 18 20.5 16.5 C18 14 19.2 10 24 10 Z M24 22 C24 27 25.5 29.5 31 30.5 C25.5 31.5 24 34 24 39 C24 34 22.5 31.5 17 30.5 C22.5 29.5 24 27 24 22 Z"
      />
      <rect x={22.5} y={6} width={3} height={5} rx={1.2} fill={stem} />
    </svg>
  );
}
