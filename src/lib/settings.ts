import { storage } from 'wxt/utils/storage';

export type ColorPreset = 'blue' | 'red' | 'green';
export type Engine = 'cloud' | 'local';
export type BgTheme = 'none' | 'cream' | 'green' | 'blue';

export const BG_THEME_COLORS: Record<Exclude<BgTheme, 'none'>, string> = {
  cream: '#FAF6E9',
  green: '#EEF6EA',
  blue: '#EAF2FA',
};

export interface SelftestRecord {
  ts: number;
  passageId: string;
  condition: 'on' | 'off';
  ms: number;
  hanChars: number;
  correct: number;
  settingsSnapshot: Record<string, unknown>;
}

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
export const selftestResults = storage.defineItem<SelftestRecord[]>(
  'local:selftestResults',
  { fallback: [] },
);

export interface StyleSettings {
  enabled: boolean;
  disabledHosts: string[];
  altColor: boolean;
  colorPreset: ColorPreset;
  engine: Engine;
  lineHeight: number | null;
  letterSpacing: number | null;
  fontScale: number | null;
  bgTheme: BgTheme;
}

export async function getStyleSettings(): Promise<StyleSettings> {
  const [
    en,
    hosts,
    alt,
    preset,
    eng,
    lh,
    ls,
    fs,
    bg,
  ] = await Promise.all([
    enabled.getValue(),
    disabledHosts.getValue(),
    altColor.getValue(),
    colorPreset.getValue(),
    engine.getValue(),
    lineHeight.getValue(),
    letterSpacing.getValue(),
    fontScale.getValue(),
    bgTheme.getValue(),
  ]);
  return {
    enabled: en,
    disabledHosts: hosts,
    altColor: alt,
    colorPreset: preset,
    engine: eng,
    lineHeight: lh,
    letterSpacing: ls,
    fontScale: fs,
    bgTheme: bg,
  };
}
