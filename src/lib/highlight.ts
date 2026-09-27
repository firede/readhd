// CSS Custom Highlight API rendering shared by the content script and the
// self-test page. We keep one global Highlight per name; per-block ranges
// are tracked so a block can be removed/replaced without touching others.

import type { ColorPreset } from './settings';

export const HIGHLIGHT_NAMES = [
  'readhd-light-a',
  'readhd-light-b',
  'readhd-light-f',
  'readhd-dark-a',
  'readhd-dark-b',
  'readhd-dark-f',
] as const;

export type HighlightName = (typeof HIGHLIGHT_NAMES)[number];

const PAIRS: Record<'light' | 'dark', Record<ColorPreset, [string, string]>> = {
  light: {
    blue: ['#1a1a1a', '#1e40af'],
    red: ['#1a1a1a', '#991b1b'],
    green: ['#1a1a1a', '#166534'],
  },
  dark: {
    blue: ['#f5f5f5', '#93c5fd'],
    red: ['#f5f5f5', '#fca5a5'],
    green: ['#f5f5f5', '#86efac'],
  },
};

const registry = new Map<HighlightName, Highlight>();
const blockRanges = new Map<object, Range[]>();

export function ensureHighlightsRegistered(): void {
  if (typeof CSS === 'undefined' || !CSS.highlights) return;
  for (const name of HIGHLIGHT_NAMES) {
    if (!registry.has(name)) {
      const h = new Highlight();
      registry.set(name, h);
      CSS.highlights.set(name, h);
    }
  }
}

const FADE_COLORS = { light: '#6b7280', dark: '#9ca3af' } as const;

export const FADE_LIGHT = FADE_COLORS.light;

/** Light-theme A/B colors for a preset (used by the reader's span colors). */
export function lightPair(preset: ColorPreset): [string, string] {
  return PAIRS.light[preset];
}

/** Colors for ::highlight rules, per theme/preset. */
export function highlightCss(preset: ColorPreset): string {
  const [la, lb] = PAIRS.light[preset];
  const [da, db] = PAIRS.dark[preset];
  return [
    `::highlight(readhd-light-a){color:${la}}`,
    `::highlight(readhd-light-b){color:${lb}}`,
    `::highlight(readhd-light-f){color:${FADE_COLORS.light}}`,
    `::highlight(readhd-dark-a){color:${da}}`,
    `::highlight(readhd-dark-b){color:${db}}`,
    `::highlight(readhd-dark-f){color:${FADE_COLORS.dark}}`,
  ].join('\n');
}

function removeFromRegistry(r: Range): void {
  for (const h of registry.values()) h.delete(r);
}

/** Replace the highlight ranges owned by `owner` (a block element or wrapper). */
export function setRanges(
  owner: object,
  entries: { range: Range; name: HighlightName }[],
): void {
  const old = blockRanges.get(owner);
  if (old) for (const r of old) removeFromRegistry(r);
  const all: Range[] = [];
  for (const { range, name } of entries) {
    const h = registry.get(name);
    if (!h) continue;
    h.add(range);
    all.push(range);
  }
  blockRanges.set(owner, all);
}

export function clearRanges(owner: object): void {
  setRanges(owner, []);
}

export function clearAllRanges(): void {
  for (const h of registry.values()) h.clear();
  blockRanges.clear();
}

const WORDLIKE_RE = /[\p{Script=Han}A-Za-z0-9]/u;

export function isWordLike(token: string): boolean {
  return WORDLIKE_RE.test(token);
}

/** Relative luminance of an rgb()/rgba() color string like "rgb(255, 0, 0)". */
export function luminanceOf(color: string): number | null {
  const m = color.match(/rgba?\(([^)]+)\)/);
  if (!m || m[1] == null) return null;
  const parts = m[1].split(',').map((s) => parseFloat(s));
  if (parts.length < 3 || parts.slice(0, 3).some(Number.isNaN)) return null;
  const alpha = parts.length >= 4 ? (parts[3] ?? 1) : 1;
  if (alpha === 0) return null;
  const [r = 0, g = 0, b = 0] = parts.slice(0, 3).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Effective background of an element: first non-transparent ancestor bg, fallback white. */
export function effectiveBackground(el: Element): string {
  let cur: Element | null = el;
  while (cur) {
    const bg = getComputedStyle(cur).backgroundColor;
    if (bg && luminanceOf(bg) !== null) return bg;
    cur = cur.parentElement;
  }
  return 'rgb(255, 255, 255)';
}

export function isDarkBlock(el: Element): boolean {
  const lum = luminanceOf(effectiveBackground(el));
  return lum !== null && lum < 0.4;
}
