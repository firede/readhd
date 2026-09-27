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
  lastError,
  letterSpacing,
  lineHeight,
  readingRuler,
  rulerLines,
  usageDaily,
  type BgTheme,
  type ColorPreset,
  type ColorUnit,
  type Engine,
} from '../../lib/settings';
import { analyzeStatus } from '../../lib/analyzer';
import {
  readerShortcut,
  type FormattedShortcut,
} from '../../lib/shortcut';
import { planMarks } from '../../lib/marks';
import {
  lightPair,
  darkPair,
  FADE_LIGHT,
  FADE_DARK,
} from '../../lib/highlight';
import type { Word } from '../../lib/analysis';
import { dayKey } from '../../lib/usage';
import {
  Button,
  Card,
  InfoTip,
  Segmented,
  Slider,
  StatusBadge,
  Swatch,
  Switch,
} from '../../ui/components';
import { IconBook, IconHelp, IconSettings } from '../../ui/icons';
import {
  NOTE_COLOR,
  TIP_CHUNK,
  TIP_FADE,
  TIP_RULER,
  TIP_WORD,
} from '../../ui/copy';
import './popup.css';

const PRESET_COLORS: Record<ColorPreset, string> = {
  blue: '#1e40af',
  red: '#991b1b',
  green: '#166534',
};
const PRESET_NAMES: Record<ColorPreset, string> = {
  blue: '蓝色',
  red: '红色',
  green: '绿色',
};
const THEME_NAMES: Record<BgTheme, string> = {
  none: '无底色',
  cream: '米色',
  green: '淡绿',
  blue: '淡蓝',
};

// Authored preview sample (words + pos + chunks are static).
const SAMPLE_TEXT = '每天清晨，可爱的小狐狸都会去溪边喝水。';
const SAMPLE: [string, string, number][] = [
  ['每天', 'n', 0],
  ['清晨', 'n', 0],
  ['，', 'w', 1],
  ['可爱', 'a', 2],
  ['的', 'u', 2],
  ['小狐狸', 'n', 2],
  ['都', 'd', 3],
  ['会', 'v', 3],
  ['去', 'v', 3],
  ['溪边', 'n', 3],
  ['喝', 'v', 4],
  ['水', 'n', 4],
  ['。', 'w', 5],
];
const SAMPLE_WORDS: Word[] = (() => {
  let pos = 0;
  return SAMPLE.map(([text, p, chunk]) => {
    const w: Word = {
      start: pos,
      end: pos + text.length,
      text,
      pos: p as Word['pos'],
      chunk,
    };
    pos += text.length;
    return w;
  });
})();

