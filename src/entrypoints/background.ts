import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { ANALYZE_SYSTEM_PROMPT } from '../lib/analyze-prompt';
import { parseAnalysisText, type Analysis } from '../lib/analysis';
import { extractJsonArray } from '../lib/segment-align';
import { buildRequest, parseResponse, describeError } from '../lib/llm';
import { resolveProvider, type ResolvedProvider } from '../lib/providers';
import {
  appendLog,
  rollupDay,
  pruneDaily,
  type UsageEntry,
} from '../lib/usage';
import { usageLog, usageDaily, lastError } from '../lib/settings';

const DEBOUNCE_MS = 150;
const MAX_BATCH_CHARS = 600;
const MAX_BATCH_ITEMS = 8;
const MAX_CONCURRENT = 2;
const TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const MAX_TOKENS = 16000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const queue: QueueItem[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = 0;
const resultCache = new Map<string, Analysis>();
const RESULT_CACHE_MAX = 3000;

function resultCacheSet(text: string, a: Analysis): void {
  if (resultCache.has(text)) resultCache.delete(text);
  if (resultCache.size >= RESULT_CACHE_MAX) {
    const oldest = resultCache.keys().next().value;
    if (oldest !== undefined) resultCache.delete(oldest);
  }
  resultCache.set(text, a);
}

// Serialize usage/lastError writes to avoid lost updates.
let writeChain: Promise<void> = Promise.resolve();
function persistWrite(fn: () => Promise<void>): void {
  writeChain = writeChain.then(fn, fn);
}

function recordUsage(e: UsageEntry): void {
  persistWrite(async () => {
    const [log, daily] = await Promise.all([
      usageLog.getValue(),
      usageDaily.getValue(),
    ]);
    await Promise.all([
      usageLog.setValue(appendLog(log, e)),
      usageDaily.setValue(pruneDaily(rollupDay(daily, e))),
    ]);
  });
}

function setLastError(v: { ts: number; providerId: string; message: string } | null): void {
  persistWrite(() => lastError.setValue(v));
}

async function callOnce(
  p: ResolvedProvider,
  user: string,
): Promise<{
  ok: boolean;
  text?: string;
  inputTokens?: number;
  outputTokens?: number;
  truncated?: boolean;
  status?: number;
  error?: string;
  ms: number;
}> {
  const started = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const { url, init } = buildRequest(p.preset.protocol, {
      baseUrl: p.baseUrl,
      model: p.model,
      apiKey: p.apiKey,
      system: ANALYZE_SYSTEM_PROMPT,
      user,
      maxTokens: MAX_TOKENS,
      extraBody: p.preset.extraBody,
    });
    const resp = await fetch(url, { ...init, signal: controller.signal });
    const ms = Date.now() - started;
    if (!resp.ok) {
      return {
        ok: false,
        ms,
        status: resp.status,
        error: describeError(resp.status, await resp.text().catch(() => '')),
      };
    }
    const r = parseResponse(p.preset.protocol, await resp.json());
    return { ok: true, ms, ...r };
  } catch {
    return { ok: false, ms: Date.now() - started, error: describeError(null) };
  } finally {
    clearTimeout(timeout);
  }
}

function enqueue(text: string): Promise<Analysis | null> {
  const cached = resultCache.get(text);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve) => {
    queue.push({ text, resolve });
    if (!timer) {
      timer = setTimeout(() => {
        timer = null;
        void drain();
      }, DEBOUNCE_MS);
    }
  });
}

async function drain(): Promise<void> {
  while (inFlight < MAX_CONCURRENT && queue.length > 0) {
    const batch: QueueItem[] = [];
    let chars = 0;
    while (queue.length > 0) {
      const next = queue[0];
      if (!next) break;
      if (
        batch.length > 0 &&
        (chars + next.text.length > MAX_BATCH_CHARS ||
          batch.length >= MAX_BATCH_ITEMS)
      )
        break;
      queue.shift();
      batch.push(next);
      chars += next.text.length;
    }
    if (batch.length === 0) break;
    inFlight++;
    void sendBatch(batch)
      .catch(() => {
        for (const item of batch) item.resolve(null);
      })
      .finally(() => {
        inFlight--;
        if (queue.length > 0 && !timer) void drain();
      });
  }
}

/** Parse-failure retry shape: round 0 → halves, round ≥1 → solo items. */
function regroup(indices: number[], round: number): number[][] {
  if (indices.length <= 1 || round >= 1) return indices.map((i) => [i]);
  const mid = Math.ceil(indices.length / 2);
  return [indices.slice(0, mid), indices.slice(mid)];
}

export interface QueueItem {
  text: string;
  resolve: (analysis: Analysis | null) => void;
}

