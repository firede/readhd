// Site rules: domain (+ optional path prefix) lists that gate the content
// script. Rules are stored as canonical text "host/path".

export type SiteMode = 'allowlist' | 'blocklist';

export interface SiteRule {
  host: string;
  /** '' means the whole host; otherwise a path prefix like '/news'. */
  path: string;
}

/**
 * Parse user input into a canonical rule. Accepts bare hosts, hosts with a
 * path, full URLs, a leading `*.`, ports, queries and hashes.
 */
export function parseRule(
  input: string,
): { rule: SiteRule; text: string } | { error: string } {
  let s = input.trim();
  if (!s) return { error: '请输入网址或域名' };
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/^\*\./, '');
  s = s.split(/[?#]/, 1)[0]!;
  const slash = s.indexOf('/');
  let host = slash === -1 ? s : s.slice(0, slash);
  let path = slash === -1 ? '' : s.slice(slash);
  host = host.split(':')[0]!.toLowerCase();
  try {
    // Normalizes and gives punycode for IDN hosts.
    host = new URL(`http://${host}`).hostname;
  } catch {
    return { error: '无法识别这个域名' };
  }
  if (
    !host ||
    !/^[a-z0-9.-]+$/.test(host) ||
    host.startsWith('.') ||
    host.endsWith('.')
  ) {
    return { error: '无法识别这个域名' };
  }
  while (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  if (path === '/') path = '';
  return { rule: { host, path }, text: host + path };
}

/** Whether a rule matches a parsed URL (host or subdomain + path prefix). */
export function ruleMatches(rule: SiteRule, url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
  const h = url.hostname;
  if (h !== rule.host && !h.endsWith(`.${rule.host}`)) return false;
  if (!rule.path) return true;
  return url.pathname === rule.path || url.pathname.startsWith(`${rule.path}/`);
}

/** Texts of the stored rules matching the given URL (bad rules skipped). */
export function matchingRules(rules: string[], url: string): string[] {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const r of rules) {
    const p = parseRule(r);
    if ('rule' in p && ruleMatches(p.rule, u)) out.push(p.text);
  }
  return out;
}

/** Whether the extension should be active on this URL. */
export function isSiteEnabled(
  url: string,
  mode: SiteMode,
  rules: string[],
): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const matched = matchingRules(rules, url).length > 0;
  return mode === 'allowlist' ? matched : !matched;
}

/**
 * Suggest a rule for a URL: 'site' → hostname (one leading www. stripped);
 * 'section' → hostname + first path segment (null at site root).
 */
export function suggestRule(
  url: string,
  scope: 'site' | 'section',
): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const host = u.hostname.replace(/^www\./, '');
  if (scope === 'site') return host;
  // 'section' only makes sense for directory-like paths: at least two
  // segments (/news/123) or a trailing slash (/news/). Single-file paths
  // (/fixture.html, /article) return null.
  const segs = u.pathname.split('/').filter(Boolean);
  if (!segs.length) return null;
  if (segs.length >= 2 || u.pathname.endsWith('/')) return `${host}/${segs[0]}`;
  return null;
}
