// Shared analysis client.
// - localAnalysis: synchronous Intl.Segmenter word segmentation (no POS/chunks).
// - Cloud analyses are cached per chunk text (bounded); failures never cached.
// - In-flight cloud requests are deduped by text.

import { browser } from 'wxt/browser';
import { splitChunks } from './paragraphs';
import { localAnalysis, type Analysis, type Word } from './analysis';

const CACHE_MAX = 3000;

const cloudCache = new Map<string, Analysis>();
const inflight = new Map<string, Promise<Analysis | null>>();

function cacheSet(text: string, a: Analysis): void {
  if (cloudCache.has(text)) cloudCache.delete(text);
  if (cloudCache.size >= CACHE_MAX) {
    const oldest = cloudCache.keys().next().value;
    if (oldest !== undefined) cloudCache.delete(oldest);
  }
  cloudCache.set(text, a);
}

export function getCachedCloud(text: string): Analysis | undefined {
  const hit = cloudCache.get(text);
  if (hit) {
    cloudCache.delete(text);
    cloudCache.set(text, hit);
  }
  return hit;
}

export interface AnalyzeMessage {
  type: 'analyze';
  texts: string[];
}

export interface AnalyzeStatusMessage {
  type: 'analyzeStatus';
}

/** Single-chunk cloud request with cache + in-flight dedupe. null = failure (not cached). */
export function analyzeCloudCached(text: string): Promise<Analysis | null> {
  const cached = getCachedCloud(text);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(text);
  if (pending) return pending;
  const p = browser.runtime
    .sendMessage({ type: 'analyze', texts: [text] } satisfies AnalyzeMessage)
    .then((res) => ((res as (Analysis | null)[] | null)?.[0] ?? null))
    .catch(() => null)
    .then((a) => {
      if (a) cacheSet(text, a);
      return a;
    })
    .finally(() => {
      inflight.delete(text);
    });
  inflight.set(text, p);
  return p;
}

export async function analyzeStatus(): Promise<{ configured: boolean } | null> {
  try {
    return (await browser.runtime.sendMessage({
      type: 'analyzeStatus',
    } satisfies AnalyzeStatusMessage)) as { configured: boolean } | null;
  } catch {
    return null;
  }
}

// --- paragraph-level helpers (chunked) ---

function offsetWords(words: Word[], base: number, chunkBase: number): Word[] {
  return words.map((w) => ({
    start: w.start + base,
    end: w.end + base,
    text: w.text,
    pos: w.pos,
    chunk: w.chunk === null ? null : w.chunk + chunkBase,
  }));
}

/**
 * Merge per-chunk analyses into a paragraph analysis, offsetting word
 * boundaries and renumbering chunk indices so they stay unique. Mixed
 * sources (some chunks local) keep source 'cloud' only if all are cloud.
 */
export function mergeChunkAnalyses(
  chunks: string[],
  analyses: Analysis[],
): Analysis {
  const words: Word[] = [];
  let base = 0;
  let chunkBase = 0;
  let allCloud = true;
  for (let i = 0; i < chunks.length; i++) {
    const a = analyses[i] ?? localAnalysis(chunks[i]!);
    if (a.source !== 'cloud') allCloud = false;
    const maxChunk = a.words.reduce(
      (m, w) => (w.chunk === null ? m : Math.max(m, w.chunk)),
      -1,
    );
    words.push(...offsetWords(a.words, base, chunkBase));
    base += chunks[i]!.length;
    chunkBase += maxChunk + 1;
  }
  return { words, source: allCloud ? 'cloud' : 'local' };
}

/** Local analysis for a (possibly long) paragraph, chunked at 800 chars. */
export function analyzeParagraphLocal(text: string): Analysis {
  const chunks = splitChunks(text);
  return mergeChunkAnalyses(chunks, chunks.map(localAnalysis));
}

/**
 * Cloud analysis for a paragraph: per-chunk requests (deduped/cached).
 * A chunk whose cloud result is null falls back to its local analysis.
 */
export async function analyzeParagraphCloud(text: string): Promise<Analysis> {
  const chunks = splitChunks(text);
  const per = await Promise.all(
    chunks.map(async (c) => (await analyzeCloudCached(c)) ?? localAnalysis(c)),
  );
  return mergeChunkAnalyses(chunks, per);
}

/** Whole-paragraph cloud analysis if every chunk is already cached. */
export function getParagraphCloud(text: string): Analysis | undefined {
  const chunks = splitChunks(text);
  const per: Analysis[] = [];
  for (const c of chunks) {
    const hit = getCachedCloud(c);
    if (!hit) return undefined;
    per.push(hit);
  }
  return mergeChunkAnalyses(chunks, per);
}
