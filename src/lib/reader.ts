// Reader mode overlay: Readability extraction, sanitized shadow-DOM content,
// span-based word coloring, optional TTS read-aloud with sync highlighting.

import { browser } from 'wxt/browser';
import { Readability } from '@mozilla/readability';
import { sanitizeArticle } from './sanitize';
import {
  collectParagraphs,
  mapRangeToNodes,
  type Paragraph,
} from './paragraphs';
import { planMarks, planGaps } from './marks';
import { FADE_LIGHT, isWordLike, lightPair } from './highlight';
import type { Analysis } from './analysis';
import {
  analyzeParagraphCloud,
  analyzeParagraphLocal,
  getParagraphCloud,
} from './analyzer';
import { TtsPlayer, type TtsSynth, type UtteranceLike } from './tts';
import {
  BG_THEME_COLORS,
  colorUnit,
  getStyleSettings,
  readerFontSize,
  readerGap,
  readerWidth,
  ttsRate,
  type StyleSettings,
} from './settings';
import { TIP_GAP } from '../ui/copy';

const HAN_RE = /\p{Script=Han}/u;
const MIN_HAN = 50;

interface ReaderPara {
  p: Paragraph;
  /** Wrapper span replacing each original text node (kept detached). */
  wrappers: HTMLSpanElement[];
  /** Rendered-text map: (shadow text node, paragraph range) for highlights. */
  rmap: { node: Text; start: number; end: number }[];
  analysis: Analysis;
}

interface ReaderCtx {
  host: HTMLDivElement;
  shadow: ShadowRoot;
  scroller: HTMLDivElement;
  content: HTMLDivElement;
  paras: ReaderPara[];
  prevOverflow: string;
  player: TtsPlayer | null;
  sentHl: Highlight;
  wordHl: Highlight;
  pendingStart: number | null;
  ttsBtn: HTMLButtonElement;
  ttsMsg: HTMLSpanElement;
  ttsPill: HTMLDivElement;
  pillPlay: HTMLButtonElement;
  pillRate: HTMLSpanElement;
  gapSeg: HTMLButtonElement[];
  unitSeg: HTMLButtonElement[];
  fsLabel: HTMLSpanElement;
  wLabel: HTMLSpanElement;
  popover: HTMLDivElement;
  barEl: HTMLDivElement;
  progFill: HTMLDivElement;
  lastScrollTop: number;
  onKeydown: (e: KeyboardEvent) => void;
  onClick: (e: MouseEvent) => void;
  onScroll: () => void;
  onMouseMove: (e: MouseEvent) => void;
}

let reader: ReaderCtx | null = null;
let getSettings: () => StyleSettings | null;
let onAfterOpen: () => void;

export function isReaderOpen(): boolean {
  return reader !== null;
}

