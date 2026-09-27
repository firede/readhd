import { browser } from 'wxt/browser';

// Format a chrome.commands shortcut for display.
// Chrome may return symbol form on macOS ("⌥⌘R") or token form
// ("Alt+Shift+R", "Command+Alt+R"); both are parsed.

export interface FormattedShortcut {
  /** Keycap units, e.g. ['⌥','⌘','R'] (mac) or ['Alt','Shift','R']. */
  keys: string[];
  /** Readable text, e.g. '⌥ Option + ⌘ Command + R' or 'Alt + Shift + R'. */
  full: string;
}

type Mod = 'ctrl' | 'alt' | 'shift' | 'meta';

const MOD_TOKENS: Record<string, Mod> = {
  ctrl: 'ctrl',
  control: 'ctrl',
  macctrl: 'ctrl',
  '⌃': 'ctrl',
  alt: 'alt',
  option: 'alt',
  '⌥': 'alt',
  shift: 'shift',
  '⇧': 'shift',
  command: 'meta',
  cmd: 'meta',
  meta: 'meta',
  '⌘': 'meta',
};

const MAC_ORDER: Mod[] = ['ctrl', 'alt', 'shift', 'meta'];
const OTHER_ORDER: Mod[] = ['ctrl', 'alt', 'shift', 'meta'];

const MAC_SYM: Record<Mod, string> = {
  ctrl: '⌃',
  alt: '⌥',
  shift: '⇧',
  meta: '⌘',
};
const MAC_NAME: Record<Mod, string> = {
  ctrl: 'Control',
  alt: 'Option',
  shift: 'Shift',
  meta: 'Command',
};
const OTHER_NAME: Record<Mod, string> = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  meta: 'Meta',
};

function parse(shortcut: string): { mods: Mod[]; key: string } | null {
  const s = shortcut.trim();
  if (!s) return null;
  const mods = new Set<Mod>();
  let key = '';
  if (s.includes('+')) {
    const parts = s.split('+').map((p) => p.trim());
    for (const p of parts.slice(0, -1)) {
      const m = MOD_TOKENS[p.toLowerCase()];
      if (!m) return null;
      mods.add(m);
    }
    key = parts.at(-1) ?? '';
  } else {
    let i = 0;
    while (i < s.length) {
      const m = MOD_TOKENS[s[i]!];
      if (m) mods.add(m);
      else break;
      i++;
    }
    key = s.slice(i);
    // symbol form may interleave symbols; any symbol inside the key is a modifier
    if (mods.size === 0) return null;
  }
  if (!key) return null;
  const named = key.length > 1 ? key : key.toUpperCase();
  return { mods: [...mods], key: named };
}

/**
 * Format a shortcut string for display. Returns null when empty/unparseable
 * (i.e. the command is unbound).
 */
export function formatShortcut(
  shortcut: string,
  isMac: boolean,
): FormattedShortcut | null {
  const p = parse(shortcut);
  if (!p) return null;
  const order = isMac ? MAC_ORDER : OTHER_ORDER;
  const mods = order.filter((m) => p.mods.includes(m));
  if (isMac) {
    const keys = [...mods.map((m) => MAC_SYM[m]), p.key];
    const full = [...mods.map((m) => `${MAC_SYM[m]} ${MAC_NAME[m]}`), p.key].join(
      ' + ',
    );
    return { keys, full };
  }
  const keys = [...mods.map((m) => OTHER_NAME[m]), p.key];
  return { keys, full: keys.join(' + ') };
}

/** Shortcut of our toggle-reader command, formatted for this platform. */
export async function readerShortcut(): Promise<FormattedShortcut | null> {
  const cmds = await browser.commands.getAll();
  const sc = cmds.find((c) => c.name === 'toggle-reader')?.shortcut ?? '';
  const platform = navigator.platform || navigator.userAgent;
  return formatShortcut(sc, /mac/i.test(platform));
}
