// Playwright E2E smoke for the built extension.
// Usage: node scripts/e2e.mjs [--dev]
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFileSync, mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const dev = process.argv.includes('--dev');
const extDir = resolve(dev ? '.output/chrome-mv3-dev' : '.output/chrome-mv3');
const outDir = '/tmp/readhd-evidence';
mkdirSync(outDir, { recursive: true });

const fixture = readFileSync(resolve('scripts/fixture.html'), 'utf8');
const article = readFileSync(resolve('scripts/article.html'), 'utf8');
const server = createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
  if (req.url === '/article.html') return res.end(article);
  if (req.url === '/bare.html')
    return res.end('<!doctype html><html><body><p>很短。</p></body></html>');
  res.end(fixture);
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const fixtureUrl = `http://127.0.0.1:${port}/fixture.html`;

const profile = mkdtempSync(join(tmpdir(), 'readhd-prof-'));
const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    `--disable-extensions-except=${extDir}`,
    `--load-extension=${extDir}`,
    '--no-first-run',
  ],
});

// MV3 service workers start lazily; load the fixture first so the content
// script (engine=cloud by default) wakes it up.
const boot = await ctx.newPage();
await boot.goto(fixtureUrl);
let sw = ctx.serviceWorkers()[0];
if (!sw) sw = await ctx.waitForEvent('serviceworker', { timeout: 20000 });
const extId = new URL(sw.url()).hostname;
console.log('extension id:', extId);

let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${detail}`);
  if (!ok) failures++;
}

async function setSync(kv) {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${extId}/options.html`);
  await p.evaluate((kv) => chrome.storage.sync.set(kv), kv);
  await p.close();
}

async function shot(page, name) {
  await page.screenshot({ path: join(outDir, name), fullPage: true });
  console.log('saved', join(outDir, name));
}

async function hlStats(page) {
  return page.evaluate(() => {
    const o = {};
    for (const name of [
      'readhd-light-a',
      'readhd-light-b',
      'readhd-light-f',
      'readhd-dark-a',
      'readhd-dark-b',
      'readhd-dark-f',
    ]) {
      const h = CSS.highlights.get(name);
      o[name] = h ? h.size : -1;
    }
    return o;
  });
}

// text -> highlight name containing a range with exactly that text
async function hlOf(page, text) {
  return page.evaluate((t) => {
    for (const [name, h] of CSS.highlights.entries())
      for (const r of h) if (r.toString() === t) return name;
    return null;
  }, text);
}

async function waitForToken(page, text, timeout = 25000) {
  return page
    .waitForFunction(
      (t) => {
        for (const h of CSS.highlights.values())
          for (const r of h) if (r.toString() === t) return true;
        return false;
      },
      text,
      { timeout },
    )
    .then(() => true)
    .catch(() => false);
}

// --- fixture page, local engine, word mode ---
await setSync({ engine: 'local', enabled: true, altColor: true, colorUnit: 'word' });
const page = await ctx.newPage();
await page.goto(fixtureUrl);
await page.waitForTimeout(1800); // appended <section> arrives at 1s
let stats = await hlStats(page);
console.log('local stats', stats);
check('local: highlights non-empty', stats['readhd-light-a'] > 0, JSON.stringify(stats));

const appended = await page.evaluate(() => {
  const p = document.getElementById('appended');
  if (!p) return { exists: false, ranges: 0 };
  let ranges = 0;
  for (const h of CSS.highlights.values())
    for (const r of h)
      if (r.startContainer?.parentElement === p || r.startContainer === p.firstChild)
        ranges++;
  return { exists: true, ranges };
});
check('appended paragraph highlighted', appended.exists && appended.ranges > 0, JSON.stringify(appended));
check('local tokens: 花盆里 merged, no 种下 token',
  (await hlOf(page, '花盆里')) !== null && (await hlOf(page, '种下')) === null);
await shot(page, 'm2a-word-local.png');

