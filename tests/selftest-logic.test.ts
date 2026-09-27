import { describe, expect, it } from 'vitest';
import {
  aggregate,
  selectSession,
  type SelftestResultLike,
} from '../src/lib/selftest-logic';

const P = (id: string) => ({ id });
const passages = ['a', 'b', 'c', 'd'].map(P);
const seq = (vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length]!;
};

describe('selectSession', () => {
  it('picks the two least-used passages', () => {
    const history: SelftestResultLike[] = [
      { passageId: 'a', condition: 'on', ms: 1000, hanChars: 10, correct: 1 },
      { passageId: 'a', condition: 'off', ms: 1000, hanChars: 10, correct: 1 },
      { passageId: 'b', condition: 'on', ms: 1000, hanChars: 10, correct: 1 },
    ];
    const s = selectSession(passages, history, seq([0, 0, 0]));
    const ids = s.map((x) => x.passageId).sort();
    expect(ids).toEqual(['c', 'd']);
  });

  it('assigns one on and one off', () => {
    const s = selectSession(passages, [], seq([0.1, 0.2, 0.9]));
    expect(s.map((x) => x.condition).sort()).toEqual(['off', 'on']);
    expect(s.length).toBe(2);
  });

  it('respects rng for condition assignment', () => {
    const a = selectSession(passages, [], seq([0.1, 0.2, 0.3, 0.1]));
    const b = selectSession(passages, [], seq([0.1, 0.2, 0.3, 0.9]));
    expect(a[0]!.condition).not.toBe(b[0]!.condition);
  });
});

describe('aggregate', () => {
  const rec = (
    condition: 'on' | 'off',
    ms: number,
    hanChars: number,
    correct: number,
  ): SelftestResultLike => ({
    passageId: 'x',
    condition,
    ms,
    hanChars,
    correct,
  });

  it('computes median cpm and mean accuracy per condition', () => {
    const rs = [
      rec('on', 60000, 100, 3), // 100 cpm, 100%
      rec('on', 60000, 200, 0), // 200 cpm, 0%
      rec('off', 60000, 50, 3), // 50 cpm
      rec('off', 60000, 150, 3),
      rec('off', 60000, 100, 3),
    ];
    const agg = aggregate(rs);
    expect(agg.on.count).toBe(2);
    expect(agg.on.medianCpm).toBe(150);
    expect(agg.on.meanAccuracy).toBe(50);
    expect(agg.off.medianCpm).toBe(100);
    expect(agg.enough).toBe(false); // off=3 but on=2
    expect(agg.speedDiffPct).toBeNull();
  });

  it('reports speed/accuracy diff when both >= 3', () => {
    const rs = [
      rec('on', 30000, 100, 3), // 200 cpm
      rec('on', 30000, 100, 2),
      rec('on', 30000, 100, 1),
      rec('off', 60000, 100, 3), // 100 cpm
      rec('off', 60000, 100, 3),
      rec('off', 60000, 100, 3),
    ];
    const agg = aggregate(rs);
    expect(agg.enough).toBe(true);
    expect(agg.speedDiffPct).toBeCloseTo(100);
    // on mean acc = (100 + 66.67 + 33.33) / 3 = 66.67; off = 100
    expect(agg.accDiffPts).toBeCloseTo(-33.33, 1);
  });

  it('empty results', () => {
    const agg = aggregate([]);
    expect(agg.enough).toBe(false);
    expect(agg.on.count).toBe(0);
    expect(agg.on.medianCpm).toBeNull();
  });
});
