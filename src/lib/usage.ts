// Pure usage-record helpers: ring-buffer append, daily rollup, pruning,
// and range summaries. Persistence lives in the background script.

export interface UsageEntry {
  ts: number;
  providerId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  ms: number;
  ok: boolean;
  status?: number;
  error?: string;
  paragraphs: number;
  chars: number;
}

export interface ModelDayStat {
  requests: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
}

export type UsageDaily = Record<string, Record<string, ModelDayStat>>;

export const LOG_MAX = 1000;
export const DAILY_MAX_DAYS = 180;

/** Local-time YYYY-MM-DD for a timestamp. */
export function dayKey(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function appendLog(log: UsageEntry[], e: UsageEntry): UsageEntry[] {
  const out = [...log, e];
  return out.length > LOG_MAX ? out.slice(out.length - LOG_MAX) : out;
}

export function rollupDay(daily: UsageDaily, e: UsageEntry): UsageDaily {
  const day = dayKey(e.ts);
  const byModel = daily[day] ?? {};
  const cur = byModel[e.model] ?? {
    requests: 0,
    failures: 0,
    inputTokens: 0,
    outputTokens: 0,
  };
  return {
    ...daily,
    [day]: {
      ...byModel,
      [e.model]: {
        requests: cur.requests + 1,
        failures: cur.failures + (e.ok ? 0 : 1),
        inputTokens: cur.inputTokens + e.inputTokens,
        outputTokens: cur.outputTokens + e.outputTokens,
      },
    },
  };
}

/** Drop days older than the newest 180 by calendar order. */
export function pruneDaily(daily: UsageDaily): UsageDaily {
  const days = Object.keys(daily).sort();
  if (days.length <= DAILY_MAX_DAYS) return daily;
  const drop = new Set(days.slice(0, days.length - DAILY_MAX_DAYS));
  return Object.fromEntries(
    Object.entries(daily).filter(([d]) => !drop.has(d)),
  );
}

export type UsageRange = 'today' | '7d' | '30d';

function rangeDays(range: UsageRange, now: number): string[] {
  const n = range === 'today' ? 1 : range === '7d' ? 7 : 30;
  const out: string[] = [];
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  for (let i = 0; i < n; i++) {
    out.push(dayKey(d.getTime()));
    d.setDate(d.getDate() - 1);
  }
  return out;
}

export function summarize(
  daily: UsageDaily,
  range: UsageRange,
  now: number,
): {
  requests: number;
  failures: number;
  inputTokens: number;
  outputTokens: number;
  models: {
    model: string;
    requests: number;
    failures: number;
    inputTokens: number;
    outputTokens: number;
  }[];
} {
  const days = new Set(rangeDays(range, now));
  const models = new Map<
    string,
    { requests: number; failures: number; inputTokens: number; outputTokens: number }
  >();
  for (const [day, byModel] of Object.entries(daily)) {
    if (!days.has(day)) continue;
    for (const [model, s] of Object.entries(byModel)) {
      const cur =
        models.get(model) ??
        { requests: 0, failures: 0, inputTokens: 0, outputTokens: 0 };
      cur.requests += s.requests;
      cur.failures += s.failures;
      cur.inputTokens += s.inputTokens;
      cur.outputTokens += s.outputTokens;
      models.set(model, cur);
    }
  }
  const rows = [...models.entries()].map(([model, s]) => ({ model, ...s }));
  rows.sort((a, b) => b.requests - a.requests);
  return {
    requests: rows.reduce((n, r) => n + r.requests, 0),
    failures: rows.reduce((n, r) => n + r.failures, 0),
    inputTokens: rows.reduce((n, r) => n + r.inputTokens, 0),
    outputTokens: rows.reduce((n, r) => n + r.outputTokens, 0),
    models: rows,
  };
}
