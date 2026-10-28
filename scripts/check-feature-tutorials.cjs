/* eslint-disable @typescript-eslint/no-require-imports -- Local browser acceptance runner. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTutorialCatalog } = require('./tutorial-test-support.cjs');
process.env.LFN_UI_BASE_URL ||= 'http://127.0.0.1:3000';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
process.env.LFN_UI_TEST_SESSION_SECRET ||= process.env.LFN_SESSION_SECRET || 'lfn-development-secret-change-me';
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const output = path.resolve('.tmp/feature-tutorials');
fs.mkdirSync(output, { recursive: true });
const catalog = loadTutorialCatalog();
const results = [];
const runtimeErrors = [];

async function screenshot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
}
async function fit(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page has horizontal overflow');
  const panel = page.locator('.feature-tutorial-panel');
  if (await panel.count()) {
    const bounds = await panel.boundingBox();
    const viewport = page.viewportSize();
    assert(bounds && bounds.y >= 0 && bounds.x >= 0 && bounds.y + bounds.height <= viewport.height + 1 && bounds.x + bounds.width <= viewport.width + 1, 'Tour must fit the viewport');
  }
}
async function center(page) {
  await page.goto(`${baseURL}/profile#profile-tutorials`);
  await page.getByRole('heading', { name: '选择你想学习的功能' }).waitFor();
}
async function start(page, id) {
  await page.locator(`[data-tutorial-id="${id}"]`).getByRole('button', { name: /：手把手教程$/ }).click();
  await page.locator('.feature-tutorial-panel').waitFor();
  await page.locator('.feature-tutorial-panel h2').waitFor();
}
async function next(page) {
  const old = await page.locator('.feature-tutorial-panel h2').textContent();
  await page.locator('.feature-tutorial-panel footer').getByRole('button', { name: /下一步/ }).click();
  await page.waitForFunction(previous => document.querySelector('.feature-tutorial-panel h2')?.textContent !== previous, old);
}
async function exit(page) {
  await page.getByRole('button', { name: '退出教程，返回个人资料的教程中心', exact: true }).click();
  await page.waitForURL('**/profile#profile-tutorials');
  await page.locator('#tutorial-center-content').waitFor();
  await page.waitForFunction(() => !sessionStorage.getItem('lfn-feature-tutorial-session-v1'));
  const root = page.locator('#profile-tutorials');
  const box = await root.boundingBox();
  assert(box && box.y >= -5 && box.y < page.viewportSize().height, 'Return must scroll to tutorials');
  assert.equal(await page.locator('.feature-tutorial-panel').count(), 0);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    for (const [width, height, theme, workspaceLayout] of [[1440, 1000, 'paper', 'lfn'], [390, 844, 'night', 'lfn'], [320, 640, 'paper', 'lfn'], [1440, 1000, 'nai', 'nai'], [1440, 1000, 'paper', 'nlw']]) {
      if (process.env.LFN_TUTORIAL_WIDTH && width !== Number(process.env.LFN_TUTORIAL_WIDTH)) continue;
      const { context, page, requests } = await setup(browser, { theme, workspaceLayout }, { width, height });
      page.setDefaultTimeout(18000);
      page.setDefaultNavigationTimeout(90000);
      page.on('pageerror', error => runtimeErrors.push(error.stack || error.message));
      try {
        await center(page);
        assert.equal(await page.locator('.tutorial-card').count(), catalog.featureTutorials.length);
        await fit(page);
        await screenshot(page, `center-${width}-${theme}-${workspaceLayout}`);
        await page.getByLabel('搜索功能教程').fill('超分');
        assert.equal(await page.locator('.tutorial-card').count(), 2);
        await page.getByLabel('搜索功能教程').fill('');
        await page.getByRole('group', { name: '教程分类' }).getByRole('button', { name: '图像编辑', exact: true }).click();
        assert(await page.locator('.tutorial-card').count() >= 6);
        await page.getByRole('group', { name: '教程分类' }).getByRole('button', { name: '全部', exact: true }).click();

        const readAll = width === 1440 && workspaceLayout === 'lfn';
        for (const tutorial of readAll ? catalog.featureTutorials : catalog.featureTutorials.filter(item => ['text-to-image', 'inpaint', 'upscale'].includes(item.id))) {
          await page.locator(`[data-tutorial-id="${tutorial.id}"]`).getByRole('button', { name: /：图文教程$/ }).click();
          await page.locator('#tutorial-article-title').getByText(tutorial.title, { exact: true }).waitFor();
          assert.equal(await page.locator('.tutorial-article-step img[data-tutorial-shot]').count(), tutorial.steps.length);
          await fit(page);
          if (tutorial.id === 'inpaint') await screenshot(page, `reading-inpaint-${width}-${theme}`);
          await page.getByRole('button', { name: '返回教程目录', exact: true }).click();
        }
        results.push({ width, theme, workspaceLayout, scenario: 'catalog-search-and-illustrated-guides', passed: true });

        for (const id of ['text-to-image', 'inpaint', 'upscale', 'tiled-upscale']) {
          await start(page, id);
          await page.waitForURL('**/image');
          await page.locator(width < 1024 ? '.mobile-studio-launcher' : '[data-studio-layout]').waitFor();
          await page.waitForTimeout(1300);
          await fit(page);
          if (id === 'text-to-image') await screenshot(page, `guide-first-${width}-${theme}-${workspaceLayout}`);
          await page.getByRole('button', { name: '收起说明，继续操作', exact: true }).first().click();
          assert(await page.getByRole('button', { name: '退出教程，返回个人资料的教程中心', exact: true }).isVisible());
          await exit(page);
          results.push({ width, theme, workspaceLayout, scenario: `${id}-start-collapse-exit-return`, passed: true });
        }

        await start(page, 'text-to-image');
        await page.waitForURL('**/image');
        await next(page); // prompt
        await page.waitForTimeout(1300);
        assert(await page.locator('.feature-tutorial-spotlight').isVisible(), 'Prompt target must be highlighted');
        const promptArea = page.locator(width < 1024 ? '.mobile-studio-prompt-content' : '[data-tutorial="prompt"], .replica-prompt, [data-layout-module="prompt"], .studio-prompt-panel').filter({ visible: true }).first();
        const input = promptArea.locator('textarea, [contenteditable="true"]').filter({ visible: true }).first();
        await input.fill('1girl, blue hair, white dress, garden, sunlight');
        await screenshot(page, `guide-prompt-${width}-${theme}-${workspaceLayout}`);
        await next(page); // size
        await page.waitForTimeout(1300);
        assert(await page.locator('.feature-tutorial-spotlight').isVisible(), 'Size target must be highlighted');
        await next(page); // sampling
        await page.waitForTimeout(1300);
        assert(await page.locator('.feature-tutorial-spotlight').isVisible(), 'Sampling target must be highlighted');
        await screenshot(page, `guide-sampling-${width}-${theme}-${workspaceLayout}`);
        await page.reload();
        await page.locator('.feature-tutorial-panel h2').getByText('认识生成参数', { exact: true }).waitFor();
        await next(page); // generate
        await next(page); // result
        await page.locator('.feature-tutorial-panel').getByRole('button', { name: '完成教程，返回教程中心', exact: true }).click();
        await page.waitForURL('**/profile#profile-tutorials');
        await page.locator('[data-tutorial-id="text-to-image"] .tutorial-completed').waitFor();
        assert((await page.locator('.tutorial-return-notice').textContent()).includes('已完成'));
        await fit(page);
        await screenshot(page, `completed-${width}-${theme}-${workspaceLayout}`);
        assert.equal(requests.filter(request => request.method !== 'GET').length, 0, 'Reading and tour navigation must not submit operations');
        results.push({ width, theme, workspaceLayout, scenario: 'guided-prompt-resume-complete-return', passed: true });
      } catch (error) {
        results.push({ width, theme, workspaceLayout, passed: false, error: error.stack || error.message });
        await screenshot(page, `failure-${width}-${theme}-${workspaceLayout}`).catch(() => {});
        fs.writeFileSync(path.join(output, `failure-${width}-${theme}-${workspaceLayout}.json`), JSON.stringify({ requests: requests.map(request => ({ path: request.path, method: request.method })), ui: await page.locator('body').innerText() }, null, 2));
        console.error(`FAIL ${width}/${theme}/${workspaceLayout}: ${error.message}`);
        if (process.env.LFN_TUTORIAL_STOP_ON_ERROR) throw error;
      } finally { await context.close(); }
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(output, `results-${process.env.LFN_TUTORIAL_WIDTH || 'all'}.json`), JSON.stringify({ results, runtimeErrors }, null, 2));
  }
  console.log(JSON.stringify({ passed: results.filter(item => item.passed).length, failed: results.filter(item => !item.passed).length, runtimeErrors: runtimeErrors.length }));
  assert.equal(runtimeErrors.length, 0, runtimeErrors.join('\n'));
  if (results.some(item => !item.passed)) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