function showToast(text: string): void {
  const host = document.createElement('div');
  host.className = 'readhd-root';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    .t{position:fixed;left:50%;bottom:64px;transform:translateX(-50%);
       background:rgba(0,0,0,.8);color:#fff;padding:10px 18px;
       border-radius:8px;font-size:15px;z-index:2147483647}`;
  const el = document.createElement('div');
  el.className = 't';
  el.textContent = text;
  shadow.append(style, el);
  document.documentElement.appendChild(host);
  setTimeout(() => host.remove(), 3000);
}

function readerCss(s: StyleSettings): string {
  const [a, b] = lightPair(s.colorPreset);
  const bg = s.bgTheme === 'none' ? '#ffffff' : BG_THEME_COLORS[s.bgTheme];
  return `
    :host{all:initial}
    .wrap{position:fixed;inset:0;z-index:2147483647;display:flex;
      flex-direction:column;background:${bg};color:#1a1a1a;
      font-family:system-ui,sans-serif}
    .bar{position:sticky;top:0;display:flex;gap:8px;align-items:center;
      padding:8px 16px;background:${bg};
      border-bottom:1px solid #e5e7eb;font-size:14px;z-index:2;
      transition:transform .18s ease}
    .bar.hidden{transform:translateY(-100%)}
    .bar .site{color:#6b7280;font-size:12.5px}
    .bar .spacer{flex:1}
    .bar button{font-size:14px;padding:4px 12px;border:1px solid #d1d5db;
      border-radius:999px;background:#fff;cursor:pointer;min-height:32px;
      display:inline-flex;align-items:center;gap:6px}
    .bar button.sel{background:#dbeafe;border-color:#3b82f6}
    .bar button.primary{background:#1e40af;border-color:#1e40af;color:#fff}
    .bar input[type=range]{width:110px}
    .prog{position:sticky;top:0;height:2px;background:transparent;z-index:2;
      margin-top:-2px}
    .prog .fill{height:100%;width:0%;background:#1e40af}
    .pop{position:absolute;top:52px;right:16px;z-index:3;background:#fff;
      border:1px solid #e5e7eb;border-radius:12px;box-shadow:0 8px 28px
      rgb(0 0 0 /.14);padding:12px;display:none;font-size:13.5px;
      min-width:240px}
    .pop.open{display:block}
    .pop .row{display:flex;align-items:center;gap:8px;min-height:36px}
    .pop .lbl{width:40px;color:#6b7280}
    .pop button{border:1px solid #d1d5db;border-radius:8px;background:#fff;
      color:#1f2937;cursor:pointer;min-height:32px;padding:0 10px;
      font-size:13px}
    .pop button:hover{border-color:#9ca3af}
    .pop .seg{display:inline-flex;border:1px solid #d1d5db;
      border-radius:8px;overflow:hidden}
    .pop .seg button{border:none;border-radius:0;min-height:32px}
    .pop .seg button.sel{background:#1e40af;color:#fff}
    .pop .val{min-width:36px;text-align:center;font-variant-numeric:
      tabular-nums}
    .ttspill{position:fixed;left:50%;bottom:28px;transform:translateX(-50%);
      display:none;align-items:center;gap:8px;background:#111827;
      color:#f9fafb;border-radius:999px;padding:8px 14px;z-index:3;
      box-shadow:0 8px 24px rgb(0 0 0 /.3)}
    .ttspill.on{display:flex}
    .ttspill button{background:transparent;border:none;color:#f9fafb;
      cursor:pointer;font-size:13px;display:inline-flex;align-items:center;
      gap:4px;min-height:28px;padding:0 6px}
    .ttspill .rate{min-width:44px;text-align:center;
      font-variant-numeric:tabular-nums;font-size:12.5px}
    .ttspill svg{width:14px;height:14px}
    .scroll{flex:1;overflow-y:auto;padding:24px 16px 40vh}
    .col{max-width:${s.readerWidth}em;margin:0 auto;
      font-size:${s.readerFontSize}px;
      line-height:${s.lineHeight ?? 1.8};
      ${s.letterSpacing != null ? `letter-spacing:${s.letterSpacing}em;` : ''}}
    .col h1{font-size:1.5em;margin:0 0 .2em}
    .byline{color:#6b7280;font-size:.8em;margin-bottom:1em}
    .col p{margin:.6em 0}
    .col img{display:block;margin:1em auto;max-width:100%;height:auto;
      border-radius:8px}
    .w.a{color:${a}} .w.b{color:${b}} .w.f{color:${FADE_LIGHT}}
    ::highlight(readhd-tts-sent){background-color:#FEF3C7}
    ::highlight(readhd-tts-word){background-color:#FDE68A}
    .ttsmsg{color:#b45309;font-size:13px}
  `;
}

/** Rebuild one paragraph's word spans from its analysis (never re-reads DOM). */
function renderPara(ctx: ReaderCtx, rp: ReaderPara, s: StyleSettings): void {
  const words = rp.analysis.words;
  const marks = planMarks(words, {
    alternate: s.altColor,
    unit: s.colorUnit,
    fade: s.fadeFunctionWords,
  });
  const gaps = planGaps(words, s.readerGap);
  const wiOf = new Map<string, number>();
  words.forEach((w, i) => wiOf.set(`${w.start}:${w.end}`, i));

  const gapSize = s.readerGap === 'chunk' ? '0.9em' : '0.35em';

  rp.rmap = [];
  for (let i = 0; i < rp.p.nodes.length; i++) {
    const nodeText = rp.p.nodes[i]!.data;
    const nodeStart = rp.p.offsets[i]!;
    const wrap = rp.wrappers[i]!;
    wrap.textContent = '';
    let pos = 0;
    const push = (a: number, b: number, el?: HTMLSpanElement) => {
      if (b <= a) return;
      const t = document.createTextNode(nodeText.slice(a, b));
      (el ?? wrap).appendChild(t);
      rp.rmap.push({ node: t, start: nodeStart + a, end: nodeStart + b });
    };
    for (const mark of marks) {
      for (const ref of mapRangeToNodes(rp.p, mark.start, mark.end)) {
        if (ref.node !== rp.p.nodes[i]) continue;
        if (ref.end <= ref.start || !/\S/.test(nodeText.slice(ref.start, ref.end)))
          continue;
        push(pos, ref.start);
        const wsp = document.createElement('span');
        wsp.className = `w ${mark.cls}`;
        const wi = wiOf.get(`${mark.start}:${mark.end}`)!;
        wsp.dataset.wi = String(wi);
        if (gaps.has(wi) && ref.end === mark.end - nodeStart) {
          // last slice of a gapped word
          wsp.style.marginInlineEnd = gapSize;
        }
        wrap.appendChild(wsp);
        push(ref.start, ref.end, wsp);
        pos = ref.end;
      }
    }
    push(pos, nodeText.length);
  }
  if (import.meta.env.DEV) {
    ctx.shadow.querySelector('#readhd-dbg')!.textContent = JSON.stringify(
      ctx.paras.map((x) => ({ text: x.p.text, analysis: x.analysis })),
    );
  }
}

function renderAll(ctx: ReaderCtx, s: StyleSettings): void {
  for (const rp of ctx.paras) renderPara(ctx, rp, s);
}

/** Map a caret position inside the reader content to (paraIdx, offset). */
function caretToOffset(
  ctx: ReaderCtx,
  node: Node,
  offset: number,
): { pi: number; off: number } | null {
  for (let pi = 0; pi < ctx.paras.length; pi++) {
    for (const e of ctx.paras[pi]!.rmap) {
      if (e.node === node) return { pi, off: e.start + offset };
    }
  }
  return null;
}

function highlightSentence(ctx: ReaderCtx, pi: number, s: number, e: number): void {
  ctx.sentHl.clear();
  ctx.wordHl.clear();
  const rp = ctx.paras[pi];
  if (!rp) return;
  for (const m of rp.rmap) {
    const a = Math.max(s, m.start);
    const b = Math.min(e, m.end);
    if (a < b) {
      const r = document.createRange();
      r.setStart(m.node, a - m.start);
      r.setEnd(m.node, b - m.start);
      ctx.sentHl.add(r);
    }
  }
  // Auto-scroll only when the sentence is outside the scroll viewport.
  const block = rp.p.block as HTMLElement;
  const sr = ctx.scroller.getBoundingClientRect();
  const br = block.getBoundingClientRect();
  if (br.top < sr.top || br.bottom > sr.bottom) {
    block.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
}

function highlightWord(ctx: ReaderCtx, pi: number, abs: number): void {
  ctx.wordHl.clear();
  const rp = ctx.paras[pi];
  if (!rp) return;
  const w = rp.analysis.words.find((x) => abs >= x.start && abs < x.end);
  if (!w) return;
  for (const m of rp.rmap) {
    const a = Math.max(w.start, m.start);
    const b = Math.min(w.end, m.end);
    if (a < b) {
      const r = document.createRange();
      r.setStart(m.node, a - m.start);
      r.setEnd(m.node, b - m.start);
      ctx.wordHl.add(r);
    }
  }
}

function makeSynth(): TtsSynth {
  return {
    speak: (u) => speechSynthesis.speak(u as unknown as SpeechSynthesisUtterance),
    cancel: () => speechSynthesis.cancel(),
    pause: () => speechSynthesis.pause(),
    resume: () => speechSynthesis.resume(),
    getVoices: () => speechSynthesis.getVoices(),
    onVoicesChanged: (cb) =>
      speechSynthesis.addEventListener('voiceschanged', cb, { once: true }),
  };
}

function makeUtt(text: string): UtteranceLike {
  return new SpeechSynthesisUtterance(text) as unknown as UtteranceLike;
}

const SVG_PLAY =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M7 4.5v15l12-7.5z"/></svg>';
const SVG_PAUSE =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>';
const SVG_STOP =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

function updateTtsBtn(ctx: ReaderCtx): void {
  const st = ctx.player?.getState() ?? 'stopped';
  const lbl =
    st === 'playing' ? '暂停' : st === 'paused' ? '继续' : '朗读';
  ctx.ttsBtn.innerHTML = `${st === 'playing' ? SVG_PAUSE : SVG_PLAY}${lbl}`;
  ctx.pillPlay.innerHTML =
    st === 'playing' ? `${SVG_PAUSE}暂停` : `${SVG_PLAY}继续`;
  ctx.ttsPill.classList.toggle('on', st !== 'stopped');
}

function setupPlayer(ctx: ReaderCtx, s: StyleSettings): void {
  const player = new TtsPlayer(makeSynth(), makeUtt, s.ttsRate, s.ttsVoice, {
    onSentence: (pi, st, e) => highlightSentence(ctx, pi, st, e),
    onWord: (pi, i) => highlightWord(ctx, pi, i),
    onState: (st) => {
      updateTtsBtn(ctx);
      if (st === 'stopped') {
        ctx.sentHl.clear();
        ctx.wordHl.clear();
      }
    },
    onNoVoice: () => {
      ctx.ttsMsg.textContent = '没有找到中文语音';
    },
  });
  player.setQueue(ctx.paras.map((rp) => rp.p.text));
  ctx.player = player;
}

/** First queue index: pending click target, else first paragraph in viewport. */
function startIndex(ctx: ReaderCtx): number {
  if (ctx.pendingStart != null) return ctx.pendingStart;
  const sr = ctx.scroller.getBoundingClientRect();
  const pi = ctx.paras.findIndex((rp) => {
    const r = (rp.p.block as HTMLElement).getBoundingClientRect();
    return r.bottom > sr.top && r.top < sr.bottom;
  });
  const i = ctx.player!.sentenceIndexAt(Math.max(0, pi), 0);
  return i < 0 ? 0 : i;
}

async function openReader(): Promise<void> {
  if (reader) return;
  const s = getSettings() ?? (await getStyleSettings());
  let article: ReturnType<Readability['parse']> = null;
  try {
    article = new Readability(document.cloneNode(true) as Document).parse();
  } catch {
    article = null;
  }
  const han = (article?.textContent ?? '').match(/\p{Script=Han}/gu)?.length ?? 0;
  if (!article || han < MIN_HAN) {
    showToast('这个页面没有找到可以阅读的正文');
    return;
  }

  const host = document.createElement('div');
  host.className = 'readhd-root';
  host.id = 'readhd-reader';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = readerCss(s);

  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  const bar = document.createElement('div');
  bar.className = 'bar';
  const scroller = document.createElement('div');
  scroller.className = 'scroll';
  const col = document.createElement('div');
  col.className = 'col';
  const content = sanitizeArticle(article.content ?? '');
  const norm = (t: string) => t.replace(/\s+/g, '');
  const titleNorm = norm(article.title ?? '');
  const firstH = content.querySelector('h1, h2');
  const hText = norm(firstH?.textContent ?? '');
  const dupH =
    firstH &&
    hText &&
    titleNorm &&
    (titleNorm.includes(hText) || hText.includes(titleNorm));
  if (dupH) firstH!.remove();

  const h1 = document.createElement('h1');
  const title = (article.title ?? '').trim();
  h1.textContent = dupH
    ? (firstH!.textContent ?? '').trim()
    : HAN_RE.test(title)
      ? title
      : document.title;
  col.appendChild(h1);
  const head200 = (content.textContent ?? '').slice(0, 200);
  if (article.byline && !head200.includes(article.byline)) {
    const by = document.createElement('div');
    by.className = 'byline';
    by.textContent = article.byline;
    col.appendChild(by);
  }
  col.appendChild(content);
  scroller.appendChild(col);
  const prog = document.createElement('div');
  prog.className = 'prog';
  const progFill = document.createElement('div');
  progFill.className = 'fill';
  prog.appendChild(progFill);
  const popover = document.createElement('div');
  popover.className = 'pop';
  const pill = document.createElement('div');
  pill.className = 'ttspill';
  wrap.append(bar, prog, scroller);
  shadow.append(style, wrap);

  const ctx: ReaderCtx = {
    host,
    shadow,
    scroller,
    content: col,
    paras: [],
    prevOverflow: document.documentElement.style.overflow,
    player: null,
    sentHl: new Highlight(),
    wordHl: new Highlight(),
    pendingStart: null,
    ttsBtn: document.createElement('button'),
    ttsMsg: document.createElement('span'),
    ttsPill: pill,
    pillPlay: document.createElement('button'),
    pillRate: document.createElement('span'),
    gapSeg: [],
    unitSeg: [],
    fsLabel: document.createElement('span'),
    wLabel: document.createElement('span'),
    popover,
    barEl: bar,
    progFill,
    lastScrollTop: 0,
    onKeydown: (e) => {
      if (e.key === 'Escape') {
        if (popover.classList.contains('open')) {
          popover.classList.remove('open');
        } else {
          closeReader();
        }
        return;
      }
      if (e.key === ' ') {
        const t = e.target as HTMLElement | null;
        if (t && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(t.tagName)) return;
        e.preventDefault();
        const p = ctx.player;
        if (!p) return;
        const st = p.getState();
        if (st === 'playing') p.pause();
        else if (st === 'paused') p.resume();
        else void p.play(startIndex(ctx));
      }
    },
    onClick: (e) => {
      const r = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (!r) return;
      const hit = caretToOffset(ctx, r.startContainer, r.startOffset);
      if (!hit) return;
      const idx = ctx.player!.sentenceIndexAt(hit.pi, hit.off);
      if (idx < 0) return;
      if (ctx.player!.getState() === 'playing') {
        ctx.player!.jumpTo(idx);
      } else {
        ctx.pendingStart = idx;
      }
    },
    onScroll: () => {
      const el = ctx.scroller;
      const max = el.scrollHeight - el.clientHeight;
      ctx.progFill.style.width = `${max > 0 ? (el.scrollTop / max) * 100 : 0}%`;
      const down = el.scrollTop > ctx.lastScrollTop + 4;
      const up = el.scrollTop < ctx.lastScrollTop - 4;
      ctx.lastScrollTop = el.scrollTop;
      if (down && el.scrollTop > 60) bar.classList.add('hidden');
      else if (up || el.scrollTop < 60) bar.classList.remove('hidden');
    },
    onMouseMove: (e) => {
      if (e.clientY < 64) bar.classList.remove('hidden');
    },
  };

  // --- toolbar ---
  const mkBtn = (label: string, fn: () => void): HTMLButtonElement => {
    const b = document.createElement('button');
    b.textContent = label;
    b.addEventListener('click', fn);
    return b;
  };
  const exit = document.createElement('button');
  exit.innerHTML =
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>退出';
  exit.addEventListener('click', () => closeReader());
  bar.appendChild(exit);
  const site = document.createElement('span');
  site.className = 'site';
  site.textContent = location.hostname;
  bar.appendChild(site);
  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  bar.appendChild(spacer);

  ctx.ttsBtn.className = 'primary';
  ctx.ttsBtn.innerHTML = `${SVG_PLAY}朗读`;
  ctx.ttsBtn.addEventListener('click', () => {
    const p = ctx.player!;
    const st = p.getState();
    if (st === 'playing') p.pause();
    else if (st === 'paused') p.resume();
    else void p.play(startIndex(ctx));
  });
  bar.appendChild(ctx.ttsBtn);

  const aa = document.createElement('button');
  aa.textContent = 'Aa';
  aa.setAttribute('aria-label', '排版设置');
  aa.setAttribute('aria-expanded', 'false');
  aa.addEventListener('click', () => {
    const open = popover.classList.toggle('open');
    aa.setAttribute('aria-expanded', String(open));
  });
  bar.appendChild(aa);
  ctx.ttsMsg.className = 'ttsmsg';
  bar.appendChild(ctx.ttsMsg);

  // --- Aa popover ---
  const popRow = (label: string, ...els: HTMLElement[]) => {
    const row = document.createElement('div');
    row.className = 'row';
    const l = document.createElement('span');
    l.className = 'lbl';
    l.textContent = label;
    row.append(l, ...els);
    popover.appendChild(row);
    return row;
  };
  const mkSeg = (
    modes: readonly [string, string][],
    cur: string,
    store: HTMLButtonElement[],
    set: (m: string) => void,
  ) => {
    const seg = document.createElement('span');
    seg.className = 'seg';
    for (const [mode, label] of modes) {
      const b = mkBtn(label, () => set(mode));
      if (cur === mode) b.classList.add('sel');
      seg.appendChild(b);
      store.push(b);
    }
    return seg;
  };
  const stepBtn = (label: string, fn: () => void) => {
    const b = mkBtn(label, fn);
    b.style.minWidth = '30px';
    return b;
  };
  ctx.fsLabel.className = 'val';
  ctx.fsLabel.textContent = String(s.readerFontSize);
  popRow(
    '字号',
    stepBtn('−', () =>
      void readerFontSize.setValue(Math.max(16, s.readerFontSize - 2)),
    ),
    ctx.fsLabel,
    stepBtn('+', () =>
      void readerFontSize.setValue(Math.min(32, s.readerFontSize + 2)),
    ),
  );
  ctx.wLabel.className = 'val';
  ctx.wLabel.textContent = String(s.readerWidth);
  popRow(
    '宽度',
    stepBtn('窄', () => void readerWidth.setValue(Math.max(18, s.readerWidth - 2))),
    ctx.wLabel,
    stepBtn('宽', () => void readerWidth.setValue(Math.min(40, s.readerWidth + 2))),
  );
  popRow(
    '间隔',
    mkSeg(
      [
        ['none', '无'],
        ['word', '词'],
        ['chunk', '意群'],
      ],
      s.readerGap,
      ctx.gapSeg,
      (m) => void readerGap.setValue(m as typeof s.readerGap),
    ),
    (() => {
      const tip = document.createElement('span');
      tip.className = 'site';
      tip.title = TIP_GAP;
      tip.textContent = 'ⓘ';
      return tip;
    })(),
  );
  popRow(
    '标色',
    mkSeg(
      [
        ['chunk', '意群'],
        ['word', '词'],
      ],
      s.colorUnit,
      ctx.unitSeg,
      (m) => void colorUnit.setValue(m as typeof s.colorUnit),
    ),
  );
  // --- end toolbar ---

  // --- TTS floating pill ---
  ctx.pillPlay.innerHTML = `${SVG_PLAY}继续`;
  ctx.pillPlay.addEventListener('click', () => {
    const p = ctx.player!;
    if (p.getState() === 'playing') p.pause();
    else p.resume();
  });
  const pillStop = document.createElement('button');
  pillStop.innerHTML = `${SVG_STOP}停止`;
  pillStop.addEventListener('click', () => ctx.player?.stop());
  const rateMinus = document.createElement('button');
  rateMinus.textContent = '−';
  rateMinus.setAttribute('aria-label', '语速减慢');
  rateMinus.addEventListener('click', () => {
    void ttsRate.setValue(Math.max(0.5, Math.round((s.ttsRate - 0.1) * 10) / 10));
  });
  ctx.pillRate.className = 'rate';
  ctx.pillRate.textContent = `${s.ttsRate.toFixed(1)}×`;
  const ratePlus = document.createElement('button');
  ratePlus.textContent = '+';
  ratePlus.setAttribute('aria-label', '语速加快');
  ratePlus.addEventListener('click', () => {
    void ttsRate.setValue(Math.min(1.5, Math.round((s.ttsRate + 0.1) * 10) / 10));
  });
  pill.append(ctx.pillPlay, pillStop, ctx.pillRate, rateMinus, ratePlus);
  wrap.append(popover, pill);

  document.documentElement.appendChild(host);
  document.documentElement.style.overflow = 'hidden';
  document.addEventListener('keydown', ctx.onKeydown);
  scroller.addEventListener('click', ctx.onClick);
  scroller.addEventListener('scroll', ctx.onScroll);
  scroller.addEventListener('mousemove', ctx.onMouseMove);
  CSS.highlights.set('readhd-tts-sent', ctx.sentHl);
  CSS.highlights.set('readhd-tts-word', ctx.wordHl);
  onAfterOpen(); // keep the reading ruler above the reader

  // collect paragraphs and render
  for (const p of collectParagraphs(col)) {
    const wrappers: HTMLSpanElement[] = [];
    for (let i = 0; i < p.nodes.length; i++) {
      const w = document.createElement('span');
      w.className = 'rt';
      w.dataset.ni = String(i);
      const node = p.nodes[i]!;
      node.replaceWith(w); // original node stays referenced/detached
      wrappers.push(w);
    }
    ctx.paras.push({
      p,
      wrappers,
      rmap: [],
      analysis: analyzeParagraphLocal(p.text),
    });
  }
  reader = ctx;
  if (import.meta.env.DEV) {
    const dbg = document.createElement('div');
    dbg.id = 'readhd-dbg';
    dbg.hidden = true;
    shadow.appendChild(dbg);
  }
  renderAll(ctx, s);
  setupPlayer(ctx, s);
  if (s.engine === 'cloud') {
    for (const rp of ctx.paras) {
      void (async () => {
        const a = await analyzeParagraphCloud(rp.p.text);
        if (reader === ctx) {
          rp.analysis = a;
          renderPara(ctx, rp, getSettings() ?? s);
        }
      })();
    }
  }
}

function closeReader(): void {
  const ctx = reader;
  if (!ctx) return;
  reader = null;
  ctx.player?.stop();
  document.removeEventListener('keydown', ctx.onKeydown);
  CSS.highlights.delete('readhd-tts-sent');
  CSS.highlights.delete('readhd-tts-word');
  document.documentElement.style.overflow = ctx.prevOverflow;
  ctx.host.remove();
}

export function initReader(
  settingsGetter: () => StyleSettings | null,
  bringRulerToFront: () => void,
): void {
  getSettings = settingsGetter;
  onAfterOpen = bringRulerToFront;
  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'toggleReader') {
      if (reader) closeReader();
      else void openReader();
    }
  });
}

/** Called when settings reload: update the live reader without closing it. */
export function refreshReader(s: StyleSettings): void {
  getSettings = () => s;
  const ctx = reader;
  if (!ctx) return;
  ctx.shadow.querySelector('style')!.textContent = readerCss(s);
  ctx.fsLabel.textContent = String(s.readerFontSize);
  ctx.wLabel.textContent = String(s.readerWidth);
  const modes = ['none', 'word', 'chunk'] as const;
  ctx.gapSeg.forEach((b, i) =>
    b.classList.toggle('sel', modes[i] === s.readerGap),
  );
  const units = ['chunk', 'word'] as const;
  ctx.unitSeg.forEach((b, i) =>
    b.classList.toggle('sel', units[i] === s.colorUnit),
  );
  ctx.pillRate.textContent = `${s.ttsRate.toFixed(1)}×`;
  renderAll(ctx, s);
}
