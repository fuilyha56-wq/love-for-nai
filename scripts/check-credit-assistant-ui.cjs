/* eslint-disable @typescript-eslint/no-require-imports */
/* Isolated UI regression: synthetic accounts/images; all model calls intercepted. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
process.env.LFN_UI_BASE_URL ||= 'http://127.0.0.1:3100';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const output = path.resolve('.tmp/credit-assistant-ui'); fs.mkdirSync(output, { recursive: true });
const day = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
const policy = { enabled: true, strictApiBilling: false, displayUsdPerCny: 200, v45AnlasCny: .01, v5AnlasCny: .01, v45: [{ afterImages: 0, baseCny: 0, anlasMultiplier: 1, totalMultiplier: 1 }], v5: [
  { afterImages: 0, baseCny: .04, anlasMultiplier: 1, totalMultiplier: 1 }, { afterImages: 75, baseCny: .04, anlasMultiplier: 1, totalMultiplier: 1.1 },
  { afterImages: 125, baseCny: .04, anlasMultiplier: 1, totalMultiplier: 1.15 }, { afterImages: 200, baseCny: .04, anlasMultiplier: 1, totalMultiplier: 1.2 },
] };
const pricing = { policy, cnyPerAff: .005, fixedCosts: {}, asOf: new Date().toISOString() };
const dailyBilling = { policy, cnyPerAff: .005, counts: { v45: 0, v5: 125 }, day, packageCny: 1, affPerPackage: 400 };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN3cAAAAASUVORK5CYII=', 'base64');
const results = [], errors = [];
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [width, workspaceLayout] of [[390, 'lfn'], [1023, 'lfn'], [1191, 'lfn'], [1440, 'nai'], [1366, 'nlw']]) {
      const name = `${workspaceLayout}-${width}`;
      const { context, page } = await setup(browser, { theme: 'paper', workspaceLayout }, { width, height: 884 });
      page.on('pageerror', error => errors.push(error.message));
      const submitted = [];
      await context.route('**/api/public/credit-pricing', route => route.fulfill({ json: pricing }));
      await context.route('**/api/wallet', route => route.fulfill({ json: { dailyBilling, aff: { enabled: true, balance: 100.1234, packageBalance: 1.2345, totalBalance: 101.3579, packageRateLimitRemaining: 10 } } }));
      await context.route('**/api/assistant/**', route => {
        if (route.request().url().includes('/models')) return route.fulfill({ json: { models: ['deepseek-v4-pro'] } });
        if (route.request().method() === 'POST') { submitted.push(route.request().postDataJSON()); return route.fulfill({ json: { jobId: 'fixture' } }); }
        if (route.request().url().includes('?job=')) return route.fulfill({ json: { status: 'done', suggestion: { prompt: 'cloud', negativePrompt: '', parameters: {}, tags: [] }, validatedTags: [], rejectedTags: [], unverifiedTags: [] } });
        return route.fulfill({ json: { turns: [], tagPool: [] } });
      });
      try {
        await page.goto(baseURL + '/image');
        const trigger = page.locator('[data-credit-pricing-trigger]:visible').first();
        await trigger.click();
        const dialog = page.getByRole('dialog', { name: '当前定价与阶梯计费', exact: true });
        await dialog.getByText('5.75 AFF', { exact: false }).first().waitFor();
        assert.match(await dialog.innerText(), /0\.01/);
        assert.match(await dialog.innerText(), /1\.2345/);
        assert.match(await dialog.innerText(), /4\.5155/);
        const box = await dialog.boundingBox(); assert(box.x >= 0 && box.x + box.width <= width + 1);
        assert.equal(await dialog.locator('table').count(), 4);
        await page.screenshot({ path: path.join(output, `${name}-pricing.png`) });
        await page.goBack(); await dialog.waitFor({ state: 'hidden' });
        assert(new URL(page.url()).pathname === '/image');
        if (width < 1024) await page.getByRole('button', { name: '打开标签助手', exact: true }).click();
        else if (!await page.getByRole('textbox', { name: '标签助手输入', exact: true }).isVisible()) await page.getByRole('button', { name: '展开聊天', exact: true }).click();
        const input = page.getByRole('textbox', { name: '标签助手输入', exact: true });
        await input.waitFor();
        const reasoning = page.getByRole('combobox', { name: '助手思考强度', exact: true });
        assert.equal(await reasoning.inputValue(), 'high');
        assert.deepEqual(await reasoning.locator('option').evaluateAll(options => options.map(option => option.value)), ['low', 'high', 'max']);
        await reasoning.selectOption('max');
        const files = Array.from({ length: 10 }, (_, index) => ({ name: `${index}.png`, mimeType: 'image/png', buffer: png }));
        await page.locator('.assistant-attachments:visible input[type=file]').setInputFiles(files);
        await page.getByRole('button', { name: '移除参考图 10', exact: true }).waitFor();
        assert.equal(await page.locator('.assistant-attachments:visible img').count(), 10);
        assert(await page.locator('.assistant-attachments:visible input').isDisabled());
        await page.getByRole('button', { name: '移除参考图 5', exact: true }).click();
        await page.locator('.assistant-attachments:visible input').setInputFiles([files[0]]);
        await page.getByRole('button', { name: '移除参考图 10', exact: true }).waitFor();
        await input.fill('Compare all ten reference pictures'); await input.press('Enter');
        await page.waitForTimeout(350);
        assert.equal(submitted.length, 1); assert.equal(submitted[0].images.length, 10); assert.equal(submitted[0].reasoningEffort, 'max');
        await page.screenshot({ path: path.join(output, `${name}-attachments.png`) });
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        results.push({ name, passed: true }); console.log('PASS ' + name);
      } catch (error) { results.push({ name, passed: false, error: error.stack }); await page.screenshot({ path: path.join(output, `${name}-failed.png`) }); console.error('FAIL ' + name + ': ' + error.message); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2)); }
  if (errors.length || results.some(result => !result.passed)) process.exitCode = 1;
})();
