import { describe, expect, it } from 'vitest';
// @vitest-environment happy-dom
import { Window } from 'happy-dom';

function makeDoc(html: string) {
  const win = new Window();
  win.document.body.innerHTML = html;
  return win;
}

// getComputedStyle in happy-dom returns display per stylesheet defaults;
// for tests we rely on tag semantics only where possible. To keep this
// deterministic we stub getComputedStyle for the block-detection path.
function stubComputed(win: Window, inline: string[] = []) {
  const orig = win.getComputedStyle.bind(win);
  return (el: Element) => {
    const style = orig(el as never);
    const tag = el.tagName.toLowerCase();
    const display = inline.includes(tag)
      ? 'inline'
      : ['p', 'div', 'section', 'h1'].includes(tag)
        ? 'block'
        : 'inline';
    return new Proxy(style, {
      get(t, prop) {
        if (prop === 'display') return display;
        return (t as never)[prop];
      },
    }) as unknown as CSSStyleDeclaration;
  };
}

async function setup(html: string, inline?: string[]) {
  const { collectParagraphs, mapRangeToNodes } = await import(
    '../src/lib/paragraphs'
  );
  const win = makeDoc(html);
  const doc = win.document;
  // globals used by the module
  (globalThis as Record<string, unknown>).document = doc;
  (globalThis as Record<string, unknown>).NodeFilter = {
    SHOW_TEXT: 4,
  };
  (globalThis as Record<string, unknown>).getComputedStyle = stubComputed(
    win,
    inline,
  );
  return { collectParagraphs, mapRangeToNodes, doc };
}

describe('collectParagraphs', () => {
  it('groups text nodes by block ancestor and builds offset map', async () => {
    const { collectParagraphs, doc } = await setup(
      '<div><p>小明去学校<span>，天气很好</span></p><p>第二段。</p></div>',
    );
    const ps = collectParagraphs(doc.body as never);
    expect(ps.length).toBe(2);
    const p0 = ps[0]!;
    expect(p0.text).toBe('小明去学校，天气很好');
    expect(p0.nodes.length).toBe(2);
    expect(p0.offsets).toEqual([0, 5]);
    expect(ps[1]!.text).toBe('第二段。');
  });

  it('skips script/style/textarea/code and non-Han text', async () => {
    const { collectParagraphs, doc } = await setup(
      '<div><p>好的文字</p><textarea>中文跳过</textarea><script>中文跳过</script><pre>跳过</pre><p>english only</p></div>',
    );
    const ps = collectParagraphs(doc.body as never);
    expect(ps.length).toBe(1);
    expect(ps[0]!.text).toBe('好的文字');
  });
});

describe('mapRangeToNodes', () => {
  it('maps a range spanning multiple text nodes', async () => {
    const { collectParagraphs, mapRangeToNodes, doc } = await setup(
      '<p>小明去<b>学校上课</b>了。</p>',
    );
    const p = collectParagraphs(doc.body as never)[0]!;
    expect(p.text).toBe('小明去学校上课了。');
    // range covering 校..了 => crosses the <b> boundary both ways
    const refs = mapRangeToNodes(p, 4, 8);
    expect(refs.length).toBe(2);
    expect(refs[0]!.node.data).toBe('学校上课');
    expect(refs[0]!.start).toBe(1);
    expect(refs[1]!.node.data).toBe('了。');
    expect(refs[1]!.start).toBe(0);
    expect(refs[1]!.end).toBe(1);
  });
});

describe('splitChunks', () => {
  async function split(t: string) {
    const { splitChunks } = await import('../src/lib/paragraphs');
    return splitChunks(t);
  }

  it('short text is unchanged', async () => {
    expect(await split('小明去学校。')).toEqual(['小明去学校。']);
  });

  it('accumulates sentences, cutting after sentence punctuation once ≥40 chars', async () => {
    const s = '短句。'.repeat(10) + '又一个短句。';
    const t = s.repeat(5);
    const parts = await split(t);
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(p.length).toBeLessThanOrEqual(160);
      expect(/[。！？；]$/.test(p) || p.length === 160 || p.length < 40).toBe(true);
    }
    expect(parts.join('')).toBe(t);
  });

  it('long paragraph: all pieces ≤160 and concatenation equals input', async () => {
    const t = '从前，在一片茂密的森林里，住着一只聪明的小狐狸。'.repeat(12);
    const parts = await split(t);
    expect(parts.join('')).toBe(t);
    expect(parts.every((p) => p.length <= 160)).toBe(true);
    expect(parts.length).toBeGreaterThan(3);
  });

  it('single sentence >120 chars is cut at the last minor punctuation before 120', async () => {
    const seg = '这是一段很长的句子，';
    const t = seg.repeat(15) + '结尾。';
    const parts = await split(t);
    expect(parts.join('')).toBe(t);
    expect(parts.every((p) => p.length <= 160)).toBe(true);
    expect(parts[0]!.endsWith('，')).toBe(true);
    expect(parts[0]!.length).toBeLessThanOrEqual(121);
  });

  it('hard caps at 160 when no punctuation at all', async () => {
    const t = '字'.repeat(400);
    const parts = await split(t);
    expect(parts.join('')).toBe(t);
    expect(parts.slice(0, -1).every((p) => p.length === 160)).toBe(true);
    expect(parts.every((p) => p.length <= 160)).toBe(true);
  });
});