// ask the SW for the (cached) analysis of a text — deterministic across calls
async function analyzeViaSw(text) {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${extId}/options.html`);
  const r = await p.evaluate((t) =>
    chrome.runtime.sendMessage({ type: 'analyze', texts: [t] }), text);
  await p.close();
  return r?.[0] ?? null;
}

const P_SEL = '小明在花盆里种下三颗豆子。';

// Range texts living inside the given paragraph's single text node.
function rangesOn(page, sel) {
  return page.evaluate((sel) => {
    const p = [...document.querySelectorAll('p')].find(
      (x) => x.textContent === sel && x.firstChild?.nodeType === 3,
    );
    if (!p) return null;
    const node = p.firstChild;
    const out = {};
    for (const [name, h] of CSS.highlights.entries()) {
      const texts = [];
      for (const r of h) if (r.startContainer === node) texts.push(r.toString());
      if (texts.length) out[name] = texts;
    }
    return out;
  }, sel);
}

// Cloud analyses can transiently fail (per-item/per-batch validation or API
// hiccup); failures aren't cached, so a reload is a legitimate retry. Wait for
// the paragraph's highlight tokens to exactly match the SW-provided cloud
// word set, reloading up to 4 times.
async function ensureCloud(page, sel, expected) {
  const exp = new Set(expected);
  for (let attempt = 0; attempt < 6; attempt++) {
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      const r = await rangesOn(page, sel);
      if (r) {
        const all = Object.values(r).flat();
        if (all.length && all.every((t) => exp.has(t))) return r;
      }
      await page.waitForTimeout(1000);
    }
    await page.reload();
    await page.waitForTimeout(1500);
  }
  return await rangesOn(page, sel);
}

async function analyzeRetry(text) {
  for (let i = 0; i < 6; i++) {
    const a = await analyzeViaSw(text);
    if (a?.source === 'cloud') return a;
    await new Promise((r) => setTimeout(r, 2000));
  }
  return null;
}

// --- cloud engine, word mode ---
await setSync({ engine: 'cloud' });
if (dev) {
  const cloud = await analyzeRetry(P_SEL);
  check('cloud analysis available', !!cloud, JSON.stringify(cloud?.words?.slice(0, 3)));
  const expected = cloud.words
    .filter((w) => /[\u4e00-\u9fff\w]/.test(w.text))
    .map((w) => w.text);
  const applied = await ensureCloud(page, P_SEL, expected);
  check('cloud word-mode ranges match model tokens', !!applied && Object.keys(applied).length > 0,
    JSON.stringify(applied));
}
await shot(page, 'm2a-word-cloud.png');

// --- chunk mode (cloud) ---
// Compare the render against the analysis the PAGE actually used (dev hook);
// the model's chunking varies between API calls. Reload once if the cloud
// analysis never arrived.
if (dev) {
  await setSync({ colorUnit: 'chunk' });
  const ok = await page
    .waitForFunction(
      (sel) => {
        const dbg = JSON.parse(
          document.getElementById('readhd-dbg')?.textContent || '{}',
        );
        const a = dbg[sel];
        if (!a || a.source !== 'cloud') return false;
        const p = [...document.querySelectorAll('p')].find(
          (x) => x.textContent === sel,
        );
        if (!p) return false;
        const node = p.firstChild;
        const isWL = (t) => /[\u4e00-\u9fff\w]/.test(t);
        const byChunk = new Map();
        for (const w of a.words) {
          if (!isWL(w.text)) continue;
          (byChunk.get(w.chunk) ?? byChunk.set(w.chunk, []).get(w.chunk)).push(
            w.text,
          );
        }
        const chunks = [...byChunk.values()];
        const clsOf = (t) => {
          for (const [name, h] of CSS.highlights.entries())
            for (const r of h)
              if (r.startContainer === node && r.toString() === t)
                return name;
          return null;
        };
        const cls = chunks.map((c) => c.map(clsOf));
        if (cls.some((c) => c.some((x) => x == null))) return false;
        for (const c of cls) if (!c.every((x) => x === c[0])) return false;
        for (let i = 1; i < cls.length; i++)
          if (cls[i][0] === cls[i - 1][0]) return false;
        return true;
      },
      P_SEL,
      { timeout: 60000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    console.log('  actual ranges:', JSON.stringify(await rangesOn(page, P_SEL)));
    console.log('  analysis:', JSON.stringify(await page.evaluate((s) => JSON.parse(document.getElementById('readhd-dbg')?.textContent || '{}')[s], P_SEL))?.slice(0, 600));
  }
  check('chunk mode: same-chunk same class, adjacent alternate', ok);
  await shot(page, 'm2a-chunk-cloud.png');
}

// --- fade function words (cloud) ---
// P_SEL has no u/y words; use the single-text-node 春天 paragraph (了 → u).
const F_SEL =
  '春天来了，小草从土里钻出来，柳树抽出了嫩绿的新芽，燕子也从南方飞回来了。';
if (dev) {
  const fcloud = await analyzeRetry(F_SEL);
  const faded = (fcloud?.words ?? [])
    .filter((w) => w.pos === 'u' || w.pos === 'y')
    .map((w) => w.text);
  check('fade: model returned u/y words', faded.length > 0, JSON.stringify(faded));
  await setSync({ fadeFunctionWords: true, colorUnit: 'word' });
  const ok = await page
    .waitForFunction(
      ({ sel, fadedTexts }) => {
        const p = [...document.querySelectorAll('p')].find(
          (x) => x.textContent === sel,
        );
        if (!p) return false;
        const node = p.firstChild;
        const f = CSS.highlights.get('readhd-light-f');
        if (!f || f.size === 0) return false;
        const ftexts = [...f]
          .filter((r) => r.startContainer === node)
          .map((r) => r.toString());
        return fadedTexts.every((t) => ftexts.includes(t));
      },
      { sel: F_SEL, fadedTexts: faded },
      { timeout: 60000 },
    )
    .then(() => true)
    .catch(() => false);
  if (!ok) console.log('  actual ranges:', JSON.stringify(await rangesOn(page, F_SEL)));
  check('fade: u/y words in readhd-light-f', ok, JSON.stringify(faded));
  await shot(page, 'm2a-fade.png');
  await setSync({ fadeFunctionWords: false });
}

// --- reading ruler ---
await setSync({ readingRuler: true, rulerLines: 2 });
await page.waitForTimeout(800);
await page.mouse.move(300, 300);
await page.waitForTimeout(400);
const rulerOk = await page.evaluate(() => {
  const host = document.querySelector('div.readhd-root');
  if (!host || !host.shadowRoot) return { host: false };
  const masks = host.shadowRoot.querySelectorAll('.mask');
  const shown = [...masks].filter((m) => m.style.display === 'block');
  return { host: true, masks: masks.length, shown: shown.length };
});
check('ruler: shadow host + 2 masks shown', rulerOk.host && rulerOk.masks === 2 && rulerOk.shown === 2, JSON.stringify(rulerOk));
await shot(page, 'm2a-ruler.png');
await setSync({ readingRuler: false });
await page.waitForTimeout(800);
check('ruler off: host removed', await page.evaluate(() => !document.querySelector('div.readhd-root')));

// disable: highlights should clear
await setSync({ enabled: false });
await page.waitForTimeout(1200);
stats = await hlStats(page);
console.log('disabled stats', stats);
check('disabled: all highlights cleared', Object.values(stats).every((v) => v === 0));
await shot(page, 'm2a-disabled.png');
await setSync({ enabled: true });

// --- popup ---
let popupShot = false;
try {
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${extId}/options.html`);
  const popupPromise = ctx
    .waitForEvent('page', { timeout: 5000 })
    .catch(() => null);
  await opt.evaluate(() => chrome.action.openPopup());
  await opt.waitForTimeout(1000);
  const popupPage =
    (await popupPromise) ??
    ctx.pages().find((p) => p.url().includes('popup.html'));
  if (popupPage) {
    await popupPage.waitForTimeout(800);
    await shot(popupPage, 'm2a-popup.png');
    await popupPage.close();
    popupShot = true;
  }
  await opt.close();
} catch (e) {
  console.log('openPopup failed:', e.message);
}
if (!popupShot) {
  const popup = await ctx.newPage();
  await popup.addInitScript((url) => {
    const orig = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (q) =>
      q?.active ? Promise.resolve([{ id: 1, url }]) : orig(q);
  }, fixtureUrl);
  await popup.goto(`chrome-extension://${extId}/popup.html`);
  await popup.waitForTimeout(800);
  check(
    'popup host switch visible (mocked active tab)',
    await popup.evaluate(() =>
      document.body.textContent.includes('在此网站启用'),
    ),
  );
  await shot(popup, 'm2a-popup.png');
  await popup.close();
}