function Preview({
  unit,
  preset,
  fade,
  alt,
}: {
  unit: ColorUnit;
  preset: ColorPreset;
  fade: boolean;
  alt: boolean;
}) {
  const dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const [ca, cb] = dark ? darkPair(preset) : lightPair(preset);
  const fadeColor = dark ? FADE_DARK : FADE_LIGHT;
  const marks = planMarks(SAMPLE_WORDS, {
    alternate: alt,
    unit,
    fade,
  });
  const parts: { text: string; cls?: string }[] = [];
  let pos = 0;
  for (const m of marks) {
    if (m.start > pos) parts.push({ text: SAMPLE_TEXT.slice(pos, m.start) });
    parts.push({ text: SAMPLE_TEXT.slice(m.start, m.end), cls: m.cls });
    pos = m.end;
  }
  if (pos < SAMPLE_TEXT.length) parts.push({ text: SAMPLE_TEXT.slice(pos) });
  return (
    <div className="preview">
      {parts.map((p, i) =>
        p.cls ? (
          <span
            key={i}
            style={{
              color:
                p.cls === 'a' ? ca : p.cls === 'b' ? cb : fadeColor,
            }}
          >
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </div>
  );
}

interface Status {
  configured: boolean;
  providerName?: string;
  model?: string;
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [on, setOn] = useState(true);
  const [host, setHost] = useState('');
  const [isWebPage, setIsWebPage] = useState(false);
  const [hostOn, setHostOn] = useState(true);
  const [hosts, setHosts] = useState<string[]>([]);
  const [alt, setAlt] = useState(true);
  const [preset, setPreset] = useState<ColorPreset>('blue');
  const [unit, setUnit] = useState<ColorUnit>('chunk');
  const [fade, setFade] = useState(false);
  const [ruler, setRuler] = useState(false);
  const [lines, setLines] = useState<1 | 2 | 3>(2);
  const [eng, setEng] = useState<Engine>('cloud');
  const [status, setStatus] = useState<Status | null>(null);
  const [err, setErr] = useState<{ ts: number; message: string } | null>(null);
  const [today, setToday] = useState({ requests: 0, tokens: 0 });
  const [lh, setLh] = useState<number | null>(null);
  const [ls, setLs] = useState<number | null>(null);
  const [fs, setFs] = useState<number | null>(null);
  const [bg, setBg] = useState<BgTheme>('none');
  const [typoOpen, setTypoOpen] = useState(false);
  const [sc, setSc] = useState<FormattedShortcut | null>(null);

  useEffect(() => {
    void (async () => {
      const tab = (
        await browser.tabs.query({ active: true, currentWindow: true })
      )[0];
      const web =
        !!tab?.url &&
        (tab.url.startsWith('http://') || tab.url.startsWith('https://'));
      const h = web ? new URL(tab.url!).hostname : '';
      const [en, hs, a, p, u, fd, e, l, s, f, b, rr, rl, st, le, ud, scv] =
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
          lastError.getValue(),
          usageDaily.getValue(),
          readerShortcut(),
        ]);
      setOn(en);
      setHosts(hs);
      setHost(h);
      setIsWebPage(web);
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
      setSc(scv);
      setStatus(st);
      if (le && Date.now() - le.ts < 10 * 60 * 1000) {
        setErr({ ts: le.ts, message: le.message });
      }
      const todayStats = ud[dayKey(Date.now())] ?? {};
      setToday({
        requests: Object.values(todayStats).reduce((n, s) => n + s.requests, 0),
        tokens: Object.values(todayStats).reduce(
          (n, s) => n + s.inputTokens + s.outputTokens,
          0,
        ),
      });
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

  function openOptions(hash = '') {
    void browser.tabs.create({
      url: browser.runtime.getURL(`/options.html${hash}`),
    });
    window.close();
  }

  async function openReader() {
    const tab = (
      await browser.tabs.query({ active: true, currentWindow: true })
    )[0];
    if (tab?.id != null) {
      try {
        await browser.tabs.sendMessage(tab.id, { type: 'toggleReader' });
      } catch {
        // content script not reachable on this page
      }
    }
    window.close();
  }

  if (!ready) return <div className="popup">加载中…</div>;

  return (
    <div className="popup">
      <header className="hd">
        <img src="/icon/32.png" alt="" width={22} height={22} />
        <h1>ReadHD 阅读助手</h1>
        <Switch
          checked={on}
          label="启用阅读辅助"
          onChange={(v) => {
            setOn(v);
            void enabled.setValue(v);
          }}
        />
      </header>

      {isWebPage ? (
        <div className="rh-row site">
          <span className="grow">在 {host} 上启用</span>
          <Switch
            checked={hostOn}
            label={`在 ${host} 上启用`}
            onChange={(v) => void toggleHost(v)}
          />
        </div>
      ) : (
        <div className="rh-muted site">此页面不支持</div>
      )}

      {eng === 'local' ? (
        <StatusBadge kind="muted">本地分词（只能按词显示）</StatusBadge>
      ) : err ? (
        <StatusBadge kind="danger">
          <span className="grow">上次分析失败：{err.message}</span>
          <button className="linklike" onClick={() => openOptions('#usage')}>
            查看
          </button>
        </StatusBadge>
      ) : status && !status.configured ? (
        <StatusBadge kind="warn">
          <span className="grow">未配置模型服务，正在按词显示</span>
          <button className="linklike" onClick={() => openOptions('#models')}>
            去设置
          </button>
        </StatusBadge>
      ) : status?.configured ? (
        <StatusBadge kind="ok">
          意群分析 · {status.providerName} · {status.model}
        </StatusBadge>
      ) : null}

      <Button
        variant="primary"
        className="readerbtn"
        icon={<IconBook />}
        onClick={() => void openReader()}
      >
        打开阅读模式
        {sc && (
          <span className="kbd" title={sc.full}>
            {sc.keys.map((k, i) => (
              <kbd key={i}>{k}</kbd>
            ))}
          </span>
        )}
      </Button>

      <Card title="标色">
        <Preview unit={unit} preset={preset} fade={fade} alt={alt} />
        <div className="rh-row">
          <span className="grow">
            标色单位
            <InfoTip text={unit === 'chunk' ? TIP_CHUNK : TIP_WORD} />
          </span>
          <Segmented<ColorUnit>
            ariaLabel="标色单位"
            value={unit}
            options={[
              { value: 'chunk', label: '意群', title: TIP_CHUNK },
              { value: 'word', label: '词', title: TIP_WORD },
            ]}
            onChange={(v) => {
              setUnit(v);
              void colorUnit.setValue(v);
            }}
          />
        </div>
        <div className="rh-row">
          <span className="grow">
            颜色
            <InfoTip text={NOTE_COLOR} />
          </span>
          <span className="swatches">
            {(Object.keys(PRESET_COLORS) as ColorPreset[]).map((p) => (
              <Swatch
                key={p}
                color={PRESET_COLORS[p]}
                name={PRESET_NAMES[p]}
                selected={preset === p}
                onClick={() => {
                  setPreset(p);
                  void colorPreset.setValue(p);
                }}
              />
            ))}
          </span>
        </div>
        <div className="rh-row">
          <span className="grow">
            交替颜色
          </span>
          <Switch
            checked={alt}
            label="交替颜色"
            onChange={(v) => {
              setAlt(v);
              void altColor.setValue(v);
            }}
          />
        </div>
        <div className="rh-row">
          <span className="grow">
            淡化虚词
            <InfoTip text={TIP_FADE} />
          </span>
          <Switch
            checked={fade}
            label="淡化虚词"
            onChange={(v) => {
              setFade(v);
              void fadeFunctionWords.setValue(v);
            }}
          />
        </div>
      </Card>

      <Card title="阅读尺">
        <div className="rh-row">
          <span className="grow">
            跟随鼠标遮住其他行
            <InfoTip text={TIP_RULER} />
          </span>
          <Switch
            checked={ruler}
            label="阅读尺"
            onChange={(v) => {
              setRuler(v);
              void readingRuler.setValue(v);
            }}
          />
        </div>
        {ruler && (
          <div className="rh-row">
            <span className="grow">行数</span>
            <Segmented<number>
              ariaLabel="阅读尺行数"
              value={lines}
              options={[1, 2, 3].map((n) => ({ value: n, label: `${n} 行` }))}
              onChange={(v) => {
                setLines(v as 1 | 2 | 3);
                void rulerLines.setValue(v as 1 | 2 | 3);
              }}
            />
          </div>
        )}
      </Card>

      <div className="typo">
        <button
          type="button"
          className="typo-toggle"
          aria-expanded={typoOpen}
          onClick={() => setTypoOpen(!typoOpen)}
        >
          排版与底色 <span className={`caret ${typoOpen ? 'up' : ''}`}>▾</span>
        </button>
        {typoOpen && (
          <div className="typo-body">
            <Slider
              label="行距"
              value={lh}
              defaultValue={1.8}
              min={1.5}
              max={2.2}
              step={0.05}
              format={(v) => v.toFixed(2)}
              onChange={(v) => {
                setLh(v);
                void lineHeight.setValue(v);
              }}
            />
            <Slider
              label="字间距"
              value={ls}
              defaultValue={0.05}
              min={0}
              max={0.2}
              step={0.01}
              format={(v) => v.toFixed(2)}
              onChange={(v) => {
                setLs(v);
                void letterSpacing.setValue(v);
              }}
            />
            <Slider
              label="字号"
              value={fs}
              defaultValue={1.2}
              min={1.0}
              max={1.5}
              step={0.05}
              format={(v) => `${v.toFixed(2)}×`}
              onChange={(v) => {
                setFs(v);
                void fontScale.setValue(v);
              }}
            />
            <div className="rh-row">
              <span className="grow">页面底色</span>
              <span className="swatches">
                {(Object.keys(THEME_NAMES) as BgTheme[]).map((t) => (
                  <Swatch
                    key={t}
                    color={t === 'none' ? '#ffffff' : BG_THEME_COLORS[t]}
                    name={THEME_NAMES[t]}
                    selected={bg === t}
                    onClick={() => {
                      setBg(t);
                      void bgTheme.setValue(t);
                    }}
                  />
                ))}
              </span>
            </div>
          </div>
        )}
      </div>

      <footer className="ft">
        <button
          type="button"
          className="linklike muted"
          onClick={() => openOptions('#usage')}
        >
          今天 {today.requests} 次分析 · {today.tokens} tokens
        </button>
        <span className="spacer" />
        <button
          type="button"
          className="iconbtn"
          aria-label="设置"
          onClick={() => openOptions()}
        >
          <IconSettings />
        </button>
        <button
          type="button"
          className="iconbtn"
          aria-label="帮助"
          onClick={() => openOptions('#help')}
        >
          <IconHelp />
        </button>
      </footer>
    </div>
  );
}
