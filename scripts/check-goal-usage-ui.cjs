/* eslint-disable @typescript-eslint/no-require-imports */
/* Synthetic accounts and intercepted model/image calls; never runs paid operations. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
process.env.LFN_UI_BASE_URL ||= 'http://127.0.0.1:3100';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const output = path.resolve('.tmp/goal-usage-ui'); fs.mkdirSync(output, { recursive: true });
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN3cAAAAASUVORK5CYII=';
const results = [], errors = [];
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [width, layout, limit] of [[390, 'lfn', 1], [1023, 'lfn', 2], [1191, 'lfn', 2], [1440, 'nai', 1], [1366, 'nlw', 1]]) {
      const name = `${layout}-${width}`;
      const prefs = layout === 'nai' ? { theme: 'nai', workspaceLayout: 'lfn' } : { theme: 'paper', workspaceLayout: layout };
      const { context, page } = await setup(browser, prefs, { width, height: 884 });
      page.on('pageerror', error => errors.push(error.message));
      const submitted = [], imageCalls = [], jobs = {}; let hold = false;
      await context.route('**/api/assistant/**', route => {
        const req = route.request(), url = new URL(req.url());
        if (url.pathname.endsWith('/models')) return route.fulfill({ json: { models: ['deepseek-v4-pro'] } });
        if (url.pathname.endsWith('/usage')) {
          const body = req.postDataJSON();
          return route.fulfill({ json: { jobs: Object.fromEntries((body.jobs || []).filter(id => jobs[id]).map(id => [id, { status: hold ? 'running' : 'done', usage: hold ? [] : jobs[id] }])), images: (body.images || []).map(id => ({ id, aff: 5.75, balanceCost: null, billing: 'settled' })) } });
        }
        if (req.method() === 'POST') {
          submitted.push(req.postDataJSON()); const n = submitted.length, id = `job-${n}`;
          jobs[id] = [{ id: `call-${n}`, requestId: `req-${n}`, inputTokens: n * 1000, outputTokens: 100, totalTokens: n * 1000 + 100, cachedInputTokens: 50, reasoningTokens: 20, quota: 5000, balanceCost: .01, billing: 'settled' }];
          if (hold) return new Promise(resolve => setTimeout(() => resolve(route.fulfill({ json: { jobId: id } })), 300));
          return route.fulfill({ json: { jobId: id } });
        }
        const id = url.searchParams.get('job');
        if (id && hold) return route.fulfill({ json: { status: 'running', usage: [], steps: [] } });
        if (id) return route.fulfill({ json: { status: 'done', usage: jobs[id], steps: [], suggestion: { prompt: 'cloud, blue sky', negativePrompt: '', parameters: {}, tags: [], goalComplete: false } } });
        return route.fulfill({ json: { turns: [], tagPool: [] } });
      });
      await context.route('**/api/images/operate', route => {
        imageCalls.push(route.request().postDataJSON());
        return route.fulfill({ headers: { 'x-lfn-request-id': `image-${imageCalls.length}` }, json: { images: [png], requestId: `image-${imageCalls.length}`, historyIds: [], payment: 'aff' } });
      });
      try {
        await page.goto(baseURL + '/image');
        await page.locator(width < 1024 ? '.mobile-studio-workbar:visible' : prefs.theme === 'nai' ? '[data-studio-layout="nai"]:visible' : `[data-workspace-layout="${layout}"]:visible`).waitFor();
        if (width < 1024) await page.getByRole('button', { name: '打开标签助手', exact: true }).click();
        else if (!await page.getByRole('textbox', { name: '标签助手输入', exact: true }).isVisible()) await page.getByRole('button', { name: '展开聊天', exact: true }).click();
        await page.getByRole('button', { name: '目标 Agent', exact: true }).click();
        await page.getByRole('button', { name: '完全访问', exact: true }).click();
        const rounds = page.getByRole('spinbutton', { name: '自动生成轮次', exact: true });
        await rounds.fill(String(limit)); await rounds.press('Tab');
        assert.equal(await page.evaluate(() => localStorage.getItem('lfn-goal-max-rounds-v1')), String(limit));
        assert.match(await rounds.evaluate(el => getComputedStyle(el).fontFamily), /Noto Sans SC/);
        await page.getByRole('textbox', { name: '标签助手输入', exact: true }).fill('A cloud over a blue sky');
        await page.getByRole('button', { name: '开始自动迭代', exact: true }).click();
        assert(await rounds.isDisabled());
        await page.locator('p:visible').filter({ hasText: '已达到完全访问轮数上限，最后建议仍可手动应用。' }).waitFor({ timeout: 60000 });
        assert.equal(imageCalls.length, limit);
        assert.equal(submitted.length, limit + 1);
        assert(submitted.every(body => body.goalMaxRounds === limit));
        assert.deepEqual(submitted.map(body => body.goalIteration), Array.from({ length: limit + 1 }, (_, n) => n));
        assert(imageCalls.every(body => body.n === 1));
        const panel = page.getByRole('region', { name: '助手上下文与消耗', exact: true });
        await panel.getByRole('button', { name: '展开用量明细', exact: true }).click();
        await panel.locator('.assistant-usage-detail').getByText(`${5.75 * limit} AFF`, { exact: true }).waitFor();
        assert.match(await panel.innerText(), new RegExp(`${limit + 1},000 tokens`));
        assert.match(await panel.innerText(), new RegExp(`0\\.0${limit + 1} 余额单位`));
        await panel.locator('summary').click();
        assert.match(await panel.innerText(), new RegExp(`合计 ${(1000 * (limit + 1) * (limit + 2) / 2 + 100 * (limit + 1)).toLocaleString('zh-CN')} tokens`));
        await panel.scrollIntoViewIfNeeded();
        const box = await panel.boundingBox(); assert(box.x >= 0 && box.x + box.width <= width + 1);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: path.join(output, `${name}.png`) });
        if ([390, 1191].includes(width)) {
          // Cancel before the first poll; the already-sent model call must remain billable/refreshable.
          hold = true;
          await rounds.fill('1'); await rounds.press('Tab');
          await page.getByRole('button', { name: '开始自动迭代', exact: true }).click();
          await page.getByRole('button', { name: '停止', exact: true }).click();
          await page.locator('p:visible').filter({ hasText: 'Agent 已停止。' }).waitFor();
          hold = false;
          await panel.getByRole('button', { name: '刷新账单', exact: true }).click();
          await panel.getByText('0.01 余额单位', { exact: true }).waitFor();
          assert.match(await panel.innerText(), /1 次模型调用/);
          assert.equal(imageCalls.length, limit);
          await page.screenshot({ path: path.join(output, `${name}-stopped.png`) });
        }
        results.push({ name, limit, images: imageCalls.length, modelJobs: submitted.length, passed: true }); console.log('PASS ' + name);
      } catch (error) { results.push({ name, passed: false, error: error.stack }); await page.screenshot({ path: path.join(output, `${name}-failed.png`) }); console.error('FAIL ' + name + ': ' + error.message); }
      finally { await context.close(); }
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2)); }
  if (errors.length || results.some(result => !result.passed)) process.exitCode = 1;
})();
