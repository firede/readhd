import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import passagesJson from '../../selftest/passages.json';
import {
  aggregate,
  selectSession,
  type SessionItem,
} from '../../lib/selftest-logic';
import {
  getStyleSettings,
  selftestResults,
  BG_THEME_COLORS,
  type SelftestRecord,
  type StyleSettings,
} from '../../lib/settings';
import {
  segmentParagraphCloud,
  segmentParagraphLocal,
} from '../../lib/segmenter';
import {
  clearRanges,
  ensureHighlightsRegistered,
  highlightCss,
  isWordLike,
  setRanges,
  type HighlightName,
} from '../../lib/highlight';
import type { TokenSpan } from '../../lib/segment-align';

interface Passage {
  id: string;
  title: string;
  text: string;
  questions: { q: string; options: string[]; answer: number }[];
}
const PASSAGES = passagesJson as Passage[];

const HAN_RE = /\p{Script=Han}/gu;

type Phase =
  | { kind: 'menu' }
  | { kind: 'intro'; idx: number }
  | { kind: 'reading'; idx: number }
  | { kind: 'questions'; idx: number; q: number; ms: number; correct: number }
  | { kind: 'results' };

function countHan(text: string): number {
  return text.match(HAN_RE)?.length ?? 0;
}

/** Render a passage with the user's settings; returns cleanup. */
function renderOn(
  el: HTMLElement,
  text: string,
  settings: StyleSettings,
  spans: TokenSpan[],
): () => void {
  const node = document.createTextNode(text);
  el.appendChild(node);
  el.classList.add('readhd-p');
  if (settings.lineHeight != null)
    el.style.setProperty('--readhd-lh', String(settings.lineHeight));
  if (settings.letterSpacing != null)
    el.style.setProperty('--readhd-ls', `${settings.letterSpacing}em`);
  if (settings.fontScale != null)
    el.style.setProperty('--readhd-scale', String(settings.fontScale));

  // Typography rule is always applied for "on"; highlight colors only matter
  // when altColor is enabled.
  const styleEl = document.createElement('style');
  styleEl.textContent = [
    highlightCss(settings.colorPreset),
    `.readhd-p{line-height:var(--readhd-lh);letter-spacing:var(--readhd-ls);font-size:calc(1em * var(--readhd-scale, 1))}`,
  ].join('\n');
  document.head.appendChild(styleEl);

  if (settings.altColor) {
    ensureHighlightsRegistered();
    let toggle = false;
    const entries: { range: Range; name: HighlightName }[] = [];
    for (const span of spans) {
      if (!isWordLike(span.text)) continue;
      const name: HighlightName = toggle ? 'readhd-light-b' : 'readhd-light-a';
      toggle = !toggle;
      const r = document.createRange();
      r.setStart(node, span.start);
      r.setEnd(node, span.end);
      entries.push({ range: r, name });
    }
    setRanges(el, entries);
  }
  return () => {
    clearRanges(el);
    styleEl.remove();
  };
}

