/* Local-only UI regression; all assistant/model calls are intercepted. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
process.env.LFN_UI_BASE_URL ||= 'http://127.0.0.1:3100';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const output = path.resolve('.tmp/assistant-input-ui'); fs.mkdirSync(output, { recursive: true });
const results = [], errors = [];
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const width of [390, 1023, 1024, 1366]) {
      const { context, page } = await setup(browser, { theme: 'paper', workspaceLayout: 'nlw' }, { width, height: 900 });
      page.on('pageerror', error => errors.push(error.message));
      const requests = [];
      await context.route('**/api/assistant/**', async route => {
        const req = route.request(), url = new URL(req.url());
        if (url.pathname.endsWith('/models')) return route.fulfill({ json: { models: ['text-chat'] } });
        if (req.method() === 'POST') { requests.push(req.postDataJSON()); return route.fulfill({ json: { jobId: 'input-test' } }); }
        if (url.searchParams.has('job')) return route.fulfill({ json: { status: 'done', suggestion: { prompt: '1girl', negativePrompt: 'lowres', message: '输入测试完成', tags: [], parameters: {} }, validatedTags: [], rejectedTags: [], unverifiedTags: [] } });
        return route.fulfill({ json: { turns: [], tagPool: [] } });
      });
      try {
        await page.goto(baseURL + '/image');
        await page.locator('[data-studio-layout]').waitFor();
        if (width < 1024) await page.getByRole('button', { name: '打开标签助手', exact: true }).click();
        else if (!await page.getByRole('textbox', { name: '标签助手输入', exact: true }).isVisible()) await page.getByRole('button', { name: '展开聊天', exact: true }).click();
        const input = page.getByRole('textbox', { name: '标签助手输入', exact: true });
        await input.waitFor();
        await page.getByText('text-chat', { exact: true }).first().waitFor();
        assert.equal(await input.getAttribute('maxlength'), '10000');
        const text = '字'.repeat(10000);
        await input.fill(text);
        await input.press('End');
        await page.keyboard.insertText('字');
        assert.equal((await input.inputValue()).length, 10000);
        assert.match(await page.locator('[data-assistant-input-count]:visible').innerText(), /10,000\s*\/\s*10,000/);
        await input.press('Enter');
        await page.waitForFunction(() => !document.querySelector('button[type=submit]:disabled'));
        assert.equal(requests.length, 1);
        assert.equal(requests[0].request, text);
        await page.getByRole('button', { name: '目标 Agent', exact: true }).click();
        await input.fill(text);
        await input.press('Enter');
        await page.waitForTimeout(400);
        assert.equal(requests.length, 2);
        assert.equal(requests[1].goal, text);
        assert.equal(requests[1].goalMode, true);
        const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }));
        assert(geometry.scrollWidth <= geometry.width + 1, 'Horizontal overflow');
        await page.screenshot({ path: path.join(output, width + '.png') });
        results.push({ width, passed: true }); console.log('PASS assistant-input-' + width);
      } catch (error) {
        results.push({ width, passed: false, error: error.stack });
        await page.screenshot({ path: path.join(output, width + '-failed.png') });
        console.error('FAIL assistant-input-' + width + ': ' + error.message);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2)); }
  if (results.some(item => !item.passed) || errors.length) process.exitCode = 1;
})();
