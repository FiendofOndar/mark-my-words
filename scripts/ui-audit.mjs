/**
 * Walks every screen at phone width and reports the three things that are easy
 * to break and invisible in a unit test: console errors, horizontal overflow,
 * and tap targets too small to hit with a thumb. Writes a screenshot per screen.
 *
 * Playwright is deliberately not a dependency of this project: it is heavy, CI
 * does not need it, and the browser binary is provided by the environment
 * rather than by npm. Install it where you are running this, and point
 * CHROMIUM at a binary if the default is not right.
 *
 *   npm run dev &
 *   npm i --no-save playwright
 *   OUT=/tmp/audit node scripts/ui-audit.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:5173';
const OUT = process.env.OUT ?? '.audit';
const EXECUTABLE = process.env.CHROMIUM ?? undefined;

/** Below this a target is hard to hit with a thumb. */
const MIN_TARGET = 34;

const issues = [];
const browser = await chromium.launch(EXECUTABLE ? { executablePath: EXECUTABLE } : {});
const context = await browser.newContext({
  viewport: { width: 400, height: 880 },
  permissions: ['notifications'],
});
const page = await context.newPage();

page.on('pageerror', (e) => issues.push(`PAGEERROR: ${e.message}`));
page.on(
  'console',
  (m) =>
    m.type() === 'error' &&
    // The seeded data links to real sites this machine cannot reach.
    !/ERR_(TUNNEL|CONNECTION|NAME)/.test(m.text()) &&
    issues.push(`CONSOLE: ${m.text().slice(0, 140)}`),
);

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1500);
// Start from the seed every time, or the run depends on the last one.
await page.evaluate(
  () =>
    new Promise((resolve) => {
      const request = indexedDB.deleteDatabase('mark-my-words');
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    }),
);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('main ul > li', { timeout: 20000 });
await page.waitForTimeout(1200);

async function shot(name, path) {
  if (path) {
    await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(900);
  }

  const overflow = await page.evaluate(() => ({
    scrolled: document.documentElement.scrollWidth,
    visible: document.documentElement.clientWidth,
  }));
  if (overflow.scrolled > overflow.visible + 1) {
    issues.push(`${name} overflows horizontally (${overflow.scrolled} > ${overflow.visible})`);
  }

  const small = await page.evaluate((min) => {
    const bad = [];
    for (const el of document.querySelectorAll('button, a, select, input[type=checkbox]')) {
      const box = el.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) continue;
      // A control wrapped in a label is tapped by the whole label, so measure
      // that rather than the 20px box drawn inside it.
      const target = (el.closest('label') ?? el).getBoundingClientRect();
      if (target.height < min) {
        bad.push(`${el.tagName}"${(el.textContent || '').trim().slice(0, 24)}" ${Math.round(target.height)}px`);
      }
    }
    return bad.slice(0, 6);
  }, MIN_TARGET);
  if (small.length) issues.push(`${name} small tap targets: ${small.join(' | ')}`);

  await page.screenshot({ path: `${OUT}/${name}.png` });
}

await shot('feed', '/');
await shot('standings', '/standings');
await shot('settings', '/settings');
await shot('capture', '/new');

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
await page.locator('main ul > li a').first().click();
await page.waitForTimeout(800);
await shot('detail');

await page.goto(`${BASE}/standings`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(600);
await page.locator('main a').first().click();
await page.waitForTimeout(800);
await shot('author');

await page.goto(BASE, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(800);
await page.getByRole('button', { name: /Void/ }).click();
await page.waitForTimeout(500);
await shot('empty');

await browser.close();

console.log(`Screenshots in ${OUT}`);
if (issues.length === 0) {
  console.log('No issues.');
} else {
  console.log(`${issues.length} issue(s):\n  - ${issues.join('\n  - ')}`);
  process.exitCode = 1;
}