// --- M2-B: reader mode ---
async function toggleReaderOn(pageUrl) {
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${extId}/options.html`);
  await opt.evaluate(
    (url) =>
      chrome.tabs
        .query({})
        .then((tabs) =>
          chrome.tabs.sendMessage(tabs.find((t) => t.url === url).id, {
            type: 'toggleReader',
          }),
        ),
    pageUrl,
  );
  await opt.close();
}

await setSync({ engine: 'cloud', enabled: true, readerGap: 'none' });
const ap = await ctx.newPage();
await ap.goto(`http://127.0.0.1:${port}/article.html`);
await ap.waitForTimeout(1200);
await toggleReaderOn(ap.url());
await ap.waitForTimeout(1500);

const readerInfo = await ap.evaluate(() => {
  const host = document.querySelector('div.readhd-root#readhd-reader');
  if (!host?.shadowRoot) return { open: false };
  const sr = host.shadowRoot;
  const content = sr.querySelector('.col');
  return {
    open: true,
    title: sr.querySelector('h1')?.textContent ?? '',
    hasScript: !!content.querySelector('script'),
    onclick: content.querySelector('[onclick]') !== null,
    wA: content.querySelectorAll('span.w.a').length,
    wB: content.querySelectorAll('span.w.b').length,
    imgs: content.querySelectorAll('img').length,
    htmlOverflow: document.documentElement.style.overflow,
  };
});
check('reader: overlay open + title', readerInfo.open === true && readerInfo.title.includes('森林里的小狐狸'), JSON.stringify(readerInfo));
check('reader: no script/onclick in content', !readerInfo.hasScript && !readerInfo.onclick);
check('reader: word spans a/b present', readerInfo.wA > 0 && readerInfo.wB > 0);
check('reader: page scroll locked', readerInfo.htmlOverflow === 'hidden');
await shot(ap, 'm2b-reader-word.png');

// chunk gaps (cloud): some span.w gets margin-inline-end, and no margined
// span is directly followed by punctuation. The model sometimes returns zero
// adjacent word→word chunk boundaries (clause-sized chunks) — that's a
// legitimate no-gap render, so retry with a fresh page/analysis up to 3 times.
if (dev) {
  const gapState = () =>
    ap.evaluate(() => {
      const sr = document.querySelector(
        'div.readhd-root#readhd-reader',
      )?.shadowRoot;
      if (!sr) return { open: false };
      const margined = [...sr.querySelectorAll('span.w')].filter(
        (s) => parseFloat(getComputedStyle(s).marginInlineEnd) > 0,
      );
      const badPunct = margined.some((s) => {
        const t = (s.nextSibling?.textContent ?? '').replace(/^\s+/, '');
        return /^[，。！？；：、）】」』'".,!?;:)]/.test(t);
      });
      // count adjacent word→word chunk boundaries in the analyses used
      let boundaries = 0;
      let cloudParas = 0;
      const dbg = JSON.parse(
        sr.querySelector('#readhd-dbg')?.textContent || '[]',
      );
      for (const rp of dbg) {
        const a = rp.analysis;
        if (!a || a.source !== 'cloud') continue;
        cloudParas++;
        const w = a.words;
        const isWL = (t) => /[\u4e00-\u9fff\w]/.test(t);
        for (let i = 0; i < w.length; i++) {
          if (!isWL(w[i].text)) continue;
          for (let j = i + 1; j < w.length; j++) {
            if (/^\s+$/.test(w[j].text)) continue;
            if (isWL(w[j].text) && w[j].chunk !== w[i].chunk) boundaries++;
            break;
          }
        }
      }
      return {
        open: true,
        margined: margined.length,
        badPunct,
        cloudParas,
        boundaries,
      };
    });
  let gapOk = false;
  let last = null;
  for (let attempt = 0; attempt < 3 && !gapOk; attempt++) {
    await setSync({ readerGap: 'chunk' });
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      last = await gapState();
      if (last.open === false) break;
      if (last.margined > 0 && !last.badPunct) {
        gapOk = true;
        break;
      }
      // cloud arrived everywhere and there is nothing to gap → hopeless round
      if (last.cloudParas > 0 && last.boundaries === 0) break;
      await ap.waitForTimeout(1000);
    }
    if (!gapOk && attempt < 2) {
      await toggleReaderOn(ap.url()); // closes (toggle)
      await ap.waitForTimeout(500);
      await ap.reload();
      await ap.waitForTimeout(1500);
      await toggleReaderOn(ap.url());
      await ap.waitForTimeout(1500);
    }
  }
  check('reader: chunk gaps give margin', gapOk, JSON.stringify(last));
  await shot(ap, 'm2b-reader-chunk-gap.png');
} else {
  await shot(ap, 'm2b-reader-chunk-gap.png');
}

// TTS: press play; either no zh voice message or a sentence highlight appears
await ap.evaluate(() => {
  const sr = document.querySelector('div.readhd-root#readhd-reader').shadowRoot;
  const btns = [...sr.querySelectorAll('button')];
  btns.find((b) => b.textContent.includes('朗读')).click();
});
await ap.waitForTimeout(3000);
const ttsInfo = await ap.evaluate(() => {
  const sr = document.querySelector('div.readhd-root#readhd-reader')?.shadowRoot;
  if (!sr) return {};
  return {
    msg: sr.querySelector('.ttsmsg')?.textContent ?? '',
    sentRanges: CSS.highlights.get('readhd-tts-sent')?.size ?? 0,
    btn: [...sr.querySelectorAll('button')].find((b) => /朗读|暂停|继续/.test(b.textContent))?.textContent,
  };
});
check(
  'reader tts: no-voice message or sentence highlight',
  ttsInfo.msg === '没有找到中文语音' || (ttsInfo.sentRanges ?? 0) > 0,
  JSON.stringify(ttsInfo),
);
await shot(ap, 'm2b-reader-tts.png');

// Esc closes and restores html overflow
await ap.keyboard.press('Escape');
await ap.waitForTimeout(600);
const afterEsc = await ap.evaluate(() => ({
  open: !!document.querySelector('div.readhd-root#readhd-reader'),
  overflow: document.documentElement.style.overflow,
}));
check('reader: Esc closes + overflow restored', !afterEsc.open && afterEsc.overflow === '', JSON.stringify(afterEsc));

// toast on a page with no article
const bp = await ctx.newPage();
await bp.goto(`http://127.0.0.1:${port}/bare.html`);
await bp.waitForTimeout(800);
await toggleReaderOn(bp.url());
await bp.waitForTimeout(1200);
const toast = await bp.evaluate(() => {
  const hosts = [...document.querySelectorAll('div.readhd-root')];
  const t = hosts.find((h) => h.shadowRoot?.querySelector('.t'));
  return {
    toast: t?.shadowRoot?.querySelector('.t')?.textContent ?? null,
    readerOpen: !!document.querySelector('div.readhd-root#readhd-reader'),
  };
});
check('toast on no-article page', toast.toast === '这个页面没有找到可以阅读的正文' && !toast.readerOpen, JSON.stringify(toast));
await shot(bp, 'm2b-toast.png');
await bp.close();
await ap.close();

// options page with voice picker
{
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${extId}/options.html`);
  await opt.waitForTimeout(1000);
  check(
    'options: voice picker + rate slider',
    await opt.evaluate(() => !!document.getElementById('voice') && !!document.getElementById('rate')),
  );
  await shot(opt, 'm2b-options-voice.png');
  await opt.close();
}

await page.close();
await boot.close();
await ctx.close();
server.close();
console.log(`DONE (${failures} failures)`);
process.exit(failures ? 1 : 0);
