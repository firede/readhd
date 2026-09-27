import { describe, expect, it } from 'vitest';
import {
  alignTokens,
  extractJsonArray,
  parseSegmentResponse,
  validateBatch,
} from '../src/lib/segment-align';

describe('alignTokens', () => {
  it('exact match maps boundaries onto original', () => {
    const spans = alignTokens('小明在花盆里种下三颗豆子。', [
      '小明',
      '在',
      '花盆',
      '里',
      '种下',
      '三',
      '颗',
      '豆子',
      '。',
    ]);
    expect(spans).not.toBeNull();
    expect(spans!.map((s) => s.text).join('')).toBe('小明在花盆里种下三颗豆子。');
    expect(spans![0]).toEqual({ start: 0, end: 2, text: '小明' });
    expect(spans!.at(-1)).toEqual({ start: 12, end: 13, text: '。' });
  });

  it('preserves original whitespace inside spans', () => {
    const original = '我用 iPhone 15 拍照';
    const spans = alignTokens(original, ['我', '用', 'iPhone 15', '拍照']);
    // tokens strip to "我用iPhone15拍照" which matches stripped original
    expect(spans).not.toBeNull();
    expect(spans!.map((s) => s.text)).toEqual([
      '我',
      '用',
      'iPhone 15',
      '拍照',
    ]);
  });

  it('model dropping whitespace still aligns', () => {
    const spans = alignTokens('你好 世界', ['你好', '世界']);
    expect(spans).not.toBeNull();
    expect(spans![0]).toEqual({ start: 0, end: 2, text: '你好' });
    expect(spans![1]).toEqual({ start: 3, end: 5, text: '世界' });
  });

  it('mismatched tokens return null', () => {
    expect(alignTokens('小明去学校', ['小明', '去', '公园'])).toBeNull();
  });

  it('non-string tokens return null', () => {
    expect(alignTokens('abc', [1, 2])).toBeNull();
    expect(alignTokens('abc', 'abc')).toBeNull();
  });

  it('uses UTF-16 offsets across astral chars (emoji)', () => {
    const original = '我爱😀小明';
    const spans = alignTokens(original, ['我爱', '😀', '小明']);
    expect(spans).not.toBeNull();
    expect(spans![1]).toEqual({ start: 2, end: 4, text: '😀' });
    expect(spans![2]).toEqual({ start: 4, end: 6, text: '小明' });
    for (const s of spans!)
      expect(original.slice(s.start, s.end)).toBe(s.text);
  });

  it('uses UTF-16 offsets across CJK Ext-B chars', () => {
    const original = '𠮷野家很好吃';
    const spans = alignTokens(original, ['𠮷野家', '很', '好吃']);
    expect(spans).not.toBeNull();
    expect(spans![0]).toEqual({ start: 0, end: 4, text: '𠮷野家' });
    expect(spans![1]).toEqual({ start: 4, end: 5, text: '很' });
    expect(spans![2]).toEqual({ start: 5, end: 7, text: '好吃' });
    for (const s of spans!)
      expect(original.slice(s.start, s.end)).toBe(s.text);
  });
});

describe('extractJsonArray', () => {
  it('strips garbage text and code fences around JSON', () => {
    const text = '好的，结果如下：\n```json\n[["a","b"],["c"]]\n```\n希望有帮助';
    expect(extractJsonArray(text)).toEqual([['a', 'b'], ['c']]);
  });
  it('returns null for unparseable', () => {
    expect(extractJsonArray('no array here')).toBeNull();
    expect(extractJsonArray('[broken')).toBeNull();
  });
});

describe('validateBatch', () => {
  it('wrong array length -> all null', () => {
    const res = validateBatch(['你好', '世界'], [['你', '好']]);
    expect(res).toEqual([null, null]);
  });
  it('per-item failure only nulls that item', () => {
    const res = validateBatch(['你好', '世界'], [['你', '好'], ['坏', '词']]);
    expect(res[0]).not.toBeNull();
    expect(res[1]).toBeNull();
  });
});

describe('parseSegmentResponse', () => {
  it('concatenates text blocks, ignores thinking', () => {
    const body = {
      content: [
        { type: 'thinking', thinking: 'let me think [["bad"]]' },
        { type: 'text', text: '```json\n[["小明","在"],["猫"]] ' },
        { type: 'text', text: '\n```' },
      ],
    };
    const res = parseSegmentResponse(['小明在', '猫'], body);
    expect(res[0]!.map((s) => s.text)).toEqual(['小明', '在']);
    expect(res[1]!.map((s) => s.text)).toEqual(['猫']);
  });
  it('returns all null when no content array', () => {
    expect(parseSegmentResponse(['a'], {})).toEqual([null]);
  });
});
