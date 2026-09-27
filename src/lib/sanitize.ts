// Sanitize Readability article HTML for the reader overlay: keep a whitelist
// of tags, drop dangerous/embedded content entirely, unwrap everything else.

const DROP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'IFRAME',
  'OBJECT',
  'EMBED',
  'FORM',
  'INPUT',
  'BUTTON',
  'SELECT',
  'TEXTAREA',
  'SVG',
  'VIDEO',
  'AUDIO',
  'CANVAS',
  'NOSCRIPT',
]);

const ALLOWED_TAGS = new Set([
  'P',
  'H1',
  'H2',
  'H3',
  'H4',
  'H5',
  'H6',
  'UL',
  'OL',
  'LI',
  'BLOCKQUOTE',
  'FIGURE',
  'FIGCAPTION',
  'IMG',
  'BR',
  'STRONG',
  'B',
  'EM',
  'I',
  'A',
  'SPAN',
  'DIV',
  'SECTION',
  'ARTICLE',
  'TABLE',
  'THEAD',
  'TBODY',
  'TR',
  'TD',
  'TH',
]);

function allowedImgSrc(src: string): boolean {
  return /^https?:\/\//i.test(src) || /^data:image\//i.test(src);
}

function allowedHref(href: string): boolean {
  return /^https?:\/\//i.test(href);
}

function stripAttributes(el: Element): void {
  const keep = new Map<string, string>();
  if (el.tagName === 'IMG') {
    const src = el.getAttribute('src') ?? '';
    if (src && allowedImgSrc(src)) keep.set('src', src);
    const alt = el.getAttribute('alt');
    if (alt) keep.set('alt', alt);
  } else if (el.tagName === 'A') {
    const href = el.getAttribute('href') ?? '';
    if (href && allowedHref(href)) keep.set('href', href);
  }
  for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
  for (const [k, v] of keep) el.setAttribute(k, v);
  if (el.tagName === 'A' && keep.has('href')) {
    el.setAttribute('target', '_blank');
    el.setAttribute('rel', 'noopener noreferrer');
  }
}

function clean(el: Element): void {
  for (const child of [...el.children]) {
    // Foreign elements (svg, math) keep lowercase tagName in HTML documents.
    const tag = child.tagName.toUpperCase();
    if (DROP_TAGS.has(tag) || tag === 'MATH') {
      child.remove();
      continue;
    }
    clean(child);
    if (!ALLOWED_TAGS.has(tag) || child.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
      // Unwrap: keep children, drop the tag itself.
      child.replaceWith(...child.childNodes);
    } else {
      stripAttributes(child);
      if (child.tagName === 'IMG' && !child.getAttribute('src')) child.remove();
    }
  }
}

/**
 * Parse `html` (Readability `article.content`) and return a sanitized element
 * whose children are the sanitized top-level nodes.
 */
export function sanitizeArticle(html: string): HTMLElement {
  const doc = new DOMParser().parseFromString(
    `<div id="__r">${html}</div>`,
    'text/html',
  );
  const root = doc.getElementById('__r')!;
  clean(root);
  // Adopt into the current document so the caller can append it directly.
  return document.importNode(root, true) as HTMLElement;
}
