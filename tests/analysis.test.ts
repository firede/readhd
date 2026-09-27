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
  it('outer length mismatch -> all null', () => {
    const body = {
      content: [{ type: 'text', text: JSON.stringify([ITEM]) }],
    };
    expect(parseAnalyzeResponse([ORIG, '另一段'], body)).toEqual([null, null]);
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
