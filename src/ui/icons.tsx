import type { JSX } from 'react';

interface IconProps {
  size?: number;
}

function svg(
  size: number,
  children: JSX.Element | JSX.Element[],
  filled = false,
): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconBook = ({ size = 18 }: IconProps) =>
  svg(size, [
    <path key="a" d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />,
    <path key="b" d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20" />,
    <path key="c" d="M8 7.5h8M8 11h5" />,
  ]);

export const IconPlay = ({ size = 16 }: IconProps) =>
  svg(size, [<path key="p" d="M7 4.5v15l12-7.5z" />], true);

export const IconPause = ({ size = 16 }: IconProps) =>
  svg(size, [
    <rect key="a" x="6" y="4" width="4" height="16" rx="1" />,
    <rect key="b" x="14" y="4" width="4" height="16" rx="1" />,
  ], true);

export const IconStop = ({ size = 16 }: IconProps) =>
  svg(size, [<rect key="s" x="6" y="6" width="12" height="12" rx="2" />], true);

export const IconSettings = ({ size = 18 }: IconProps) =>
  svg(size, [
    <circle key="c" cx="12" cy="12" r="3" />,
    <path
      key="g"
      d="M19.4 13.5a7.8 7.8 0 0 0 0-3l2-1.5-2-3.4-2.3 1a7.6 7.6 0 0 0-2.6-1.5L14 2.6h-4l-.5 2.5a7.6 7.6 0 0 0-2.6 1.5l-2.3-1-2 3.4 2 1.5a7.8 7.8 0 0 0 0 3l-2 1.5 2 3.4 2.3-1a7.6 7.6 0 0 0 2.6 1.5l.5 2.5h4l.5-2.5a7.6 7.6 0 0 0 2.6-1.5l2.3 1 2-3.4z"
    />,
  ]);

export const IconHelp = ({ size = 18 }: IconProps) =>
  svg(size, [
    <circle key="c" cx="12" cy="12" r="9" />,
    <path key="q" d="M9.5 9.2A2.6 2.6 0 0 1 12 7.5c1.5 0 2.6 1 2.6 2.3 0 1.8-2.4 2.2-2.4 3.9" />,
    <circle key="d" cx="12" cy="16.8" r="0.6" fill="currentColor" stroke="none" />,
  ]);

export const IconChart = ({ size = 18 }: IconProps) =>
  svg(size, [
    <path key="a" d="M4 20V4" />,
    <path key="b" d="M4 20h16" />,
    <path key="c" d="M8 16v-5M12 16V8M16 16v-3M20 16V6" />,
  ]);

export const IconClose = ({ size = 16 }: IconProps) =>
  svg(size, [<path key="x" d="M6 6l12 12M18 6L6 18" />]);

export const IconInfo = ({ size = 15 }: IconProps) =>
  svg(size, [
    <circle key="c" cx="12" cy="12" r="9" />,
    <path key="i" d="M12 11v5" />,
    <circle key="d" cx="12" cy="7.8" r="0.6" fill="currentColor" stroke="none" />,
  ]);

export const IconTextSize = ({ size = 18 }: IconProps) =>
  svg(size, [
    <path key="a" d="M4 19L10 5l6 14" />,
    <path key="b" d="M6.5 14h7" />,
    <path key="c" d="M16 19l3-6 3 6" strokeWidth="1.4" />,
  ]);

export const IconExternal = ({ size = 13 }: IconProps) =>
  svg(size, [
    <path key="a" d="M14 4h6v6" />,
    <path key="b" d="M20 4L10 14" />,
    <path key="c" d="M18 13v6H5V6h6" />,
  ]);
