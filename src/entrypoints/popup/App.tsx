import { browser } from 'wxt/browser';
import { useEffect, useState } from 'react';
import {
  BG_THEME_COLORS,
  altColor,
  bgTheme,
  colorPreset,
  colorUnit,
  disabledHosts,
  enabled,
  engine,
  fadeFunctionWords,
  fontScale,
  letterSpacing,
  lineHeight,
  readingRuler,
  rulerLines,
  type BgTheme,
  type ColorPreset,
  type ColorUnit,
  type Engine,
} from '../../lib/settings';
import { analyzeStatus } from '../../lib/analyzer';

const PRESET_COLORS: Record<ColorPreset, string> = {
  blue: '#1e40af',
  red: '#991b1b',
  green: '#166534',
};
const PRESET_NAMES: Record<ColorPreset, string> = {
  blue: '蓝',
  red: '红',
  green: '绿',
};
const THEME_NAMES: Record<BgTheme, string> = {
  none: '无',
  cream: '米色',
  green: '淡绿',
  blue: '淡蓝',
};

export default function App() {
  const [ready, setReady] = useState(false);
  const [on, setOn] = useState(true);
  const [host, setHost] = useState('');
  const [hostOn, setHostOn] = useState(true);
  const [hosts, setHosts] = useState<string[]>([]);
  const [alt, setAlt] = useState(true);
  const [preset, setPreset] = useState<ColorPreset>('blue');
  const [unit, setUnit] = useState<ColorUnit>('word');
  const [fade, setFade] = useState(false);
  const [ruler, setRuler] = useState(false);
  const [lines, setLines] = useState<1 | 2 | 3>(2);
  const [eng, setEng] = useState<Engine>('cloud');
  const [keyOk, setKeyOk] = useState<boolean | null>(null);
  const [lh, setLh] = useState<number | null>(null);
  const [ls, setLs] = useState<number | null>(null);
  const [fs, setFs] = useState<number | null>(null);
  const [bg, setBg] = useState<BgTheme>('none');

  useEffect(() => {
    void (async () => {
      const tab = (
        await browser.tabs.query({ active: true, currentWindow: true })
      )[0];
      const h = tab?.url ? new URL(tab.url).hostname : '';
      const [en, hs, a, p, u, fd, e, l, s, f, b, rr, rl, st] =
        await Promise.all([
          enabled.getValue(),
          disabledHosts.getValue(),
          altColor.getValue(),
          colorPreset.getValue(),
          colorUnit.getValue(),
          fadeFunctionWords.getValue(),
          engine.getValue(),
          lineHeight.getValue(),
          letterSpacing.getValue(),
          fontScale.getValue(),
          bgTheme.getValue(),
          readingRuler.getValue(),
          rulerLines.getValue(),
          analyzeStatus(),
        ]);
      setOn(en);
      setHosts(hs);
      setHost(h);
      setHostOn(!hs.includes(h));
      setAlt(a);
      setPreset(p);
      setUnit(u);
      setFade(fd);
      setEng(e);
      setLh(l);
      setLs(s);
      setFs(f);
      setBg(b);
      setRuler(rr);
      setLines(rl);
      setKeyOk(st?.configured ?? null);
      setReady(true);
    })();
  }, []);

  async function toggleHost(v: boolean) {
    if (!host) return;
    const next = v ? hosts.filter((x) => x !== host) : [...hosts, host];
    setHosts(next);
    setHostOn(v);
    await disabledHosts.setValue(next);
  }

  function slider(
    label: string,
    val: number | null,
    set: (v: number | null) => void,
    item: { setValue: (v: number | null) => Promise<void> },
    min: number,
    max: number,
    step: number,
  ) {
    return (
      <div className="slider-row">
        <span className="lbl">{label}</span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          disabled={val == null}
          style={val == null ? { opacity: 0.3 } : undefined}
          value={val ?? min}
          onChange={(e) => {
            const v = Number(e.target.value);
            set(v);
            void item.setValue(v);
          }}
        />
        <span className="val">{val == null ? '—' : val.toFixed(2)}</span>
        <button
          className="big"
          style={{ minHeight: 32, padding: '0 8px', fontSize: 13 }}
          onClick={() => {
            if (val == null) {
              const v = (min + max) / 2;
              set(v);
              void item.setValue(v);
            } else {
              set(null);
              void item.setValue(null);
            }
          }}
        >
          {val == null ? '设置' : '不改变'}
        </button>
      </div>
    );
  }

  if (!ready) return <div className="readhd-popup">加载中…</div>;

  return (
    <div className="readhd-popup">
      <h1>readhd 阅读助手</h1>
      <div className="row">
        <label htmlFor="sw-on">启用阅读辅助</label>
        <input
          id="sw-on"
          className="switch"
          type="checkbox"
          checked={on}
          onChange={(e) => {
            setOn(e.target.checked);
            void enabled.setValue(e.target.checked);
          }}
        />
      </div>
      {host && (
        <div className="row">
          <label htmlFor="sw-host">在此网站启用（{host}）</label>
          <input
            id="sw-host"
            className="switch"
            type="checkbox"
            checked={hostOn}
            onChange={(e) => void toggleHost(e.target.checked)}
          />
        </div>
      )}
      <div className="section">
        <div className="row">
          <label htmlFor="sw-alt">交替颜色</label>
          <input
            id="sw-alt"
            className="switch"
            type="checkbox"
            checked={alt}
            onChange={(e) => {
              setAlt(e.target.checked);
              void altColor.setValue(e.target.checked);
            }}
          />
        </div>
        <div className="row">
          <label>颜色</label>
          <div className="swatches">
            {(Object.keys(PRESET_COLORS) as ColorPreset[]).map((p) => (
              <button
                key={p}
                className={`swatch ${preset === p ? 'selected' : ''}`}
                style={{ background: PRESET_COLORS[p] }}
                title={PRESET_NAMES[p]}
                aria-label={PRESET_NAMES[p]}
                onClick={() => {
                  setPreset(p);
                  void colorPreset.setValue(p);
                }}
              >
                {PRESET_NAMES[p]}
              </button>
            ))}
          </div>
        </div>
        <div className="row">
          <label>标色单位</label>
          <div className="seg">
            {(['word', 'chunk'] as const).map((u) => (
              <button
                key={u}
                className={`segbtn ${unit === u ? 'selected' : ''}`}
                onClick={() => {
                  setUnit(u);
                  void colorUnit.setValue(u);
                }}
              >
                {u === 'word' ? '词' : '意群'}
              </button>
            ))}
          </div>
        </div>
        {unit === 'chunk' && (eng === 'local' || keyOk === false) && (
          <div className="status">意群需要云端分析</div>
        )}
        <div className="row">
          <label htmlFor="sw-fade">淡化虚词（的、了、吗…）</label>
          <input
            id="sw-fade"
            className="switch"
            type="checkbox"
            checked={fade}
            onChange={(e) => {
              setFade(e.target.checked);
              void fadeFunctionWords.setValue(e.target.checked);
            }}
          />
        </div>
        <div className="row">
          <label htmlFor="sw-ruler">阅读尺</label>
          <input
            id="sw-ruler"
            className="switch"
            type="checkbox"
            checked={ruler}
            onChange={(e) => {
              setRuler(e.target.checked);
              void readingRuler.setValue(e.target.checked);
            }}
          />
        </div>
        {ruler && (
          <div className="row">
            <label>行数</label>
            <div className="seg">
              {([1, 2, 3] as const).map((n) => (
                <button
                  key={n}
                  className={`segbtn ${lines === n ? 'selected' : ''}`}
                  onClick={() => {
                    setLines(n);
                    void rulerLines.setValue(n);
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="section">
        <div className="row">
          <label htmlFor="sel-engine">分词引擎</label>
          <select
            id="sel-engine"
            value={eng}
            onChange={(e) => {
              const v = e.target.value as Engine;
              setEng(v);
              void engine.setValue(v);
            }}
          >
            <option value="cloud">云端</option>
            <option value="local">本地</option>
          </select>
        </div>
        {eng === 'cloud' && (
          <div className="status">
            {keyOk === false
              ? '未配置 API Key，正在使用本地分词'
              : keyOk === true
                ? '云端分词已就绪'
                : '…'}
          </div>
        )}
      </div>
      <div className="section">
        {slider('行距', lh, setLh, lineHeight, 1.5, 2.2, 0.05)}
        {slider('字间距', ls, setLs, letterSpacing, 0, 0.2, 0.01)}
        {slider('字号', fs, setFs, fontScale, 1.0, 1.5, 0.05)}
      </div>
      <div className="section">
        <div className="row">
          <label>页面底色</label>
          <div className="swatches">
            {(Object.keys(THEME_NAMES) as BgTheme[]).map((t) => (
              <button
                key={t}
                className={`swatch ${bg === t ? 'selected' : ''}`}
                style={{
                  background: t === 'none' ? '#fff' : BG_THEME_COLORS[t],
                  border: '1px solid #ccc',
                }}
                title={THEME_NAMES[t]}
                aria-label={THEME_NAMES[t]}
                onClick={() => {
                  setBg(t);
                  void bgTheme.setValue(t);
                }}
              >
                {THEME_NAMES[t]}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="btn-row">
        <button
          className="big"
          onClick={() => void browser.runtime.openOptionsPage()}
        >
          设置
        </button>
      </div>
    </div>
  );
}
