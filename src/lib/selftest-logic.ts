// Pure self-test logic: passage selection, condition assignment, aggregation.

export interface PassageMeta {
  id: string;
}

export interface SessionItem {
  passageId: string;
  condition: 'on' | 'off';
}

export interface SelftestResultLike {
  passageId: string;
  condition: 'on' | 'off';
  ms: number;
  hanChars: number;
  correct: number;
}

export type Rng = () => number;

function shuffle<T>(arr: T[], rng: Rng): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = a[i]!;
    a[i] = a[j]!;
    a[j] = tmp;
  }
  return a;
}

/**
 * Pick the 2 passages used least often so far (ties broken randomly),
 * randomly assign one to "on" and the other to "off", random order.
 */
export function selectSession(
  passages: PassageMeta[],
  history: SelftestResultLike[],
  rng: Rng = Math.random,
): SessionItem[] {
  const counts = new Map<string, number>();
  for (const p of passages) counts.set(p.id, 0);
  for (const r of history) {
    counts.set(r.passageId, (counts.get(r.passageId) ?? 0) + 1);
  }
  const sorted = shuffle(passages, rng).sort(
    (a, b) => (counts.get(a.id) ?? 0) - (counts.get(b.id) ?? 0),
  );
  const picked = sorted.slice(0, 2);
  const onFirst = rng() < 0.5;
  return picked.map((p, i) => ({
    passageId: p.id,
    condition: (i === 0) === onFirst ? 'on' : 'off',
  }));
}

export interface ConditionStats {
  count: number;
  /** Median Han chars per minute, or null when empty. */
  medianCpm: number | null;
  /** Mean accuracy in %, or null when empty. */
  meanAccuracy: number | null;
}

export interface AggregateResult {
  on: ConditionStats;
  off: ConditionStats;
  /** True when both conditions have >= 3 passages. */
  enough: boolean;
  /** 'on' faster % vs 'off' (positive = on is faster); null unless enough. */
  speedDiffPct: number | null;
  /** accuracy difference in percentage points (on - off); null unless enough. */
  accDiffPts: number | null;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function stats(rs: SelftestResultLike[]): ConditionStats {
  if (rs.length === 0) {
    return { count: 0, medianCpm: null, meanAccuracy: null };
  }
  const cpms = rs.map((r) => (r.ms > 0 ? r.hanChars / (r.ms / 60000) : 0));
  const accs = rs.map((r) => (r.correct / 3) * 100);
  return {
    count: rs.length,
    medianCpm: median(cpms),
    meanAccuracy: accs.reduce((a, b) => a + b, 0) / accs.length,
  };
}

export function aggregate(results: SelftestResultLike[]): AggregateResult {
  const on = stats(results.filter((r) => r.condition === 'on'));
  const off = stats(results.filter((r) => r.condition === 'off'));
  const enough = on.count >= 3 && off.count >= 3;
  let speedDiffPct: number | null = null;
  let accDiffPts: number | null = null;
  if (enough && on.medianCpm != null && off.medianCpm != null && off.medianCpm > 0) {
    speedDiffPct = ((on.medianCpm - off.medianCpm) / off.medianCpm) * 100;
    accDiffPts = (on.meanAccuracy ?? 0) - (off.meanAccuracy ?? 0);
  }
  return { on, off, enough, speedDiffPct, accDiffPts };
}
