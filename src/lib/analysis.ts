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

/** Parse per-input analyses from the raw model text output. */
export function parseAnalysisText(
  inputs: string[],
  text: string,
): (Analysis | null)[] {
  const allNull = inputs.map(() => null);
  const arr = extractJsonArray(text);
  if (!arr || arr.length !== inputs.length) return allNull;
  return inputs.map((input, i) => parseAnalysisItem(input, arr[i]));
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
