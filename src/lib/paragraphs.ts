// Paragraph collection: group text nodes by their nearest block-level
// ancestor, keeping an offset map back to (textNode, offset) pairs.

const SKIP_TAGS = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEXTAREA',
  'INPUT',
  'SELECT',
  'CODE',
  'PRE',
  'SVG',
]);

const HAN_RE = /\p{Script=Han}/u;

export interface TextSpanRef {
  node: Text;
  start: number;
  end: number;
}

export interface Paragraph {
  /** The block-level element that owns these text nodes. */
  block: Element;
  /** Concatenated text of all member text nodes. */
  text: string;
  /** Member text nodes in document order. */
  nodes: Text[];
  /** offsets[i] = index in `text` where nodes[i]'s content begins. */
  offsets: number[];
}

function isSkippable(el: Element): boolean {
  if (SKIP_TAGS.has(el.tagName)) return true;
  if (el.closest('.readhd-root')) return true; // extension's own UI
  let cur: Element | null = el;
  while (cur) {
    if ((cur as HTMLElement).isContentEditable) return true;
    cur = cur.parentElement;
  }
  return false;
}

function nearestBlock(el: Element): Element {
  let cur: Element = el;
  while (true) {
    const display = getComputedStyle(cur).display;
    if (!display || !display.startsWith('inline')) return cur;
    if (!cur.parentElement || cur === document.body) return cur;
    cur = cur.parentElement;
  }
}

/**
 * Collect paragraphs under `root` (defaults to document.body).
 * Returns paragraphs in document order, grouped by block ancestor.
 */
export function collectParagraphs(root: Element = document.body): Paragraph[] {
  const doc = root.ownerDocument;
  const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const byBlock = new Map<Element, Text[]>();
  let node = walker.nextNode() as Text | null;
  while (node) {
    const parent = node.parentElement;
    if (
      parent &&
      node.data.length > 0 &&
      HAN_RE.test(node.data) &&
      !isSkippable(parent)
    ) {
      const block = nearestBlock(parent);
      let list = byBlock.get(block);
      if (!list) {
        list = [];
        byBlock.set(block, list);
      }
      list.push(node);
    }
    node = walker.nextNode() as Text | null;
  }
  const paragraphs: Paragraph[] = [];
  for (const [block, nodes] of byBlock) {
    let text = '';
    const offsets: number[] = [];
    for (const n of nodes) {
      offsets.push(text.length);
      text += n.data;
    }
    paragraphs.push({ block, nodes, offsets, text });
  }
  return paragraphs;
}

/**
 * Map a [start, end) range in paragraph text to per-node span refs.
 * Ranges may span multiple text nodes; each returned ref covers the
 * intersection with a single node.
 */
export function mapRangeToNodes(
  p: Paragraph,
  start: number,
  end: number,
): TextSpanRef[] {
  const refs: TextSpanRef[] = [];
  for (let i = 0; i < p.nodes.length; i++) {
    const node = p.nodes[i]!;
    const nodeStart = p.offsets[i]!;
    const nodeEnd = nodeStart + node.data.length;
    const s = Math.max(start, nodeStart);
    const e = Math.min(end, nodeEnd);
    if (s < e) {
      refs.push({ node, start: s - nodeStart, end: e - nodeStart });
    }
    if (nodeEnd >= end) break;
  }
  return refs;
}

/**
 * Split a long paragraph into analysis items of at most ~120 chars:
 * sentences accumulate until a sentence-ending punctuation is seen at ≥40
 * chars; a single runaway sentence is cut at the last minor punctuation
 * (，、：,) before 120; hard cap 160 chars.
 */
const SENT_END = new Set('。！？；…!?；;\n'.split(''));
const MINOR_PUNCT = new Set('，、：,'.split(''));

export function splitChunks(
  text: string,
  minLen = 40,
  targetLen = 120,
  hardLen = 160,
): string[] {
  if (text.length <= targetLen) return [text];
  const out: string[] = [];
  let cur = '';
  for (const ch of text) {
    cur += ch;
    if (cur.length >= minLen && SENT_END.has(ch)) {
      out.push(cur);
      cur = '';
    } else if (cur.length >= targetLen) {
      // Look for the last minor punctuation within the target window.
      let cut = -1;
      for (let i = Math.min(targetLen, cur.length) - 1; i >= minLen; i--) {
        if (MINOR_PUNCT.has(cur[i]!)) {
          cut = i;
          break;
        }
      }
      if (cut >= 0) {
        out.push(cur.slice(0, cut + 1));
        cur = cur.slice(cut + 1);
      } else if (cur.length >= hardLen) {
        out.push(cur.slice(0, hardLen));
        cur = cur.slice(hardLen);
      }
    }
  }
  if (cur) out.push(cur);
  return out;
}
