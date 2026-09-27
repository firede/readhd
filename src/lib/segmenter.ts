// Shared segmentation client.
// - segmentLocal: synchronous Intl.Segmenter word segmentation.
// - Cloud results are cached (per text, bounded); failures are never cached.
// - In-flight cloud requests are deduped by text.

import { browser } from 'wxt/browser';
import { splitChunks } from './paragraphs';
import type { TokenSpan } from './segment-align';

const CACHE_MAX = 3000;

const zhSegmenter = new Intl.Segmenter('zh', { granularity: 'word' });

/** Local segmentation into contiguous spans covering `text`. */
export function segmentLocal(text: string): TokenSpan[] {
  const spans: TokenSpan[] = [];
  for (const seg of zhSegmenter.segment(text)) {
    spans.push({
      start: seg.index,
      end: seg.index + seg.segment.length,
      text: seg.segment,
    });
  }
  return spans;
}

const cloudCache = new Map<string, TokenSpan[]>();
const inflight = new Map<string, Promise<TokenSpan[] | null>>();

function cacheSet(text: string, spans: TokenSpan[]): void {
  if (cloudCache.has(text)) cloudCache.delete(text);
  if (cloudCache.size >= CACHE_MAX) {
    const oldest = cloudCache.keys().next().value;
    if (oldest !== undefined) cloudCache.delete(oldest);
  }
  cloudCache.set(text, spans);
}

export function getCachedCloud(text: string): TokenSpan[] | undefined {
  const hit = cloudCache.get(text);
  if (hit) {
    // refresh recency
    cloudCache.delete(text);
    cloudCache.set(text, hit);
  }
  return hit;
}

export interface SegmentMessage {
  type: 'segment';
  texts: string[];
}

export interface SegmentStatusMessage {
  type: 'segmentStatus';
}

/** Single-text cloud request with cache + in-flight dedupe. null = failure (not cached). */
export function segmentCloudCached(text: string): Promise<TokenSpan[] | null> {
  const cached = getCachedCloud(text);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(text);
  if (pending) return pending;
  const p = browser.runtime
    .sendMessage({ type: 'segment', texts: [text] } satisfies SegmentMessage)
    .then((res) => ((res as (TokenSpan[] | null)[] | null)?.[0] ?? null))
    .catch(() => null)
    .then((spans) => {
      if (spans) cacheSet(text, spans);
      return spans;
    })
    .finally(() => {
      inflight.delete(text);
    });
  inflight.set(text, p);
  return p;
}

export async function segmentStatus(): Promise<{ configured: boolean } | null> {
  try {
    return (await browser.runtime.sendMessage({
      type: 'segmentStatus',
    } satisfies SegmentStatusMessage)) as { configured: boolean } | null;
  } catch {
    return null;
  }
}

// --- paragraph-level helpers (chunked) ---

/**
 * Merge per-chunk spans into paragraph spans, offsetting each chunk's spans
 * by the chunk's start offset in the full text.
 */
export function mergeChunkSpans(
  chunks: string[],
  chunkSpans: TokenSpan[][],
): TokenSpan[] {
  const out: TokenSpan[] = [];
  let base = 0;
  for (let i = 0; i < chunks.length; i++) {
    for (const s of chunkSpans[i] ?? []) {
      out.push({ start: s.start + base, end: s.end + base, text: s.text });
    }
    base += chunks[i]!.length;
  }
  return out;
}

/** Local segmentation for a (possibly long) paragraph, chunked at 500 chars. */
export function segmentParagraphLocal(text: string): TokenSpan[] {
  const chunks = splitChunks(text, 500);
  return mergeChunkSpans(chunks, chunks.map(segmentLocal));
}

/**
 * Cloud segmentation for a paragraph: per-chunk requests (deduped/cached).
 * A chunk whose cloud result is null falls back to its local spans.
 */
export async function segmentParagraphCloud(text: string): Promise<TokenSpan[]> {
  const chunks = splitChunks(text, 500);
  const per = await Promise.all(
    chunks.map(async (c, i) => {
      const spans = await segmentCloudCached(c);
      return spans ?? segmentLocal(chunks[i]!);
    }),
  );
  return mergeChunkSpans(chunks, per);
}

/**
 * Cloud spans already in cache for the whole paragraph (all chunks hit),
 * or undefined.
 */
export function getParagraphCloud(text: string): TokenSpan[] | undefined {
  const chunks = splitChunks(text, 500);
  const per: TokenSpan[][] = [];
  for (const c of chunks) {
    const hit = getCachedCloud(c);
    if (!hit) return undefined;
    per.push(hit);
  }
  return mergeChunkSpans(chunks, per);
}
