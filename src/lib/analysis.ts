// Pure analysis data model: words + POS tags + phrase-chunk indices.

import { POS_TAGS } from './analyze-prompt';
import { alignTokens, extractJsonArray } from './segment-align';

export type PosTag = (typeof POS_TAGS)[number];

export interface Word {
  start: number;
  end: number;
  text: string;
  pos: PosTag | null;
  chunk: number | null;
}

export interface Analysis {
  words: Word[];
  source: 'cloud' | 'local';
}

const TAG_SET = new Set<string>(POS_TAGS);

/**
 * Parse one cloud item: an array of non-empty chunk arrays, each chunk an
 * array of [word, tag] pairs. Unknown tags map to 'x'. Returns null if the
 * shape is wrong or the words don't reconstruct `original` (ignoring
 * whitespace, via alignTokens).
 */
export function parseAnalysisItem(
  original: string,
  item: unknown,
): Analysis | null {
  if (!Array.isArray(item) || item.length === 0) return null;
  const tokenTexts: string[] = [];
  const meta: { pos: PosTag; chunk: number }[] = [];
  for (let ci = 0; ci < item.length; ci++) {
    const chunk = item[ci];
    if (!Array.isArray(chunk) || chunk.length === 0) return null;
    for (const w of chunk) {
      if (
        !Array.isArray(w) ||
        w.length !== 2 ||
        typeof w[0] !== 'string' ||
        typeof w[1] !== 'string'
      ) {
        return null;
      }
      tokenTexts.push(w[0]);
      meta.push({
        pos: TAG_SET.has(w[1]) ? (w[1] as PosTag) : 'x',
        chunk: ci,
      });
    }
  }
  const spans = alignTokens(original, tokenTexts);
  if (!spans) return null;
  return {
    source: 'cloud',
    words: spans.map((s, i) => ({
      start: s.start,
      end: s.end,
      text: s.text,
      pos: meta[i]!.pos,
      chunk: meta[i]!.chunk,
    })),
  };
}

/** Whitespace-stripped joined word texts of a recovered item, or null. */
function itemText(item: unknown): string | null {
  if (!Array.isArray(item) || item.length === 0) return null;
  let out = '';
  for (const chunk of item) {
    if (!Array.isArray(chunk)) return null;
    for (const w of chunk) {
      if (!Array.isArray(w) || typeof w[0] !== 'string') return null;
      out += w[0];
    }
  }
  return out.replace(/\s+/gu, '');
}

/**
 * Parse per-input analyses from the raw model text output. When the outer
 * array length matches, validation is positional. When it differs (e.g.
 * salvage recovered fewer items, or the model dropped/duplicated an item),
 * items are matched to inputs by content: each item's stripped joined text
 * is assigned to the first unmatched input with identical stripped text.
 */
export function parseAnalysisText(
  inputs: string[],
  text: string,
): (Analysis | null)[] {
  const out: (Analysis | null)[] = inputs.map(() => null);
  const arr = extractJsonArray(text);
  if (!arr) return out;
  const used = new Set<number>();
  // Phase 1: positional validation when the count matches.
  if (arr.length === inputs.length) {
    for (let i = 0; i < inputs.length; i++) {
      const a = parseAnalysisItem(inputs[i]!, arr[i]);
      if (a) {
        out[i] = a;
        used.add(i);
      }
    }
  }
  // Phase 2: content matching — assign each remaining item to the first
  // unmatched input whose stripped text equals the item's joined words.
  for (let j = 0; j < arr.length; j++) {
    if (used.has(j)) continue;
    const joined = itemText(arr[j]);
    if (joined === null) continue;
    for (let i = 0; i < inputs.length; i++) {
      if (out[i] !== null) continue;
      if (inputs[i]!.replace(/\s+/gu, '') !== joined) continue;
      const a = parseAnalysisItem(inputs[i]!, arr[j]);
      if (a) {
        out[i] = a;
      }
      break;
    }
  }
  return out;
}

/** Parse a full Anthropic-style response into per-input analyses. */
export function parseAnalyzeResponse(
  inputs: string[],
  body: unknown,
): (Analysis | null)[] {
  const content = (body as { content?: unknown })?.content;
  if (!Array.isArray(content)) return inputs.map(() => null);
  const text = content
    .filter((b) => (b as { type?: string })?.type === 'text')
    .map((b) => (b as { text?: string }).text ?? '')
    .join('');
  return parseAnalysisText(inputs, text);
}

/** Local fallback: Intl.Segmenter words, no POS, no chunks. */
export function localAnalysis(text: string): Analysis {
  const seg = new Intl.Segmenter('zh', { granularity: 'word' });
  const words: Word[] = [];
  for (const s of seg.segment(text)) {
    words.push({
      start: s.index,
      end: s.index + s.segment.length,
      text: s.segment,
      pos: null,
      chunk: null,
    });
  }
  return { words, source: 'local' };
}
