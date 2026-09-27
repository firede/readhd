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
  isWordLike,
  setRanges,
  clearAllRanges,
  type HighlightName,
} from '../lib/highlight';
import {
  segmentParagraphLocal,
  segmentParagraphCloud,
  getParagraphCloud,
} from '../lib/segmenter';
import type { TokenSpan } from '../lib/segment-align';
import {
  BG_THEME_COLORS,
  getStyleSettings,
  enabled,
  disabledHosts,
  altColor,
  colorPreset,
  engine,
  lineHeight,
  letterSpacing,
  fontScale,
  bgTheme,
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
    const dirty = new Set<Element>();
    const pendingAdds = new Set<Element>();
    let firstPending = 0;
    let mutTimer: ReturnType<typeof setTimeout> | null = null;

    function flushMutations(): void {
      mutTimer = null;
      firstPending = 0;
      // Drop paragraphs whose block was removed from the document.
      for (const block of [...paragraphs.keys()]) {
        if (!block.isConnected) {
          setRanges(block, []);
          observer?.unobserve(block);
          paragraphs.delete(block);
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

    function renderParagraph(p: Paragraph, spans: TokenSpan[]): void {
      if (!settings || !settings.altColor) {
        setRanges(p.block, []);
        return;
      }
      const theme: 'light' | 'dark' = isDarkBlock(p.block) ? 'dark' : 'light';
      const entries: { range: Range; name: HighlightName }[] = [];
      let toggle = false;
      for (const span of spans) {
        if (!isWordLike(span.text)) continue;
        const name: HighlightName = toggle
          ? (`readhd-${theme}-b` as HighlightName)
          : (`readhd-${theme}-a` as HighlightName);
        toggle = !toggle;
        for (const ref of mapRangeToNodes(p, span.start, span.end)) {
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
      renderParagraph(p, cached ?? segmentParagraphLocal(p.text));
      if (settings.engine === 'cloud' && !cached) {
        const spans = await segmentParagraphCloud(p.text);
        if (paragraphs.get(block) === p) renderParagraph(p, spans);
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
      styleEl?.remove();
      styleEl = null;
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
    }

    async function reload(): Promise<void> {
      settings = await getStyleSettings();
      if (active) teardown();
      init();
    }

    void reload();
    for (const item of [
      enabled,
      disabledHosts,
      altColor,
      colorPreset,
      engine,
      lineHeight,
      letterSpacing,
      fontScale,
      bgTheme,
    ]) {
      item.watch(() => void reload());
    }
  },
});
