// Pure rendering plan: decide which text ranges get which highlight class.

import type { Word } from './analysis';
import { isWordLike } from './highlight';

export type MarkClass = 'a' | 'b' | 'f';

export interface Mark {
  start: number;
  end: number;
  cls: MarkClass;
}

export interface PlanOpts {
  alternate: boolean;
  unit: 'word' | 'chunk';
  fade: boolean;
}

const FADED_POS = new Set(['u', 'y']);

/**
 * Plan highlight marks for a paragraph's words.
 * - 'f' marks for faded function words (pos u/y) when fade is on.
 * - 'a'/'b' marks alternate over word-like words (unit 'word') or over
 *   chunks (unit 'chunk'). Faded words never alternate and don't consume
 *   an alternation step. If any word lacks a chunk index (local fallback),
 *   chunk mode falls back to word mode.
 */
export function planMarks(words: Word[], opts: PlanOpts): Mark[] {
  const marks: Mark[] = [];
  // Chunk mode only if every word has a chunk index (else local fallback).
  const useChunks =
    opts.unit === 'chunk' &&
    words.length > 0 &&
    words.every((w) => w.chunk !== null);

  const chunkCls = new Map<number, MarkClass>();
  let toggle = false;
  for (const w of words) {
    if (!isWordLike(w.text)) continue;
    if (opts.fade && w.pos && FADED_POS.has(w.pos)) {
      marks.push({ start: w.start, end: w.end, cls: 'f' });
      continue;
    }
    if (!opts.alternate) continue;
    if (useChunks) {
      const ci = w.chunk!;
      let cls = chunkCls.get(ci);
      if (!cls) {
        cls = toggle ? 'b' : 'a';
        toggle = !toggle;
        chunkCls.set(ci, cls);
      }
      marks.push({ start: w.start, end: w.end, cls });
    } else {
      marks.push({
        start: w.start,
        end: w.end,
        cls: toggle ? 'b' : 'a',
      });
      toggle = !toggle;
    }
  }
  return marks;
}

const WS_ONLY = /^\s+$/u;

function nextWordIndex(words: Word[], from: number): number {
  // Next word after `from`, skipping whitespace-only words. Returns -1 when
  // the next non-whitespace word is punctuation (or there is none).
  for (let j = from + 1; j < words.length; j++) {
    const t = words[j]!.text;
    if (WS_ONLY.test(t)) continue;
    return isWordLike(t) ? j : -1;
  }
  return -1;
}

/**
 * Word indices that get a trailing gap.
 * - 'word': every word-like word followed (after optional whitespace) by
 *   another word-like word.
 * - 'chunk': the last word-like word of a chunk when the next word-like word
 *   is adjacent (only whitespace between, no punctuation) and belongs to a
 *   different chunk. Missing chunk info → no gaps.
 */
export function planGaps(words: Word[], mode: 'none' | 'word' | 'chunk'): Set<number> {
  const out = new Set<number>();
  if (mode === 'none') return out;
  for (let i = 0; i < words.length; i++) {
    const w = words[i]!;
    if (!isWordLike(w.text)) continue;
    const j = nextWordIndex(words, i);
    if (j < 0) continue;
    if (mode === 'word') {
      out.add(i);
    } else {
      if (w.chunk === null || words[j]!.chunk === null) continue;
      if (words[j]!.chunk !== w.chunk) out.add(i);
    }
  }
  return out;
}
