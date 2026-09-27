import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { apiBase, apiKey, model } from '../../lib/settings';
import { analyzeCloudCached } from '../../lib/analyzer';

const TEST_TEXT = '小明在花盆里种下三颗豆子。';

function Options() {
  const [key, setKey] = useState('');
  const [base, setBase] = useState('');
  const [mdl, setMdl] = useState('');
  const [result, setResult] = useState('');
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    void (async () => {
      setKey(await apiKey.getValue());
      setBase(await apiBase.getValue());
      setMdl(await model.getValue());
    })();
  }, []);

  async function test() {
    setTesting(true);
    setResult('测试中…');
    try {
      const analysis = await analyzeCloudCached(TEST_TEXT);
      if (analysis) {
        // group words by chunk: 小明/n 今天/n | 在/p 花盆/n 里/n | …
        const byChunk = new Map<number, string[]>();
        let cur = -1;
        for (const w of analysis.words) {
          const ci = w.chunk ?? ++cur;
          const list = byChunk.get(ci) ?? [];
          list.push(`${w.text}/${w.pos ?? '-'}`);
          byChunk.set(ci, list);
        }
        setResult(`成功：${[...byChunk.values()].map((ws) => ws.join(' ')).join(' | ')}`);
      } else {
        setResult('失败：云端未返回有效分词（请检查 API Key / 接口地址）');
      }
    } catch (e) {
      setResult(`失败：${String(e)}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <div>
      <h1>readhd 设置</h1>
      <div className="field">
        <label htmlFor="apiKey">API Key</label>
        <input
          id="apiKey"
          type="password"
          value={key}
          placeholder="未设置时使用本地分词"
          onChange={(e) => {
            setKey(e.target.value);
            void apiKey.setValue(e.target.value);
          }}
        />
      </div>
      <div className="field">
        <label htmlFor="apiBase">接口地址</label>
        <input
          id="apiBase"
          value={base}
          onChange={(e) => {
            setBase(e.target.value);
            void apiBase.setValue(e.target.value);
          }}
        />
      </div>
      <div className="field">
        <label htmlFor="model">模型</label>
        <input
          id="model"
          value={mdl}
          onChange={(e) => {
            setMdl(e.target.value);
            void model.setValue(e.target.value);
          }}
        />
      </div>
      <button disabled={testing} onClick={() => void test()}>
        {testing ? '测试中…' : '测试连接'}
      </button>
      <div
        id="result"
        style={{ display: result ? 'block' : 'none' }}
      >
        {result}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Options />);
