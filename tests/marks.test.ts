import { describe, expect, it } from 'vitest';
import { planGaps, planMarks } from '../src/lib/marks';
import type { Word } from '../src/lib/analysis';

function w(text: string, start: number, pos: string | null, chunk: number | null): Word {
  return { start, end: start + text.length, text, pos: pos as Word['pos'], chunk };
}

// 小明在花盆里种下三颗豆子。  (cloud-style chunks)
const CLOUD_WORDS: Word[] = [
  w('小明', 0, 'n', 0),
  w('在', 2, 'p', 1),
  w('花盆', 3, 'n', 1),
  w('里', 5, 'n', 1),
  w('种下', 6, 'v', 2),
  w('了', 8, 'u', 2),
  w('三颗', 9, 'm', 2),
  w('豆子', 11, 'n', 2),
  w('。', 13, 'w', 3),
];
const LOCAL_WORDS: Word[] = CLOUD_WORDS.map((x) => ({ ...x, pos: null, chunk: null }));

describe('planMarks', () => {
  it('word alternation skips punctuation', () => {
    const marks = planMarks(CLOUD_WORDS, {
      alternate: true,
      unit: 'word',
      fade: false,
    });
    const texts = CLOUD_WORDS.map((x) => x.text);
    const got = marks.map((m) => [texts.find((t, i) => CLOUD_WORDS[i]!.start === m.start), m.cls]);
    expect(marks.length).toBe(8); // all except 。
    expect(marks.map((m) => m.cls)).toEqual(['a', 'b', 'a', 'b', 'a', 'b', 'a', 'b']);
    expect(marks.find((m) => m.start === 13)).toBeUndefined();
  });

  it('chunk alternation: same chunk shares class, alternates per chunk', () => {
    const marks = planMarks(CLOUD_WORDS, {
      alternate: true,
      unit: 'chunk',
      fade: false,
    });
    // chunk0 [小明]=a, chunk1 [在,花盆,里]=b, chunk2 [种下,了,三颗,豆子]=a, chunk3 。 skipped
    expect(marks.map((m) => [m.start, m.cls])).toEqual([
      [0, 'a'],
      [2, 'b'],
      [3, 'b'],
      [5, 'b'],
      [6, 'a'],
      [8, 'a'],
      [9, 'a'],
      [11, 'a'],
    ]);
  });

  it('chunk mode falls back to word alternation when chunk is null', () => {
    const marks = planMarks(LOCAL_WORDS, {
      alternate: true,
      unit: 'chunk',
      fade: false,
    });
    expect(marks[0]!.cls).toBe('a');
    expect(marks[1]!.cls).toBe('b');
    expect(marks.length).toBe(8);
  });

  it('fade marks u/y words as f and does not consume alternation', () => {
    const marks = planMarks(CLOUD_WORDS, {
      alternate: true,
      unit: 'word',
      fade: true,
    });
    const le = marks.find((m) => m.start === 8)!; // 了
    expect(le.cls).toBe('f');
    // non-faded word-like words: 小明 在 花盆 里 种下 三颗 豆子 = 7 → a,b,a,b,a,b,a
    const nonF = marks.filter((m) => m.cls !== 'f');
    expect(nonF.map((m) => m.cls)).toEqual(['a', 'b', 'a', 'b', 'a', 'b', 'a']);
    // chunk-mode: 了 faded but chunk 2 keeps its color for other words
    const cm = planMarks(CLOUD_WORDS, { alternate: true, unit: 'chunk', fade: true });
    const chunk2 = cm.filter((m) => [6, 9, 11].includes(m.start));
    expect(chunk2.every((m) => m.cls === 'a')).toBe(true);
  });

  it('does not fade p/c words', () => {
    const words = [
      w('因为', 0, 'c', 0),
      w('下雨', 2, 'v', 0),
      w('所以', 4, 'c', 1),
      w('推迟', 6, 'v', 1),
    ];
    const marks = planMarks(words, { alternate: true, unit: 'word', fade: true });
    expect(marks.map((m) => m.cls)).toEqual(['a', 'b', 'a', 'b']);
  });

  it('alternate:false + fade gives only f marks', () => {
    const marks = planMarks(CLOUD_WORDS, {
      alternate: false,
      unit: 'word',
      fade: true,
    });
    expect(marks).toEqual([{ start: 8, end: 9, cls: 'f' }]);
  });

  it('alternate:false + no fade gives no marks', () => {
    expect(
      planMarks(CLOUD_WORDS, { alternate: false, unit: 'word', fade: false }),
    ).toEqual([]);
  });
});

describe('planGaps', () => {
  it('word mode: every word-like word followed by another gets a gap', () => {
    // indices: 0小明 1在 2花盆 3里 4种下 5了 6三颗 7豆子 8。
    const g = planGaps(CLOUD_WORDS, 'word');
    expect([...g].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    // 豆子(7) is followed by punctuation → no gap; 。 is not word-like
  });

  it('word mode never gaps before punctuation', () => {
    const words = [w('你好', 0, 'n', 0), w('，', 4, 'w', 0), w('世界', 5, 'n', 0)];
    expect(planGaps(words, 'word').has(0)).toBe(false);
    expect(planGaps(words, 'word').has(2)).toBe(false);
  });

  it('word mode skips whitespace between words', () => {
    const words = [
      w('你好', 0, 'n', 0),
      w(' ', 4, null, 0),
      w('世界', 5, 'n', 0),
    ];
    expect(planGaps(words, 'word').has(0)).toBe(true);
  });

  it('chunk mode: gap at last word-like word of each chunk', () => {
    const g = planGaps(CLOUD_WORDS, 'chunk');
    // chunk0 last: 小明(0); chunk1 last: 里(3); chunk2 last: 豆子(7) — next is
    // punctuation in chunk3 → no gap. chunk3 has no word-like word.
    expect([...g].sort((a, b) => a - b)).toEqual([0, 3]);
  });

  it('chunk mode: no gap across punctuation even when chunks differ', () => {
    const words = [
      w('你好', 0, 'n', 0),
      w('，', 2, 'w', 1),
      w('世界', 3, 'n', 2),
    ];
    expect(planGaps(words, 'chunk').size).toBe(0);
  });

  it('chunk mode: missing chunk info → no gaps', () => {
    expect(planGaps(LOCAL_WORDS, 'chunk').size).toBe(0);
  });

  it('none mode → empty', () => {
    expect(planGaps(CLOUD_WORDS, 'none').size).toBe(0);
  });
});
