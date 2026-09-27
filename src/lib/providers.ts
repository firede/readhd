import { storage } from 'wxt/utils/storage';

export type Protocol = 'anthropic' | 'openai';

export interface ProviderPreset {
  id: string;
  name: string;
  note: string;
  protocol: Protocol;
  baseUrl: string;
  model: string;
  modelSuggestions: string[];
  keyUrl?: string;
  extraBody?: Record<string, unknown>;
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'minimax-cn',
    name: 'MiniMax（国内）',
    note: '国内直连，默认推荐',
    protocol: 'anthropic',
    baseUrl: 'https://api.minimax.cn/anthropic',
    model: 'MiniMax-M3',
    modelSuggestions: ['MiniMax-M3', 'MiniMax-M2.7-highspeed'],
    keyUrl: 'https://platform.minimaxi.com',
  },
  {
    id: 'minimax-global',
    name: 'MiniMax（国际）',
    note: '海外网络使用',
    protocol: 'anthropic',
    baseUrl: 'https://api.minimax.io/anthropic',
    model: 'MiniMax-M3',
    modelSuggestions: ['MiniMax-M3', 'MiniMax-M2.7-highspeed'],
    keyUrl: 'https://platform.minimax.io',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    note: '价格低，国内直连',
    protocol: 'openai',
    baseUrl: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    modelSuggestions: ['deepseek-flash'],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    // thinking is ON by default for this model — must disable for latency
    extraBody: { thinking: { type: 'disabled' } },
  },
  {
    id: 'dashscope',
    name: '阿里云百炼（北京）',
    note: '千问 Flash，价格低',
    protocol: 'openai',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-flash',
    modelSuggestions: ['qwen-flash', 'qwen-plus'],
    keyUrl: 'https://bailian.console.aliyun.com',
    extraBody: { enable_thinking: false },
  },
  {
    id: 'custom-openai',
    name: '自定义（OpenAI 兼容）',
    note: '填写任意兼容接口',
    protocol: 'openai',
    baseUrl: '',
    model: '',
    modelSuggestions: [],
  },
  {
    id: 'custom-anthropic',
    name: '自定义（Anthropic 兼容）',
    note: '填写任意兼容接口',
    protocol: 'anthropic',
    baseUrl: '',
    model: '',
    modelSuggestions: [],
  },
];

export function providerById(id: string): ProviderPreset | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

// local storage: API keys and per-provider overrides (never in sync storage)
export const activeProvider = storage.defineItem<string>('local:activeProvider', {
  fallback: 'minimax-cn',
});
export const providerConfigs = storage.defineItem<Record<string, ProviderConfig>>(
  'local:providerConfigs',
  { fallback: {} },
);

export interface ResolvedProvider {
  preset: ProviderPreset;
  apiKey: string;
  baseUrl: string;
  model: string;
  configured: boolean;
}

/**
 * Resolve the effective config for a provider: stored overrides win over the
 * preset. The dev-only env key fallback applies to minimax-cn only.
 */
export async function resolveProvider(id?: string): Promise<ResolvedProvider> {
  const pid = id ?? (await activeProvider.getValue());
  const preset = providerById(pid) ?? PROVIDERS[0]!;
  const cfg = (await providerConfigs.getValue())[preset.id] ?? { apiKey: '' };
  let apiKey = (cfg.apiKey ?? '').trim();
  if (!apiKey && preset.id === 'minimax-cn') {
    // Dev-only fallback injected by wxt.config (empty string in production).
    apiKey = (process.env.MINIMAX_API_KEY ?? '').trim();
  }
  const baseUrl = (cfg.baseUrl ?? preset.baseUrl).trim() || preset.baseUrl;
  const model = (cfg.model ?? preset.model).trim() || preset.model;
  return {
    preset,
    apiKey,
    baseUrl,
    model,
    configured: apiKey.length > 0 && baseUrl.length > 0 && model.length > 0,
  };
}
