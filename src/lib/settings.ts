import { storage } from 'wxt/utils/storage';

export type ColorPreset = 'blue' | 'red' | 'green';
export type Engine = 'cloud' | 'local';
export type BgTheme = 'none' | 'cream' | 'green' | 'blue';

export const BG_THEME_COLORS: Record<Exclude<BgTheme, 'none'>, string> = {
  cream: '#FAF6E9',
  green: '#EEF6EA',
  blue: '#EAF2FA',
};

export type ColorUnit = 'word' | 'chunk';

// sync items
export const enabled = storage.defineItem<boolean>('sync:enabled', {
  fallback: true,
});
export const disabledHosts = storage.defineItem<string[]>('sync:disabledHosts', {
  fallback: [],
});
export const altColor = storage.defineItem<boolean>('sync:altColor', {
  fallback: true,
});
export const colorPreset = storage.defineItem<ColorPreset>('sync:colorPreset', {
  fallback: 'blue',
});
export const engine = storage.defineItem<Engine>('sync:engine', {
  fallback: 'cloud',
});
export const lineHeight = storage.defineItem<number | null>('sync:lineHeight', {
  fallback: null,
});
export const letterSpacing = storage.defineItem<number | null>(
  'sync:letterSpacing',
  { fallback: null },
);
export const fontScale = storage.defineItem<number | null>('sync:fontScale', {
  fallback: null,
});
export const bgTheme = storage.defineItem<BgTheme>('sync:bgTheme', {
  fallback: 'none',
});
export const colorUnit = storage.defineItem<ColorUnit>('sync:colorUnit', {
  fallback: 'word',
});
export const fadeFunctionWords = storage.defineItem<boolean>(
  'sync:fadeFunctionWords',
  { fallback: false },
);
export const readingRuler = storage.defineItem<boolean>('sync:readingRuler', {
  fallback: false,
});
export const rulerLines = storage.defineItem<1 | 2 | 3>('sync:rulerLines', {
  fallback: 2,
});

// local items
export const apiKey = storage.defineItem<string>('local:apiKey', {
  fallback: '',
});
export const apiBase = storage.defineItem<string>('local:apiBase', {
  fallback: 'https://api.minimax.cn/anthropic',
});
export const model = storage.defineItem<string>('local:model', {
  fallback: 'MiniMax-M3',
});
export interface StyleSettings {
  enabled: boolean;
  disabledHosts: string[];
  altColor: boolean;
  colorPreset: ColorPreset;
  colorUnit: ColorUnit;
  fadeFunctionWords: boolean;
  engine: Engine;
  lineHeight: number | null;
  letterSpacing: number | null;
  fontScale: number | null;
  bgTheme: BgTheme;
  readingRuler: boolean;
  rulerLines: 1 | 2 | 3;
}

export async function getStyleSettings(): Promise<StyleSettings> {
  const [en, hosts, alt, preset, unit, fade, eng, lh, ls, fs, bg, ruler, rl] =
    await Promise.all([
      enabled.getValue(),
      disabledHosts.getValue(),
      altColor.getValue(),
      colorPreset.getValue(),
      colorUnit.getValue(),
      fadeFunctionWords.getValue(),
      engine.getValue(),
      lineHeight.getValue(),
      letterSpacing.getValue(),
      fontScale.getValue(),
      bgTheme.getValue(),
      readingRuler.getValue(),
      rulerLines.getValue(),
    ]);
  return {
    enabled: en,
    disabledHosts: hosts,
    altColor: alt,
    colorPreset: preset,
    colorUnit: unit,
    fadeFunctionWords: fade,
    engine: eng,
    lineHeight: lh,
    letterSpacing: ls,
    fontScale: fs,
    bgTheme: bg,
    readingRuler: ruler,
    rulerLines: rl,
  };
}
