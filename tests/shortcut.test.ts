import { describe, expect, it } from 'vitest';
import { formatShortcut } from '../src/lib/shortcut';

describe('formatShortcut', () => {
  it('mac: token form → symbol keycaps + full text', () => {
    const r = formatShortcut('Command+Alt+R', true);
    expect(r?.keys).toEqual(['⌥', '⌘', 'R']);
    expect(r?.full).toBe('⌥ Option + ⌘ Command + R');
  });

  it('mac: symbol form parsed the same', () => {
    const r = formatShortcut('⌥⌘R', true);
    expect(r?.keys).toEqual(['⌥', '⌘', 'R']);
    expect(r?.full).toBe('⌥ Option + ⌘ Command + R');
  });

  it('mac: control+shift ordering and names', () => {
    const r = formatShortcut('Shift+Control+X', true);
    expect(r?.keys).toEqual(['⌃', '⇧', 'X']);
    expect(r?.full).toBe('⌃ Control + ⇧ Shift + X');
  });

  it('non-mac: Alt+Shift+R', () => {
    const r = formatShortcut('Alt+Shift+R', false);
    expect(r?.keys).toEqual(['Alt', 'Shift', 'R']);
    expect(r?.full).toBe('Alt + Shift + R');
  });

  it('non-mac: ctrl canonical order', () => {
    const r = formatShortcut('Shift+Ctrl+PageDown', false);
    expect(r?.keys).toEqual(['Ctrl', 'Shift', 'PageDown']);
    expect(r?.full).toBe('Ctrl + Shift + PageDown');
  });

  it('lowercase key is uppercased', () => {
    expect(formatShortcut('Alt+Shift+r', false)?.keys.at(-1)).toBe('R');
  });

  it('empty/unparseable → null', () => {
    expect(formatShortcut('', true)).toBeNull();
    expect(formatShortcut('  ', false)).toBeNull();
    expect(formatShortcut('R', true)).toBeNull();
    expect(formatShortcut('Bogus+R', false)).toBeNull();
  });
});