// exported for tests
export async function sendBatch(batch: QueueItem[]): Promise<void> {
  const p = await resolveProvider();
  if (!p.configured) {
    for (const item of batch) item.resolve(null);
    return;
  }
  // Failure isolation: HTTP errors retry the same group; parse/validation
  // failures are resent split (halves, then solo). Max 3 attempts per item.
  const pending = new Set(batch.map((_, i) => i));
  let groups: number[][] = [batch.map((_, i) => i)];
  let lastMsg = '多次重试后仍失败';
  for (let round = 0; round < MAX_ATTEMPTS && groups.length > 0; round++) {
    if (round > 0) await sleep(600 * round);
    const next: number[][] = [];
    for (const g of groups) {
      const gTexts = g.map((i) => batch[i]!.text);
      const gChars = gTexts.reduce((n, t) => n + t.length, 0);
      const r = await callOnce(p, JSON.stringify(gTexts));
      let parsed: (Analysis | null)[] | null = null;
      let parseNote: string | undefined;
      if (r.ok) {
        parsed = parseAnalysisText(gTexts, r.text ?? '');
        const nulls = parsed.filter((x) => x === null).length;
        if (nulls === gTexts.length) {
          // The whole response was unusable; classify why for the usage log.
          parsed = null;
          if (r.truncated) {
            parseNote = '输出被截断';
          } else {
            const arr = extractJsonArray(r.text ?? '');
            parseNote =
              arr === null
                ? '返回格式无法解析'
                : arr.length !== gTexts.length
                  ? `返回条目数不符（${arr.length}/${gTexts.length}）`
                  : '分词结果与原文不一致';
          }
        } else if (nulls > 0) {
          parseNote = `${nulls}/${gTexts.length} 段未通过校验`;
        }
      }
      if (!r.ok && r.error) lastMsg = r.error;
      else if (r.ok && parsed === null) lastMsg = parseNote!;
      recordUsage({
        ts: Date.now(),
        providerId: p.preset.id,
        model: p.model,
        inputTokens: r.inputTokens ?? 0,
        outputTokens: r.outputTokens ?? 0,
        ms: r.ms,
        ok: r.ok && parsed !== null,
        status: r.status,
        error: r.ok ? parseNote : r.error,
        paragraphs: g.length,
        chars: gChars,
      });
      if (parsed) {
        const failed: number[] = [];
        g.forEach((gi, j) => {
          const a = parsed![j] ?? null;
          if (a) {
            resultCacheSet(batch[gi]!.text, a);
            batch[gi]!.resolve(a);
            pending.delete(gi);
          } else {
            failed.push(gi);
          }
        });
        if (failed.length) next.push(...regroup(failed, round));
      } else if (!r.ok) {
        next.push(g); // network/HTTP error → identical retry
      } else {
        next.push(...regroup(g, round)); // parse failure → split
      }
    }
    groups = next;
  }
  if (pending.size === 0) {
    setLastError(null);
  } else {
    setLastError({
      ts: Date.now(),
      providerId: p.preset.id,
      message: lastMsg,
    });
    for (const i of pending) batch[i]!.resolve(null);
  }
}

/** One-shot connection test used by the options page (no queue/cache). */
async function testConnection(input: {
  providerId?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
}): Promise<unknown> {
  const p = await resolveProvider(input.providerId);
  const eff: ResolvedProvider = {
    ...p,
    apiKey: (input.apiKey || p.apiKey).trim(),
    baseUrl: (input.baseUrl || p.baseUrl).trim(),
    model: (input.model || p.model).trim(),
    configured: true,
  };
  if (!eff.apiKey || !eff.baseUrl || !eff.model) {
    return { ok: false, error: '请填写完整的接口地址、模型名和 API Key' };
  }
  const sample = '每天清晨，可爱的小狐狸都会去溪边喝水。';
  const r = await callOnce(eff, JSON.stringify([sample]));
  if (!r.ok) return { ok: false, ms: r.ms, error: r.error };
  const parsed = parseAnalysisText([sample], r.text ?? '')[0];
  if (!parsed) return { ok: false, ms: r.ms, error: '返回内容无法解析' };
  return {
    ok: true,
    ms: r.ms,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    truncated: r.truncated,
    words: parsed.words,
  };
}

export default defineBackground(() => {
  // API keys and usage live in local storage — keep them unreadable from
  // content-script (untrusted) contexts.
  void browser.storage.local
    .setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
    .catch(() => {});

  browser.runtime.onInstalled.addListener((d) => {
    if (d.reason === 'install') {
      void browser.tabs.create({
        url: browser.runtime.getURL('/options.html#welcome'),
      });
    }
  });

  browser.commands?.onCommand.addListener((cmd) => {
    if (cmd !== 'toggle-reader') return;
    void browser.tabs
      .query({ active: true, currentWindow: true })
      .then((tabs) => {
        const id = tabs[0]?.id;
        if (id != null) {
          return browser.tabs.sendMessage(id, { type: 'toggleReader' });
        }
      })
      .catch(() => {});
  });
  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'analyze' && Array.isArray(msg.texts)) {
      const texts = msg.texts as string[];
      Promise.all(texts.map((t) => enqueue(t))).then(sendResponse);
      return true;
    }
    if (msg?.type === 'analyzeStatus') {
      resolveProvider()
        .then((p) =>
          sendResponse({
            configured: p.configured,
            providerName: p.preset.name,
            model: p.model,
          }),
        )
        .catch(() => sendResponse({ configured: false }));
      return true;
    }
    if (msg?.type === 'testConnection') {
      testConnection(msg).then(sendResponse, () =>
        sendResponse({ ok: false, error: '网络连接失败或超时' }),
      );
      return true;
    }
    return undefined;
  });
});
