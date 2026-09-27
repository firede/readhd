import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import {
  PROVIDERS,
  activeProvider,
  providerConfigs,
  type ProviderConfig,
  type ProviderPreset,
} from '../../lib/providers';
import { NOTE_PRIVACY } from '../../ui/copy';
import { IconExternal } from '../../ui/icons';
import type { Word } from '../../lib/analysis';

interface TestResult {
  ok: boolean;
  ms?: number;
  inputTokens?: number;
  outputTokens?: number;
  words?: Word[];
  error?: string;
}

function fmtWords(words: Word[]): string {
  const chunks: string[] = [];
  let cur: string[] = [];
  let last = Number.MIN_SAFE_INTEGER;
  for (const w of words) {
    const ci = w.chunk ?? -1;
    if (ci !== last) {
      if (cur.length) chunks.push(cur.join(''));
      cur = [];
      last = ci;
    }
    cur.push(w.text);
  }
  if (cur.length) chunks.push(cur.join(''));
  return chunks.join(' | ');
}

function ProviderForm({ preset }: { preset: ProviderPreset }) {
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(preset.baseUrl);
  const [model, setModel] = useState(preset.model);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<TestResult | null>(null);
  const [saved, setSaved] = useState(false);
  const [permErr, setPermErr] = useState('');
  const isCustom = preset.id.startsWith('custom-');

  useEffect(() => {
    void providerConfigs.getValue().then((cfgs) => {
      const c = cfgs[preset.id];
      if (c) {
        setApiKey(c.apiKey ?? '');
        setBaseUrl(c.baseUrl ?? preset.baseUrl);
        setModel(c.model ?? preset.model);
      }
    });
  }, [preset.id]);

  async function save(): Promise<boolean> {
    if (isCustom && baseUrl.startsWith('http')) {
      const origin = new URL(baseUrl).origin;
      const granted = await browser.permissions
        .request({ origins: [`${origin}/*`] })
        .catch(() => false);
      if (!granted) {
        setPermErr('没有获得接口地址的访问权限，无法使用自定义服务');
        return false;
      }
    }
    const cfgs = await providerConfigs.getValue();
    await providerConfigs.setValue({
      ...cfgs,
      [preset.id]: {
        apiKey: apiKey.trim(),
        ...(baseUrl.trim() && baseUrl.trim() !== preset.baseUrl
          ? { baseUrl: baseUrl.trim() }
          : {}),
        ...(model.trim() && model.trim() !== preset.model
          ? { model: model.trim() }
          : {}),
      },
    });
    await activeProvider.setValue(preset.id);
    setSaved(true);
    setPermErr('');
    setTimeout(() => setSaved(false), 2000);
    return true;
  }

  async function test() {
    setTesting(true);
    setResult(null);
    try {
      const r = (await browser.runtime.sendMessage({
        type: 'testConnection',
        providerId: preset.id,
        apiKey,
        baseUrl,
        model,
      })) as TestResult;
      setResult(r);
    } catch {
      setResult({ ok: false, error: '网络连接失败或超时' });
    } finally {
      setTesting(false);
    }
  }

  const dlId = `models-${preset.id}`;

  return (
    <div className="pform">
      {isCustom && (
        <div className="rh-muted" style={{ marginBottom: 8 }}>
          协议：{preset.protocol === 'openai' ? 'OpenAI 兼容' : 'Anthropic 兼容'}
        </div>
      )}
      <div className="ffield">
        <label htmlFor={`${preset.id}-key`}>API Key</label>
        <div className="keyrow">
          <input
            id={`${preset.id}-key`}
            type={showKey ? 'text' : 'password'}
            value={apiKey}
            autoComplete="off"
            onChange={(e) => setApiKey(e.target.value)}
          />
          <button
            type="button"
            className="rh-chip"
            onClick={() => setShowKey(!showKey)}
          >
            {showKey ? '隐藏' : '显示'}
          </button>
          {preset.keyUrl && (
            <a
              className="rh-chip link"
              href={preset.keyUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              获取 API Key <IconExternal />
            </a>
          )}
        </div>
      </div>
      <div className="ffield">
        <label htmlFor={`${preset.id}-base`}>接口地址</label>
        <div className="keyrow">
          <input
            id={`${preset.id}-base`}
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={preset.baseUrl || 'https://…'}
          />
          {preset.baseUrl && baseUrl !== preset.baseUrl && (
            <button
              type="button"
              className="rh-chip"
              onClick={() => setBaseUrl(preset.baseUrl)}
            >
              恢复默认
            </button>
          )}
        </div>
      </div>
      <div className="ffield">
        <label htmlFor={`${preset.id}-model`}>模型名</label>
        <div className="keyrow">
          <input
            id={`${preset.id}-model`}
            value={model}
            list={dlId}
            onChange={(e) => setModel(e.target.value)}
            placeholder={preset.model || '模型名'}
          />
          {preset.modelSuggestions.length > 0 && (
            <datalist id={dlId}>
              {preset.modelSuggestions.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          )}
          {preset.model && model !== preset.model && (
            <button
              type="button"
              className="rh-chip"
              onClick={() => setModel(preset.model)}
            >
              恢复默认
            </button>
          )}
        </div>
      </div>
      {permErr && <div className="rh-badge danger">{permErr}</div>}
      <div className="btnrow">
        <button
          className="rh-btn"
          disabled={testing}
          onClick={() => void test()}
        >
          {testing ? '测试中…' : '测试连接'}
        </button>
        <button className="rh-btn primary" onClick={() => void save()}>
          {saved ? '已保存 ✓' : '保存并使用'}
        </button>
      </div>
      {result && (
        <div className={`rh-badge ${result.ok ? 'ok' : 'danger'} testres`}>
          {result.ok ? (
            <span>
              连接成功 · {result.ms}ms · 输入 {result.inputTokens} / 输出{' '}
              {result.outputTokens} tokens
              <br />
              {result.words ? fmtWords(result.words) : ''}
            </span>
          ) : (
            <span>失败：{result.error}</span>
          )}
        </div>
      )}
    </div>
  );
}

export function ModelsSection() {
  const [active, setActive] = useState('minimax-cn');
  const [sel, setSel] = useState('minimax-cn');
  useEffect(() => {
    void activeProvider.getValue().then(setActive);
  }, []);
  const preset = PROVIDERS.find((p) => p.id === sel)!;
  return (
    <div>
      <h2>模型服务</h2>
      <div className="pgrid">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`pcard ${sel === p.id ? 'sel' : ''}`}
            onClick={() => setSel(p.id)}
          >
            <span className="pname">
              {p.name}
              {active === p.id && <span className="cur">当前使用</span>}
            </span>
            <span className="pnote">{p.note}</span>
          </button>
        ))}
      </div>
      <ProviderForm key={preset.id} preset={preset} />
      <div className="rh-badge muted" style={{ marginTop: 16 }}>
        {NOTE_PRIVACY}
      </div>
    </div>
  );
}
