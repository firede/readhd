import { describe, expect, it } from 'vitest';
import {
  localAnalysis,
  parseAnalysisItem,
  parseAnalyzeResponse,
} from '../src/lib/analysis';

const ITEM = [
  [
    ['小明', 'n'],
    ['在', 'p'],
  ],
  [
    ['花盆', 'n'],
    ['里', 'n'],
  ],
];
const ORIG = '小明在花盆里';

describe('parseAnalysisItem', () => {
  it('parses valid chunks into words with pos/chunk/offsets', () => {
    const a = parseAnalysisItem(ORIG, ITEM);
    expect(a).not.toBeNull();
    expect(a!.source).toBe('cloud');
    expect(a!.words.map((w) => [w.text, w.pos, w.chunk])).toEqual([
      ['小明', 'n', 0],
      ['在', 'p', 0],
      ['花盆', 'n', 1],
      ['里', 'n', 1],
    ]);
    expect(a!.words[2]!.start).toBe(3);
  });

  it('unknown tag maps to x', () => {
    const a = parseAnalysisItem('你好', [[['你好', 'zz']]]);
    expect(a!.words[0]!.pos).toBe('x');
  });

  it('empty chunk -> null', () => {
    expect(parseAnalysisItem('你好', [[]])).toBeNull();
    expect(
      parseAnalysisItem('你好世界', [[['你好', 'n']], []]),
    ).toBeNull();
  });

  it('non-pair word -> null', () => {
    expect(parseAnalysisItem('你好', [[['你好']]])).toBeNull();
    expect(parseAnalysisItem('你好', [[['你好', 'n', 'extra']]])).toBeNull();
    expect(parseAnalysisItem('你好', [[['你好', 1]]])).toBeNull();
  });

  it('text mismatch -> null', () => {
    expect(parseAnalysisItem(ORIG, ITEM.slice(0, 1))).toBeNull();
    expect(
      parseAnalysisItem(ORIG, [[['小明', 'n'], ['在', 'p'], ['公园', 'n']]]),
    ).toBeNull();
  });

  it('handles whitespace in original', () => {
    const a = parseAnalysisItem('我用 iPhone 15 拍照', [
      [
        ['我', 'n'],
        ['用', 'v'],
      ],
      [['iPhone 15', 'x']],
      [['拍照', 'v']],
    ]);
    expect(a).not.toBeNull();
    expect(a!.words[2]!.text).toBe('iPhone 15');
    expect(a!.words[2]!.start).toBe(3);
  });
});

describe('parseAnalyzeResponse', () => {
  it('outer length mismatch -> content-matched items, unmatched null', () => {
    const body = {
      content: [{ type: 'text', text: JSON.stringify([ITEM]) }],
    };
    const r = parseAnalyzeResponse([ORIG, '另一段'], body);
    expect(r[0]!.words.map((w) => w.text).join('')).toBe(ORIG);
    expect(r[1]).toBeNull();
  });

  it('extra duplicated item is ignored', () => {
    const body = {
      content: [{ type: 'text', text: JSON.stringify([ITEM, ITEM]) }],
    };
    const r = parseAnalyzeResponse([ORIG], body);
    expect(r[0]!.source).toBe('cloud');
    expect(r.length).toBe(1);
  });

  it('missing middle item: later items still matched', () => {
    const T1 = '他去学校';
    const I1 = [[['他', 'n'], ['去', 'v'], ['学校', 'n']]];
    const T3 = '天气很好';
    const I3 = [[['天气', 'n'], ['很', 'd'], ['好', 'a']]];
    const body = {
      content: [{ type: 'text', text: JSON.stringify([I1, I3]) }],
    };
    const r = parseAnalyzeResponse([T1, '中间一段没有返回', T3], body);
    expect(r[0]!.words.length).toBe(3);
    expect(r[1]).toBeNull();
    expect(r[2]!.words.length).toBe(3);
  });

  it('reordered items are matched by content', () => {
    const T1 = '他去学校';
    const I1 = [[['他', 'n'], ['去', 'v'], ['学校', 'n']]];
    const body = {
      content: [{ type: 'text', text: JSON.stringify([I1, ITEM]) }],
    };
    const r = parseAnalyzeResponse([ORIG, T1], body);
    expect(r[0]!.words.map((w) => w.text).join('')).toBe(ORIG);
    expect(r[1]!.words.map((w) => w.text).join('')).toBe(T1);
  });
  it('parses batch, ignores thinking blocks', () => {
    const body = {
      content: [
        { type: 'thinking', thinking: 'noise [[[' },
        { type: 'text', text: '前缀 ```json\n' + JSON.stringify([ITEM]) + '\n``` 后缀' },
      ],
    };
    const [a] = parseAnalyzeResponse([ORIG], body);
    expect(a!.words.length).toBe(4);
  });

  it('salvages responses truncated mid-array (missing trailing brackets)', () => {
    const full = JSON.stringify([ITEM]);
    const truncated = full.slice(0, full.lastIndexOf(']') - 1); // drop last 2 ]
    const body = { content: [{ type: 'text', text: truncated }] };
    const [a] = parseAnalyzeResponse([ORIG], body);
    expect(a).not.toBeNull();
    expect(a!.words.map((w) => w.text)).toEqual(['小明', '在', '花盆', '里']);
  });
});

describe('localAnalysis', () => {
  it('produces words with null pos/chunk', () => {
    const a = localAnalysis('小明去学校。');
    expect(a.source).toBe('local');
    expect(a.words.every((w) => w.pos === null && w.chunk === null)).toBe(true);
    expect(a.words.map((w) => w.text).join('')).toBe('小明去学校。');
  });
});
