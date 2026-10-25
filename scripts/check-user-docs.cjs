/* eslint-disable @typescript-eslint/no-require-imports -- Local browser documentation acceptance. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const compiled = ts.transpileModule(fs.readFileSync('src/lib/documentation-content.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const generated = {};
new Function('exports', compiled)(generated);
const guides = generated.documentationGuides.map(guide => ({ ...guide, status: 'published', createdAt: '2026-10-24T00:00:00Z', updatedAt: '2026-10-24T00:00:00Z' }));
const output = path.resolve('.tmp/discovery-ui');
const results = [];
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    for (const [width, theme] of [[1440, 'paper'], [390, 'night'], [320, 'paper']]) {
      const { context, page } = await setup(browser, { theme, workspaceLayout: 'lfn' }, { width, height: 960 });
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.setDefaultTimeout(12000);
      page.setDefaultNavigationTimeout(90000);
      await context.route('**/api/docs', route => route.fulfill({ json: { items: guides } }));
      try {
        await page.goto(`${baseURL}/docs`);
        await page.getByRole('region', { name: '文档搜索与筛选' }).getByText('19', { exact: true }).waitFor();
        for (const guide of guides) {
          try {
            await page.getByRole('navigation', { name: '文档目录', exact: true }).getByRole('button', { name: guide.title, exact: false }).click();
            const article = page.locator('article');
            await article.getByText(guide.title, { exact: true }).first().waitFor();
            await page.evaluate(() => document.fonts.ready);
            for (const img of await article.locator('img').all()) {
              await img.scrollIntoViewIfNeeded();
              await img.evaluate(image => image.decode());
              assert(await img.evaluate(image => image.naturalWidth > 0), `Broken illustration: ${guide.slug}`);
            }
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Horizontal overflow: ${guide.slug}`);
            if (['launcher-integration', 'api-overview', 'gallery-discovery', 'openai-compatible-api', 'account-and-check-in'].includes(guide.slug)) {
              await page.evaluate(() => scrollTo(0, 0));
              await page.screenshot({ path: `${output}/guide-${guide.slug}-${width}-${theme}.png`, animations: 'disabled' });
            }
            results.push({ width, theme, slug: guide.slug, passed: true });
          } catch (error) { results.push({ width, theme, slug: guide.slug, passed: false, error: error.message }); console.error(`FAIL ${guide.slug} ${width}: ${error.message}`); }
          if (width < 840) await page.getByRole('button', { name: '返回目录', exact: true }).click();
        }
        assert.equal(errors.length, 0, errors.join('\n'));
        console.log(`Checked ${guides.length} articles at ${width}px (${theme})`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); fs.writeFileSync(`${output}/guide-results.json`, JSON.stringify(results, null, 2)); }
  if (results.some(result => !result.passed)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
