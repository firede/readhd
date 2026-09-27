import { defineContentScript } from 'wxt/utils/define-content-script';
import {
  collectParagraphs,
  mapRangeToNodes,
  type Paragraph,
} from '../lib/paragraphs';
import {
  ensureHighlightsRegistered,
  highlightCss,
  isDarkBlock,
  effectiveBackground,
  luminanceOf,
  setRanges,
  clearAllRanges,
  type HighlightName,
} from '../lib/highlight';
import { planMarks } from '../lib/marks';
import { initReader, refreshReader } from '../lib/reader';
import {
  analyzeParagraphLocal,
  analyzeParagraphCloud,
  getParagraphCloud,
} from '../lib/analyzer';
import type { Analysis } from '../lib/analysis';
import {
  BG_THEME_COLORS,
  getStyleSettings,
  enabled,
  disabledHosts,
  altColor,
  colorPreset,
  colorUnit,
  fadeFunctionWords,
  readingRuler,
  rulerLines,
  engine,
  lineHeight,
  letterSpacing,
  fontScale,
  bgTheme,
  readerFontSize,
  readerWidth,
  readerGap,
  ttsRate,
  ttsVoice,
  type StyleSettings,
} from '../lib/settings';

const STYLE_ID = 'readhd-style';
const PROCESSED_CLASS = 'readhd-p';

