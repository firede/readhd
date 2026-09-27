// Pure protocol adapters for Anthropic- and OpenAI-compatible chat APIs.

import type { Protocol } from './providers';

export interface LlmRequestInput {
  baseUrl: string;
  model: string;
  apiKey: string;
  system: string;
  user: string;
  maxTokens: number;
  extraBody?: Record<string, unknown>;
}

export function buildRequest(
  protocol: Protocol,
  input: LlmRequestInput,
): { url: string; init: RequestInit } {
  const base = input.baseUrl.replace(/\/+$/, '');
  if (protocol === 'anthropic') {
    return {
      url: `${base}/v1/messages`,
      init: {
        method: 'POST',
        headers: {
          'x-api-key': input.apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: input.model,
          max_tokens: input.maxTokens,
          system: input.system,
          messages: [{ role: 'user', content: input.user }],
          temperature: 0.2,
          ...input.extraBody,
        }),
      },
    };
  }
  return {
    url: `${base}/chat/completions`,
    init: {
      method: 'POST',
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: input.model,
        max_tokens: input.maxTokens,
        temperature: 0.2,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
        ...input.extraBody,
      }),
    },
  };
}

export interface LlmResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  truncated: boolean;
}

export function parseResponse(protocol: Protocol, body: unknown): LlmResult {
  const b = (body ?? {}) as Record<string, unknown>;
  if (protocol === 'anthropic') {
    const content = Array.isArray(b.content) ? b.content : [];
    const text = content
      .filter(
        (c): c is { type: string; text: string } =>
          !!c &&
          typeof c === 'object' &&
          (c as { type?: unknown }).type === 'text' &&
          typeof (c as { text?: unknown }).text === 'string',
      )
      .map((c) => c.text)
      .join('');
    const usage = (b.usage ?? {}) as Record<string, unknown>;
    return {
      text,
      inputTokens: Number(usage.input_tokens) || 0,
      outputTokens: Number(usage.output_tokens) || 0,
      truncated: b.stop_reason === 'max_tokens',
    };
  }
  const choice = Array.isArray(b.choices) ? b.choices[0] : undefined;
  const message = (choice?.message ?? {}) as Record<string, unknown>;
  const usage = (b.usage ?? {}) as Record<string, unknown>;
  return {
    text: typeof message.content === 'string' ? message.content : '',
    inputTokens: Number(usage.prompt_tokens) || 0,
    outputTokens: Number(usage.completion_tokens) || 0,
    truncated: choice?.finish_reason === 'length',
  };
}

/** Friendly Chinese error description for UI/status surfaces. */
export function describeError(status: number | null, bodyText = ''): string {
  if (status === null) return '网络连接失败或超时';
  if (status === 401 || status === 403) return 'API Key 无效或没有权限';
  if (status === 404) return '接口地址或模型名不正确';
  if (status === 429) return '请求太频繁或余额不足';
  if (status >= 500) return '服务商暂时不可用';
  const detail = bodyText.trim().slice(0, 80);
  return detail ? `请求失败（${status}）：${detail}` : `请求失败（${status}）`;
}
