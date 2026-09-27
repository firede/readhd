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
const server = createServer((req, res) => {
  res.setHeader('content-type', 'text/html; charset=utf-8');
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
      'readhd-dark-a',
      'readhd-dark-b',
    ]) {
      const h = CSS.highlights.get(name);
      o[name] = h ? h.size : -1;
    }
    return o;
  });
}

async function hlTexts(page) {
  return page.evaluate(() => {
    const texts = [];
    for (const h of CSS.highlights.values()) {
      for (const r of h) texts.push(r.toString());
    }
    return texts;
  });
}

// --- fixture page, local engine ---
await setSync({ engine: 'local', enabled: true, altColor: true });
const page = await ctx.newPage();
await page.goto(fixtureUrl);
await page.waitForTimeout(1800); // appended <section> arrives at 1s
let stats = await hlStats(page);
console.log('local stats', stats);
check('local: highlights non-empty', stats['readhd-light-a'] > 0, JSON.stringify(stats));

// dynamically appended paragraph got highlights
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

// local segmentation signature: '花盆里' merged, '种下' split
let texts = await hlTexts(page);
check(
  'local tokens: 花盆里 merged, no 种下 token',
  texts.includes('花盆里') && !texts.includes('种下'),
);
await shot(page, 'after-local.png');

// --- cloud engine ---
await setSync({ engine: 'cloud' });
await shot(page, 'after-cloud.png');
if (dev) {
  // wait for the cloud result to be applied (distinguished token '种下')
  const gotCloud = await page
    .waitForFunction(
      () => {
        for (const h of CSS.highlights.values())
          for (const r of h) if (r.toString() === '种下') return true;
        return false;
      },
      { timeout: 20000 },
    )
    .then(() => true)
    .catch(() => false);
  check('cloud tokens: 种下 is a single range', gotCloud);
  // toggling a setting keeps the cached cloud segmentation
  await setSync({ colorPreset: 'red' });
  const kept = await page
    .waitForFunction(
      () => {
        for (const h of CSS.highlights.values())
          for (const r of h) if (r.toString() === '种下') return true;
        return false;
      },
      { timeout: 20000 },
    )
    .then(() => true)
    .catch(() => false);
  check('after colorPreset toggle: cloud tokens kept', kept);
  await setSync({ colorPreset: 'blue' });
  await page.waitForTimeout(800);
}
stats = await hlStats(page);
console.log('cloud stats', stats);

// disable: highlights should clear
await setSync({ enabled: false });
await page.waitForTimeout(1200);
stats = await hlStats(page);
console.log('disabled stats', stats);
check('disabled: all highlights cleared', Object.values(stats).every((v) => v === 0));
await shot(page, 'after-disable.png');
await setSync({ enabled: true });

// --- popup on a real http page: keep fixture tab active, open real popup ---
let popupShot = false;
try {
  const opt = await ctx.newPage();
  await opt.goto(`chrome-extension://${extId}/options.html`);
  const popupPromise = ctx
    .waitForEvent('page', { timeout: 5000 })
    .catch(() => null);
  await opt.evaluate(() => chrome.action.openPopup());
  await opt.waitForTimeout(1000);
  const popup = await popupPromise;
  const popupPage =
    popup ?? ctx.pages().find((p) => p.url().includes('popup.html'));
  if (popupPage) {
    await popupPage.waitForTimeout(800);
    check(
      'popup host switch visible',
      await popupPage.evaluate(() =>
        document.body.textContent.includes('在此网站启用'),
      ),
    );
    await shot(popupPage, 'popup.png');
    await popupPage.close();
    popupShot = true;
  }
  await opt.close();
} catch (e) {
  console.log('openPopup failed:', e.message);
}
if (!popupShot) {
  // Real popup windows aren't observable as playwright pages; mock the active
  // tab query so the host switch renders against the fixture host.
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
  await shot(popup, 'popup.png');
  await popup.close();
}

// --- selftest ---
const st = await ctx.newPage();
await st.goto(`chrome-extension://${extId}/selftest.html`);
await st.waitForTimeout(800);
await shot(st, 'selftest-menu.png');
await st.evaluate(() =>
  chrome.storage.local.set({
    selftestResults: [
      { ts: 1, passageId: 'snail', condition: 'on', ms: 30000, hanChars: 100, correct: 2, settingsSnapshot: {} },
      { ts: 2, passageId: 'leaves', condition: 'off', ms: 40000, hanChars: 100, correct: 1, settingsSnapshot: {} },
    ],
  }),
);
await st.reload();
await st.waitForTimeout(500);
await shot(st, 'selftest-results.png');
await st.getByText('开始自测').click();
await shot(st, 'selftest-intro.png'); // may catch 准备中… on cloud
await st.waitForTimeout(300);
const btn = st.getByRole('button', { name: /开始读|准备中/ });
if (await btn.isDisabled()) await shot(st, 'selftest-preparing.png');
await btn.click({ timeout: 15000 });
await st.waitForTimeout(800);
await shot(st, 'selftest-reading.png');
await st.getByRole('button', { name: '读完了' }).click();
await st.waitForTimeout(300);
await shot(st, 'selftest-question.png');
await st.close();
await page.close();
await boot.close();

await ctx.close();
server.close();
console.log(`DONE (${failures} failures)`);
process.exit(failures ? 1 : 0);
