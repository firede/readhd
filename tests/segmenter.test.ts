import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browser } from 'wxt/browser';
import {
  getCachedCloud,
  mergeChunkSpans,
  segmentCloudCached,
  segmentParagraphCloud,
} from '../src/lib/segmenter';
import type { TokenSpan } from '../src/lib/segment-align';

const span = (t: string, s = 0): TokenSpan[] => [
  { start: s, end: s + t.length, text: t },
];

function mockSend(impl: (msg: unknown) => Promise<unknown> | unknown) {
  vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(
    impl as never,
  );
}

describe('segmentCloudCached', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('caches successful results', async () => {
    const send = vi.fn(async () => [span('ab')]);
    mockSend(send);
    const r1 = await segmentCloudCached('唯一文本一');
    expect(r1).toEqual([{ start: 0, end: 2, text: 'ab' }]);
    expect(getCachedCloud('唯一文本一')).toEqual(r1);
    const r2 = await segmentCloudCached('唯一文本一');
    expect(send).toHaveBeenCalledTimes(1);
    expect(r2).toEqual(r1);
  });

  it('dedupes in-flight requests', async () => {
    let resolveIt!: (v: unknown) => void;
    const send = vi.fn(() => new Promise((r) => (resolveIt = r)));
    mockSend(send);
    const p1 = segmentCloudCached('飞行中文本');
    const p2 = segmentCloudCached('飞行中文本');
    expect(send).toHaveBeenCalledTimes(1);
    resolveIt([span('xy')]);
    expect(await p1).toEqual(await p2);
  });

  it('does not cache failures; retry sends a new request', async () => {
    const send = vi
      .fn()
      .mockResolvedValueOnce([null])
      .mockResolvedValueOnce([span('ok')]);
    mockSend(send);
    expect(await segmentCloudCached('失败文本')).toBeNull();
    expect(getCachedCloud('失败文本')).toBeUndefined();
    const retry = await segmentCloudCached('失败文本');
    expect(send).toHaveBeenCalledTimes(2);
    expect(retry).toEqual([{ start: 0, end: 2, text: 'ok' }]);
  });

  it('returns null when sendMessage rejects', async () => {
    mockSend(() => Promise.reject(new Error('no sw')));
    expect(await segmentCloudCached('异常文本')).toBeNull();
  });
});

describe('mergeChunkSpans', () => {
  it('offsets chunk spans by chunk start', () => {
    const chunks = ['你好世界', '第二块'];
    const merged = mergeChunkSpans(chunks, [
      [
        { start: 0, end: 2, text: '你好' },
        { start: 2, end: 4, text: '世界' },
      ],
      [{ start: 0, end: 3, text: '第二块' }],
    ]);
    expect(merged.map((s) => [s.start, s.end, s.text])).toEqual([
      [0, 2, '你好'],
      [2, 4, '世界'],
      [4, 7, '第二块'],
    ]);
  });
});

describe('segmentParagraphCloud', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('falls back per-chunk to local spans on null', async () => {
    mockSend(async (msg) => {
      const texts = (msg as { texts: string[] }).texts;
      // succeed only for the first chunk of a >500-char paragraph
      return texts.map(() => null);
    });
    const long = '一'.repeat(600);
    const spans = await segmentParagraphCloud(long);
    // all-local fallback still covers the text contiguously
    expect(spans.length).toBeGreaterThan(0);
    expect(spans[0]!.start).toBe(0);
  });
});
