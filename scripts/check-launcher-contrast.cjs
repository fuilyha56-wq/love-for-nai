/* eslint-disable @typescript-eslint/no-require-imports -- Local visual acceptance. */
const fs = require('node:fs');
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const { installContentFixtures } = require('./ui-content-fixtures.cjs');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = [];
  try {
    for (const theme of ['paper', 'dusk', 'night', 'nai']) {
      const { context, page } = await setup(browser, { theme }, { width: 1180, height: 1000 });
      await installContentFixtures(context);
      await page.goto(baseURL + '/docs');
      await page.locator('.docs-directory button').first().waitFor();
      const samples = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = 1; canvas.height = 1;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        const rgb = value => { ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = value; ctx.fillRect(0, 0, 1, 1); const data = [...ctx.getImageData(0, 0, 1, 1).data]; return [...data.slice(0, 3), data[3] / 255]; };
        const luminance = ([r, g, b]) => [r, g, b].map(x => x / 255).map(x => x <= .04045 ? x / 12.92 : ((x + .055) / 1.055) ** 2.4).reduce((sum, x, i) => sum + x * [.2126, .7152, .0722][i], 0);
        const selectors = ['.launcher-rail a[href="/settings"]', '.launcher-page-identity>svg', '.docs-directory [aria-current=page] b', '.docs-directory small', '.docs-article>header p:first-child', '.docs-article>footer'];
        return selectors.map(selector => {
          const el = document.querySelector(selector);
          if (!el) return { selector, missing: true };
          const foreground = getComputedStyle(el).color;
          let current = el;
          let background;
          while (current) { const color = getComputedStyle(current).backgroundColor; if (rgb(color)[3] !== 0) { background = color; break; } current = current.parentElement; }
          const values = [luminance(rgb(foreground)), luminance(rgb(background || 'rgb(255,255,255)'))].sort((a, b) => b - a);
          return { selector, foreground, background, ratio: +( (values[0] + .05) / (values[1] + .05)).toFixed(2) };
        });
      });
      results.push({ theme, samples });
      await page.screenshot({ path: `.tmp/launcher-ui/docs-contrast-${theme}.png`, animations: 'disabled' });
      await context.close();
    }
  } finally { await browser.close(); }
  fs.writeFileSync('.tmp/launcher-ui/contrast.json', JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results));
})();
