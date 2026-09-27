import { describe, expect, it } from 'vitest';
import { sanitizeArticle } from '../src/lib/sanitize';

describe('sanitizeArticle', () => {
  it('removes script/iframe entirely', () => {
    const el = sanitizeArticle(
      '<p>你好<script>alert(1)</script><iframe src="https://x"></iframe>世界</p>',
    );
    expect(el.querySelector('script')).toBeNull();
    expect(el.querySelector('iframe')).toBeNull();
    expect(el.textContent).toContain('你好');
    expect(el.textContent).toContain('世界');
  });

  it('strips event handlers and style attributes', () => {
    const el = sanitizeArticle(
      '<p onclick="x()" style="color:red" class="c">文本</p>',
    );
    const p = el.querySelector('p')!;
    expect(p.getAttribute('onclick')).toBeNull();
    expect(p.getAttribute('style')).toBeNull();
    expect(p.getAttribute('class')).toBeNull();
    expect(p.textContent).toBe('文本');
  });

  it('drops javascript: href but keeps https href with target/rel', () => {
    const el = sanitizeArticle(
      '<p><a href="javascript:alert(1)">坏</a><a href="https://e.com/x">好</a></p>',
    );
    const [bad, good] = [...el.querySelectorAll('a')];
    expect(bad!.getAttribute('href')).toBeNull();
    expect(bad!.textContent).toBe('坏');
    expect(good!.getAttribute('href')).toBe('https://e.com/x');
    expect(good!.getAttribute('target')).toBe('_blank');
    expect(good!.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('unwraps unknown tags keeping text', () => {
    const el = sanitizeArticle('<p><custom-el>保留我</custom-el></p>');
    expect(el.querySelector('custom-el')).toBeNull();
    expect(el.textContent).toContain('保留我');
  });

  it('keeps data:image img, drops javascript: src', () => {
    const el = sanitizeArticle(
      '<p><img src="data:image/png;base64,AAAA" alt="图"><img src="javascript:x()"></p>',
    );
    const imgs = el.querySelectorAll('img');
    expect(imgs.length).toBe(1);
    expect(imgs[0]!.getAttribute('src')).toMatch(/^data:image\//);
    expect(imgs[0]!.getAttribute('alt')).toBe('图');
  });

  it('drops foreign svg/math content (lowercase tagName)', () => {
    const r = sanitizeArticle(
      '<p>文字<svg onload="x()"><script>alert(1)</script><text>坏</text></svg><math><mi>x</mi></math></p>',
    );
    expect(r.innerHTML).toBe('<p>文字</p>');
  });
});
