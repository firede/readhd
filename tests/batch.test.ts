import { beforeEach, describe, expect, it, vi } from 'vitest';
import { sendBatch, type QueueItem } from '../src/entrypoints/background';
import { providerConfigs, activeProvider } from '../src/lib/providers';
import type { Analysis } from '../src/lib/analysis';

const T = ['甲乙丙', '丁戊己', '庚辛壬'];

// item body for a text: one chunk with the whole text as a word
const okItem = (t: string) => [[[t, 'n']]];
const badItem = [[[ '错字', 'n']]];

function mockFetch(respond: (texts: string[], n: number) => unknown) {
  let calls: string[][] = [];
  vi.stubGlobal('fetch', async (_url: string, init: { body?: string }) => {
    const texts = JSON.parse(
      (JSON.parse(init.body!) as { messages: { role: string; content: string }[] })
        .messages[1]!.content,
    ) as string[];
    calls.push(texts);
    const items = respond(texts, calls.length);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [
          { message: { content: JSON.stringify(items) }, finish_reason: 'stop' },
        ],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      }),
      text: async () => '',
    };
  });
  return calls;
}

function mkBatch(texts: string[]) {
  const results: (Analysis | null)[] = [];
  const batch: QueueItem[] = texts.map((text, i) => ({
    text,
    resolve: (a) => (results[i] = a),
  }));
  return { batch, results };
}

describe('sendBatch failure isolation', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await providerConfigs.setValue({
      'custom-openai': {
        apiKey: 'k',
        baseUrl: 'http://mock.local',
        model: 'm',
      },
    });
    await activeProvider.setValue('custom-openai');
  });

  it('partial failure: bad item is retried split → solo → null', async () => {
    // '丁戊己' always fails validation (content mismatch)
    const calls = mockFetch((texts) =>
      texts.map((t) => (t === '丁戊己' ? badItem : okItem(t))),
    );
    const { batch, results } = mkBatch(T);
    await sendBatch(batch);
    expect(results[0]!.source).toBe('cloud');
    expect(results[1]).toBeNull();
    expect(results[2]!.source).toBe('cloud');
    // 1 full batch + 1 half/solo retry + 1 solo retry = 3 requests
    expect(calls.length).toBe(3);
    expect(calls[0]).toEqual(T);
    expect(calls[1]).toEqual(['丁戊己']);
    expect(calls[2]).toEqual(['丁戊己']);
  });

  it('whole-batch parse failure: halves, then solo', async () => {
    // only 庚辛壬 parses; everything else mismatches
    const calls = mockFetch((texts) =>
      texts.map((t) => (t === '庚辛壬' ? okItem(t) : badItem)),
    );
    const { batch, results } = mkBatch(T);
    await sendBatch(batch);
    expect(results[2]!.source).toBe('cloud');
    expect(results[0]).toBeNull();
    expect(results[1]).toBeNull();
    // round0: [0,1,2] fails → halves [0]... wait regroup of 2 failed → [ [0],[1] ]
    expect(calls.length).toBe(1 + 2 + 2);
    expect(calls[0]).toEqual(T);
  });

  it('HTTP error retries the identical batch', async () => {
    let n = 0;
    vi.stubGlobal('fetch', async () => {
      n++;
      return n < 3
        ? { ok: false, status: 500, text: async () => 'err' }
        : {
            ok: true,
            status: 200,
            json: async () => ({
              choices: [
                {
                  message: {
                    content: JSON.stringify(T.map(okItem)),
                  },
                  finish_reason: 'stop',
                },
              ],
              usage: {},
            }),
            text: async () => '',
          };
    });
    const { batch, results } = mkBatch(T);
    await sendBatch(batch);
    expect(results.every((r) => r?.source === 'cloud')).toBe(true);
    expect(n).toBe(3);
  });
});
