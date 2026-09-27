import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import {
  analyzeCloudCached,
  analyzeParagraphCloud,
  getCachedCloud,
  mergeChunkAnalyses,
} from '../src/lib/analyzer';
import { localAnalysis, type Analysis } from '../src/lib/analysis';

const ana = (text: string, chunks: number[][]): Analysis => ({
  source: 'cloud',
  words: chunks.flatMap((idxs, ci) =>
    idxs.map((i) => ({
      start: i,
      end: i + 1,
      text: text[i]!,
      pos: 'n' as const,
      chunk: ci,
    })),
  ),
});

function mockSend(impl: (msg: unknown) => Promise<unknown> | unknown) {
  vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(impl as never);
}

describe('analyzeCloudCached', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('caches successful results and dedupes in-flight', async () => {
    let calls = 0;
    mockSend(async () => {
      calls++;
      return [ana('缓存文本', [[0, 1, 2, 3]])];
    });
    const r1 = await analyzeCloudCached('缓存文本甲');
    expect(r1!.source).toBe('cloud');
    expect(getCachedCloud('缓存文本甲')).toBe(r1);
    await analyzeCloudCached('缓存文本甲');
    expect(calls).toBe(1);

    let resolveIt!: (v: unknown) => void;
    mockSend(() => new Promise((r) => (resolveIt = r)));
    const p1 = analyzeCloudCached('飞行中文本乙');
    const p2 = analyzeCloudCached('飞行中文本乙');
    resolveIt([ana('x', [[0]])]);
    expect((await p1)!.source).toBe('cloud');
    expect(await p2).toEqual(await p1);
  });

  it('does not cache failures', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce([null])
      .mockResolvedValueOnce([ana('y', [[0]])]);
    mockSend(send);
    expect(await analyzeCloudCached('失败文本丙')).toBeNull();
    expect(getCachedCloud('失败文本丙')).toBeUndefined();
    expect(await analyzeCloudCached('失败文本丙')).not.toBeNull();
    expect(send).toHaveBeenCalledTimes(2);
  });
});

describe('mergeChunkAnalyses', () => {
  it('offsets word boundaries and renumbers chunk indices', () => {
    const merged = mergeChunkAnalyses(
      ['甲乙', '丙丁'],
      [ana('甲乙', [[0], [1]]), ana('丙丁', [[0], [1]])],
    );
    expect(merged.source).toBe('cloud');
    expect(
      merged.words.map((w) => [w.text, w.start, w.chunk]),
    ).toEqual([
      ['甲', 0, 0],
      ['乙', 1, 1],
      ['丙', 2, 2],
      ['丁', 3, 3],
    ]);
  });

  it('mixed local chunk keeps null chunks and marks source local', () => {
    const merged = mergeChunkAnalyses(
      ['甲乙', '丙丁'],
      [ana('甲乙', [[0], [1]]), localAnalysis('丙丁')],
    );
    expect(merged.source).toBe('local');
    const local = merged.words.filter((w) => w.chunk === null);
    expect(local.length).toBeGreaterThan(0);
    expect(local.every((w) => w.start >= 2)).toBe(true);
  });
});

describe('analyzeParagraphCloud', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('falls back per-chunk on null results', async () => {
    mockSend(async () => [null]);
    const a = await analyzeParagraphCloud('一'.repeat(900));
    expect(a.words.length).toBeGreaterThan(0);
    expect(a.words[0]!.start).toBe(0);
  });
});