export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_idle',
  // top frame only (all_frames defaults to false)

  main() {
    let settings: StyleSettings | null = null;
    let active = false;
    let styleEl: HTMLStyleElement | null = null;
    let observer: IntersectionObserver | null = null;
    let mutObserver: MutationObserver | null = null;
    const paragraphs = new Map<Element, Paragraph>();
    const analyses = new Map<Element, Analysis>();
    const dirty = new Set<Element>();
    const pendingAdds = new Set<Element>();
    let firstPending = 0;
    let mutTimer: ReturnType<typeof setTimeout> | null = null;
    let dbgSync: () => void = () => {};

    function flushMutations(): void {
      mutTimer = null;
      firstPending = 0;
      // Drop paragraphs whose block was removed from the document.
      for (const block of [...paragraphs.keys()]) {
        if (!block.isConnected) {
          setRanges(block, []);
          observer?.unobserve(block);
          paragraphs.delete(block);
          analyses.delete(block);
          dirty.delete(block);
        }
      }
      for (const el of pendingAdds) {
        if (!el.isConnected) continue;
        for (const p of collectParagraphs(el)) registerParagraph(p);
      }
      pendingAdds.clear();
      for (const b of dirty) recollectBlock(b);
      dirty.clear();
    }

    function hostDisabled(): boolean {
      return (
        !settings ||
        !settings.enabled ||
        settings.disabledHosts.includes(location.hostname)
      );
    }

    function renderParagraph(p: Paragraph, analysis: Analysis): void {
      analyses.set(p.block, analysis);
      dbgSync();
      if (!settings || (!settings.altColor && !settings.fadeFunctionWords)) {
        setRanges(p.block, []);
        return;
      }
      const theme: 'light' | 'dark' = isDarkBlock(p.block) ? 'dark' : 'light';
      const entries: { range: Range; name: HighlightName }[] = [];
      const marks = planMarks(analysis.words, {
        alternate: settings.altColor,
        unit: settings.colorUnit,
        fade: settings.fadeFunctionWords,
      });
      for (const mark of marks) {
        const name = `readhd-${theme}-${mark.cls}` as HighlightName;
        for (const ref of mapRangeToNodes(p, mark.start, mark.end)) {
          const r = document.createRange();
          r.setStart(ref.node, ref.start);
          r.setEnd(ref.node, ref.end);
          entries.push({ range: r, name });
        }
      }
      setRanges(p.block, entries);
    }

    async function processBlock(block: Element): Promise<void> {
      const p = paragraphs.get(block);
      if (!p || !settings) return;
      const cached = getParagraphCloud(p.text);
      renderParagraph(p, cached ?? analyzeParagraphLocal(p.text));
      if (settings.engine === 'cloud' && !cached) {
        const analysis = await analyzeParagraphCloud(p.text);
        if (paragraphs.get(block) === p) renderParagraph(p, analysis);
      }
    }

    function applyBlockTypography(block: Element): void {
      if (!settings) return;
      const el = block as HTMLElement;
      el.classList.add(PROCESSED_CLASS);
      if (settings.lineHeight != null) {
        el.style.setProperty('--readhd-lh', String(settings.lineHeight));
      }
      if (settings.letterSpacing != null) {
        el.style.setProperty('--readhd-ls', `${settings.letterSpacing}em`);
      }
      if (settings.fontScale != null) {
        el.style.setProperty('--readhd-scale', String(settings.fontScale));
      }
    }

    function rebuildStylesheet(): void {
      if (!settings) return;
      const css = [
        highlightCss(settings.colorPreset),
        `.${PROCESSED_CLASS}{line-height:var(--readhd-lh);letter-spacing:var(--readhd-ls);font-size:calc(1em * var(--readhd-scale, 1))}`,
      ];
      if (settings.bgTheme !== 'none') {
        const color = BG_THEME_COLORS[settings.bgTheme];
        css.push(
          `html,body{background-color:${color} !important}`,
        );
      }
      styleEl!.textContent = css.join('\n');
    }

    function registerParagraph(p: Paragraph): void {
      if (paragraphs.has(p.block)) return;
      paragraphs.set(p.block, p);
      observer!.observe(p.block);
      applyBlockTypography(p.block);
    }

    function collectAll(): void {
      for (const p of collectParagraphs()) registerParagraph(p);
    }

    function recollectBlock(block: Element): void {
      setRanges(block, []);
      paragraphs.delete(block);
      analyses.delete(block);
      observer!.unobserve(block);
      for (const p of collectParagraphs(block as HTMLElement)) {
        registerParagraph(p);
        void processBlock(p.block);
      }
    }

    function teardown(): void {
      active = false;
      observer?.disconnect();
      mutObserver?.disconnect();
      observer = null;
      mutObserver = null;
      clearAllRanges();
      for (const p of paragraphs.values()) {
        const el = p.block as HTMLElement;
        el.classList.remove(PROCESSED_CLASS);
        el.style.removeProperty('--readhd-lh');
        el.style.removeProperty('--readhd-ls');
        el.style.removeProperty('--readhd-scale');
      }
      paragraphs.clear();
      analyses.clear();
      dbgSync();
      styleEl?.remove();
      styleEl = null;
      teardownRuler();
    }

    // --- reading ruler ---
    let rulerHost: HTMLDivElement | null = null;
    let rulerTop: HTMLDivElement | null = null;
    let rulerBottom: HTMLDivElement | null = null;
    let rulerY = 0;
    let rulerLineH = 24;
    let rulerVisible = false;
    let rulerScheduled = false;
    let onMouseMove: ((e: MouseEvent) => void) | null = null;
    let onMouseLeave: (() => void) | null = null;

    function setupRuler(): void {
      if (rulerHost || !settings) return;
      const dark =
        (luminanceOf(effectiveBackground(document.body)) ?? 1) < 0.4;
      rulerHost = document.createElement('div');
      rulerHost.className = 'readhd-root';
      const shadow = rulerHost.attachShadow({ mode: 'open' });
      const style = document.createElement('style');
      style.textContent = `
        .mask{position:fixed;left:0;right:0;pointer-events:none;z-index:2147483647;background:rgba(0,0,0,${dark ? '0.55' : '0.35'});display:none}
        #top{top:0}#bot{bottom:0}`;
      rulerTop = document.createElement('div');
      rulerBottom = document.createElement('div');
      rulerTop.className = 'mask';
      rulerTop.id = 'top';
      rulerBottom.className = 'mask';
      rulerBottom.id = 'bot';
      shadow.append(style, rulerTop, rulerBottom);
      document.documentElement.appendChild(rulerHost);

      onMouseMove = (e: MouseEvent) => {
        rulerY = e.clientY;
        rulerVisible = true;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        if (el) {
          const cs = getComputedStyle(el);
          let lineH = parseFloat(cs.lineHeight);
          if (Number.isNaN(lineH)) {
            lineH = 1.4 * (parseFloat(cs.fontSize) || 16);
          }
          lineH = Math.min(80, Math.max(16, lineH));
          rulerLineH = lineH;
        }
        if (!rulerScheduled) {
          rulerScheduled = true;
          requestAnimationFrame(paintRuler);
        }
      };
      onMouseLeave = () => {
        rulerVisible = false;
        paintRuler();
      };
      document.addEventListener('mousemove', onMouseMove, { passive: true });
      document.addEventListener('mouseleave', onMouseLeave);
    }

    function paintRuler(): void {
      rulerScheduled = false;
      if (!rulerTop || !rulerBottom || !settings) return;
      const h = rulerLineH * settings.rulerLines;
      const top = rulerY - h / 2;
      const bottom = rulerY + h / 2;
      rulerTop.style.display = rulerVisible ? 'block' : 'none';
      rulerBottom.style.display = rulerVisible ? 'block' : 'none';
      rulerTop.style.height = `${Math.max(0, top)}px`;
      rulerBottom.style.top = `${Math.max(0, bottom)}px`;
    }

    function teardownRuler(): void {
      if (onMouseMove) document.removeEventListener('mousemove', onMouseMove);
      if (onMouseLeave) document.removeEventListener('mouseleave', onMouseLeave);
      onMouseMove = null;
      onMouseLeave = null;
      rulerHost?.remove();
      rulerHost = null;
      rulerTop = null;
      rulerBottom = null;
    }

    function init(): void {
      if (!settings || hostDisabled()) return;
      active = true;
      ensureHighlightsRegistered();
      styleEl = document.createElement('style');
      styleEl.id = STYLE_ID;
      document.documentElement.appendChild(styleEl);
      rebuildStylesheet();

      observer = new IntersectionObserver(
        (entries) => {
          for (const e of entries) {
            if (e.isIntersecting) {
              observer!.unobserve(e.target);
              void processBlock(e.target);
            }
          }
        },
        { rootMargin: '200% 0px' },
      );
      mutObserver = new MutationObserver((muts) => {
        for (const m of muts) {
          const target =
            m.target instanceof Text ? m.target.parentElement : (m.target as Element);
          let tracked = target;
          while (tracked && !paragraphs.has(tracked)) {
            tracked = tracked.parentElement;
          }
          if (tracked) {
            dirty.add(tracked);
          } else if (m.type === 'childList') {
            // Mutation outside any tracked block: scan added nodes.
            for (const n of m.addedNodes) {
              if (n instanceof Element) pendingAdds.add(n);
              else if (n instanceof Text && n.parentElement) {
                pendingAdds.add(n.parentElement);
              }
            }
          }
        }
        if (!firstPending) firstPending = Date.now();
        if (mutTimer) clearTimeout(mutTimer);
        const wait = Math.min(300, firstPending + 1000 - Date.now());
        mutTimer = setTimeout(flushMutations, Math.max(0, wait));
      });
      mutObserver.observe(document.body, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      collectAll();
      if (settings.readingRuler) setupRuler();
    }

    async function reload(): Promise<void> {
      settings = await getStyleSettings();
      if (active) teardown();
      init();
      refreshReader(settings);
    }

    // Reader listener is registered regardless of enabled state — opening the
    // reader is an explicit user action.
    initReader(
      () => settings,
      () => {
        if (rulerHost) document.documentElement.appendChild(rulerHost);
      },
    );
    // Dev-build only test hook: lets the e2e read the analysis actually used
    // for rendering (isolated world — expose via a hidden DOM node's JSON).
    let dbgEl: HTMLDivElement | null = null;
    if (import.meta.env.DEV) {
      dbgEl = document.createElement('div');
      dbgEl.id = 'readhd-dbg';
      dbgEl.hidden = true;
      document.documentElement.appendChild(dbgEl);
      dbgSync = () => {
        const data: Record<string, unknown> = {};
        for (const [block, p] of paragraphs) {
          const a = analyses.get(block);
          if (a) data[p.text] = a;
        }
        dbgEl!.textContent = JSON.stringify(data);
      };
    }
    void reload();
    for (const item of [
      enabled,
      disabledHosts,
      altColor,
      colorPreset,
      colorUnit,
      fadeFunctionWords,
      readingRuler,
      rulerLines,
      engine,
      lineHeight,
      letterSpacing,
      fontScale,
      bgTheme,
      readerFontSize,
      readerWidth,
      readerGap,
      ttsRate,
      ttsVoice,
    ]) {
      item.watch(() => void reload());
    }
  },
});