function Selftest() {
  const [phase, setPhase] = useState<Phase>({ kind: 'menu' });
  const [session, setSession] = useState<SessionItem[]>([]);
  const [history, setHistory] = useState<SelftestRecord[]>([]);
  const [settings, setSettings] = useState<StyleSettings | null>(null);
  const [answers, setAnswers] = useState<number[]>([]);
  const [prepared, setPrepared] = useState(false);
  const preparedSpans = useRef(new Map<number, TokenSpan[]>());
  const startRef = useRef(0);
  const textRef = useRef<HTMLParagraphElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    void (async () => {
      setHistory(await selftestResults.getValue());
      setSettings(await getStyleSettings());
    })();
  }, []);

  function start() {
    setSession(selectSession(PASSAGES, history));
    setPhase({ kind: 'intro', idx: 0 });
  }

  function beginReading(idx: number) {
    setPhase({ kind: 'reading', idx });
  }

  // Pre-segment during the intro phase so colors are stable while reading.
  useEffect(() => {
    if (phase.kind !== 'intro' || !settings) return;
    const item = session[phase.idx];
    const passage = PASSAGES.find((p) => p.id === item?.passageId);
    if (!item || !passage) return;
    if (item.condition !== 'on') {
      setPrepared(true);
      return;
    }
    setPrepared(false);
    let alive = true;
    void (async () => {
      let spans: TokenSpan[];
      if (settings.engine === 'cloud') {
        const timeout = new Promise<null>((r) => setTimeout(() => r(null), 8000));
        spans =
          (await Promise.race([segmentParagraphCloud(passage.text), timeout])) ??
          segmentParagraphLocal(passage.text);
      } else {
        spans = segmentParagraphLocal(passage.text);
      }
      if (alive) {
        preparedSpans.current.set(phase.idx, spans);
        setPrepared(true);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind === 'intro' ? phase.idx : -1, settings]);

  // Apply styling once the reading DOM exists, then start the timer.
  useEffect(() => {
    if (phase.kind !== 'reading' || !settings) return;
    const item = session[phase.idx];
    if (!item) return;
    const passage = PASSAGES.find((p) => p.id === item.passageId)!;
    const el = textRef.current!;
    if (item.condition === 'on') {
      const spans =
        preparedSpans.current.get(phase.idx) ??
        segmentParagraphLocal(passage.text);
      cleanupRef.current = renderOn(el, passage.text, settings, spans);
      if (settings.bgTheme !== 'none') {
        document.body.style.setProperty(
          'background-color',
          BG_THEME_COLORS[settings.bgTheme],
          'important',
        );
      }
    } else {
      el.textContent = passage.text;
    }
    // Start timing after the styled text is in the DOM and painted.
    requestAnimationFrame(() => {
      startRef.current = performance.now();
    });
    return () => {
      cleanupRef.current?.();
      cleanupRef.current = null;
      document.body.style.removeProperty('background-color');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind === 'reading' ? phase.idx : -1, settings]);

  function finishReading(idx: number) {
    setPhase({
      kind: 'questions',
      idx,
      q: 0,
      ms: Math.round(performance.now() - startRef.current),
      correct: 0,
    });
    setAnswers([]);
  }

  async function answer(idx: number, q: number, ms: number, correct: number, choice: number) {
    const item = session[idx];
    const passage = PASSAGES.find((p) => p.id === item?.passageId);
    if (!item || !passage) return;
    const right = choice === passage.questions[q]!.answer;
    const newCorrect = correct + (right ? 1 : 0);
    setAnswers((a) => [...a, choice]);
    if (q < 2) {
      setPhase({ kind: 'questions', idx, q: q + 1, ms, correct: newCorrect });
      return;
    }
    const record: SelftestRecord = {
      ts: Date.now(),
      passageId: passage.id,
      condition: item.condition,
      ms,
      hanChars: countHan(passage.text),
      correct: newCorrect,
      settingsSnapshot: {
        altColor: settings?.altColor,
        colorPreset: settings?.colorPreset,
        engine: settings?.engine,
        lineHeight: settings?.lineHeight,
        letterSpacing: settings?.letterSpacing,
        fontScale: settings?.fontScale,
        bgTheme: settings?.bgTheme,
      },
    };
    const next = [...(await selftestResults.getValue()), record];
    await selftestResults.setValue(next);
    setHistory(next);
    if (idx + 1 < session.length) {
      setPhase({ kind: 'intro', idx: idx + 1 });
    } else {
      setPhase({ kind: 'results' });
    }
  }

  async function clearHistory() {
    if (window.confirm('确定要清除所有自测记录吗？')) {
      await selftestResults.setValue([]);
      setHistory([]);
    }
  }

  const agg = aggregate(history);

  if (phase.kind === 'menu' || phase.kind === 'results') {
    return (
      <div className="wrap">
        <h1>阅读自测</h1>
        {phase.kind === 'menu' ? (
          <>
            <p>一次自测读两篇短文，读完后回答小问题。大约需要几分钟。</p>
            <button className="big primary" onClick={start}>
              开始自测
            </button>
          </>
        ) : (
          <p>完成啦，真棒！</p>
        )}
        <h2>历史结果</h2>
        {!agg.enough && <p className="muted">数据还太少，多测几次结果才可靠</p>}
        <table>
          <thead>
            <tr>
              <th></th>
              <th>篇数</th>
              <th>速度（字/分钟，中位数）</th>
              <th>答对率</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>辅助开启</td>
              <td>{agg.on.count}</td>
              <td>{agg.on.medianCpm?.toFixed(0) ?? '—'}</td>
              <td>{agg.on.meanAccuracy?.toFixed(0) ?? '—'}%</td>
            </tr>
            <tr>
              <td>辅助关闭</td>
              <td>{agg.off.count}</td>
              <td>{agg.off.medianCpm?.toFixed(0) ?? '—'}</td>
              <td>{agg.off.meanAccuracy?.toFixed(0) ?? '—'}%</td>
            </tr>
          </tbody>
        </table>
        {agg.enough && agg.speedDiffPct != null && (
          <p>
            开启辅助时阅读速度
            {agg.speedDiffPct >= 0 ? '快' : '慢'}了约
            {Math.abs(agg.speedDiffPct).toFixed(0)}%，答对率
            {(agg.accDiffPts ?? 0) >= 0 ? '高' : '低'}了约
            {Math.abs(agg.accDiffPts ?? 0).toFixed(0)} 个百分点。
          </p>
        )}
        <button className="big" onClick={() => void clearHistory()}>
          清除记录
        </button>
      </div>
    );
  }

  const item = session[phase.idx];
  const passage = PASSAGES.find((p) => p.id === item?.passageId);
  if (!item || !passage) return null;

  if (phase.kind === 'intro') {
    return (
      <div className="wrap">
        <h1>{passage.title}</h1>
        <p>准备好了吗？点下面的按钮开始读。读完后点“读完了”。</p>
        <button
          className="big primary"
          disabled={!prepared}
          onClick={() => beginReading(phase.idx)}
        >
          {prepared ? '开始读' : '准备中…'}
        </button>
      </div>
    );
  }

  if (phase.kind === 'reading') {
    return (
      <div className="wrap">
        <p ref={textRef} className="passage" />
        <button
          className="big primary"
          onClick={() => finishReading(phase.idx)}
        >
          读完了
        </button>
      </div>
    );
  }

  // questions
  const question = passage.questions[phase.q];
  if (!question) return null;
  return (
    <div className="wrap">
      <p className="muted">
        第 {phase.q + 1} / 3 题
      </p>
      <p className="q">{question.q}</p>
      <div className="options">
        {question.options.map((opt, i) => (
          <button
            key={i}
            onClick={() =>
              void answer(phase.idx, phase.q, phase.ms, phase.correct, i)
            }
          >
            {opt}
          </button>
        ))}
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Selftest />);
