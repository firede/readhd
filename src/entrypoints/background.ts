import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { ANALYZE_SYSTEM_PROMPT } from '../lib/analyze-prompt';
import { parseAnalyzeResponse, type Analysis } from '../lib/analysis';
import { apiBase, apiKey, model } from '../lib/settings';

const DEBOUNCE_MS = 150;
const MAX_BATCH_CHARS = 800;
const MAX_CONCURRENT = 2;
const TIMEOUT_MS = 30_000;

interface QueueItem {
  text: string;
  resolve: (analysis: Analysis | null) => void;
}

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

async function resolveApiKey(): Promise<string> {
  const stored = (await apiKey.getValue()).trim();
  if (stored) return stored;
  // Dev-only fallback injected by wxt.config (empty string in production builds).
  return (process.env.MINIMAX_API_KEY ?? '').trim();
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
      if (batch.length > 0 && chars + next.text.length > MAX_BATCH_CHARS) break;
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

const MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function sendBatch(batch: QueueItem[]): Promise<void> {
  const texts = batch.map((b) => b.text);
  const key = await resolveApiKey();
  if (!key) {
    for (const item of batch) item.resolve(null);
    return;
  }
  const base = (await apiBase.getValue()).replace(/\/+$/, '');
  const mdl = await model.getValue();
  const failAll = () => {
    for (const item of batch) item.resolve(null);
  };
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (attempt > 0) await sleep(600 * attempt);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const resp = await fetch(`${base}/v1/messages`, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: mdl,
          max_tokens: 16000,
          system: ANALYZE_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: JSON.stringify(texts) }],
          temperature: 0.2,
        }),
      });
      if (resp.ok) {
        const parsed = parseAnalyzeResponse(texts, await resp.json());
        // An all-null parse means the response body was unusable; retry.
        if (parsed.every((p) => p === null)) continue;
        batch.forEach((item, i) => {
          const a = parsed[i] ?? null;
          if (a) resultCacheSet(item.text, a);
          item.resolve(a);
        });
        return;
      }
    } catch {
      // network error / abort — retry below
    } finally {
      clearTimeout(timeout);
    }
  }
  failAll();
}

export default defineBackground(() => {
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
      resolveApiKey()
        .then((key) => sendResponse({ configured: key.length > 0 }))
        .catch(() => sendResponse({ configured: false }));
      return true;
    }
    return undefined;
  });
});
