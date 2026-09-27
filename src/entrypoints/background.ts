import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import { SEGMENT_SYSTEM_PROMPT } from '../lib/segment-prompt';
import {
  parseSegmentResponse,
  type TokenSpan,
} from '../lib/segment-align';
import { apiBase, apiKey, model } from '../lib/settings';

const DEBOUNCE_MS = 150;
const MAX_BATCH_CHARS = 2000;
const MAX_CONCURRENT = 2;
const TIMEOUT_MS = 30_000;

interface QueueItem {
  text: string;
  resolve: (spans: TokenSpan[] | null) => void;
}

const queue: QueueItem[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = 0;
const resultCache = new Map<string, TokenSpan[]>();
const RESULT_CACHE_MAX = 3000;

function resultCacheSet(text: string, spans: TokenSpan[]): void {
  if (resultCache.has(text)) resultCache.delete(text);
  if (resultCache.size >= RESULT_CACHE_MAX) {
    const oldest = resultCache.keys().next().value;
    if (oldest !== undefined) resultCache.delete(oldest);
  }
  resultCache.set(text, spans);
}

async function resolveApiKey(): Promise<string> {
  const stored = (await apiKey.getValue()).trim();
  if (stored) return stored;
  // Dev-only fallback injected by wxt.config (empty string in production builds).
  return (process.env.MINIMAX_API_KEY ?? '').trim();
}

function enqueue(text: string): Promise<TokenSpan[] | null> {
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

async function sendBatch(batch: QueueItem[]): Promise<void> {
  const texts = batch.map((b) => b.text);
  const key = await resolveApiKey();
  if (!key) {
    for (const item of batch) item.resolve(null);
    return;
  }
  const base = (await apiBase.getValue()).replace(/\/+$/, '');
  const mdl = await model.getValue();
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
        max_tokens: 8192,
        system: SEGMENT_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify(texts) }],
        temperature: 0.2,
      }),
    });
    if (!resp.ok) {
      for (const item of batch) item.resolve(null);
      return;
    }
    const body = await resp.json();
    const parsed = parseSegmentResponse(texts, body);
    batch.forEach((item, i) => {
      const spans = parsed[i] ?? null;
      if (spans) resultCacheSet(item.text, spans);
      item.resolve(spans);
    });
  } finally {
    clearTimeout(timeout);
  }
}

export default defineBackground(() => {
  browser.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === 'segment' && Array.isArray(msg.texts)) {
      const texts = msg.texts as string[];
      Promise.all(texts.map((t) => enqueue(t))).then(sendResponse);
      return true;
    }
    if (msg?.type === 'segmentStatus') {
      resolveApiKey()
        .then((key) => sendResponse({ configured: key.length > 0 }))
        .catch(() => sendResponse({ configured: false }));
      return true;
    }
    return undefined;
  });
});
