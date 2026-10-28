/* eslint-disable @typescript-eslint/no-require-imports -- Local browser audit for the prompt-writing tutorial. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

process.env.LFN_UI_BASE_URL ||= 'http://127.0.0.1:3000';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
process.env.LFN_UI_TEST_SESSION_SECRET ||= process.env.LFN_SESSION_SECRET || 'lfn-development-secret-change-me';
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');

const output = path.resolve('public/tutorials/prompt-writing');
fs.mkdirSync(output, { recursive: true });
const report = { baseURL, screenshots: [], steps: [], requests: [], externalBlocked: [], errors: [] };
const sample = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="832" height="1216"><rect width="832" height="1216" fill="#dce8e7"/><circle cx="650" cy="180" r="110" fill="#f2cc93"/><path d="M0 900L190 600L360 850L530 510L832 930V1216H0Z" fill="#7faaa0"/><path d="M0 1030L230 810L450 1040L680 770L832 940V1216H0Z" fill="#426e65"/></svg>');
const generatedPromise = sharp(sample).png().toBuffer();

async function screenshot(page, index) {
  await page.evaluate(() => document.fonts.ready);
  const name = `step-${String(index + 1).padStart(2, '0')}.png`;
  const file = path.join(output, name);
  await page.screenshot({ path: file, animations: 'disabled' });
  const meta = await sharp(file).metadata();
  assert(meta.width >= 1200 && meta.height >= 800, `Screenshot ${name} must capture the full local desktop UI`);
  report.screenshots.push({ src: `/tutorials/prompt-writing/${name}`, width: meta.width, height: meta.height });
}

async function verifyTarget(page, index) {
  const expand = page.locator('.feature-tutorial-panel button[aria-label="展开教程说明"]');
  if (await expand.count()) await expand.click();
  await page.waitForTimeout(500);
  const target = page.locator('[data-feature-tutorial-target="true"]');
  const spotlight = page.locator('.feature-tutorial-spotlight');
  assert.equal(await target.count(), 1, `Step ${index + 1}: exactly one DOM target must be marked`);
  assert(await spotlight.isVisible(), `Step ${index + 1}: spotlight must be visible`);
  const [targetBox, spotlightBox] = await Promise.all([target.boundingBox(), spotlight.boundingBox()]);
  assert(targetBox && spotlightBox, `Step ${index + 1}: target and spotlight need visible bounds`);
  assert(Math.abs(spotlightBox.x - Math.max(4, targetBox.x - 4)) < 2 && Math.abs(spotlightBox.y - Math.max(4, targetBox.y - 4)) < 2, `Step ${index + 1}: spotlight must enclose the marked DOM target`);
  assert(await target.evaluate(el => getComputedStyle(el).outlineStyle === 'solid'), `Step ${index + 1}: target must have a visible outline`);
  const emphasized = await page.locator('.feature-tutorial-body .tutorial-keyword').allTextContents();
  assert(emphasized.length > 0, `Step ${index + 1}: important words must be emphasized`);
  const footer = page.locator('.feature-tutorial-panel footer');
  const next = footer.getByRole('button').last();
  const nextLabel = (await next.innerText()).trim();
  assert(index === 6 ? nextLabel.includes('完成教程，返回教程中心') : /下一步/.test(nextLabel), `Step ${index + 1}: unexpected next button text: ${nextLabel}`);
  return {
    index, title: await page.locator('.feature-tutorial-panel h2').innerText(), nextLabel,
    target: await target.evaluate(el => ({ tag: el.tagName, role: el.getAttribute('role'), label: el.getAttribute('aria-label'), text: el.innerText.trim().slice(0, 180), className: typeof el.className === 'string' ? el.className : '' })),
    emphasized,
  };
}

(async () => {
  const generated = await generatedPromise;
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const { context, page, requests } = await setup(browser, { theme: 'paper', workspaceLayout: 'nlw' }, { width: 1440, height: 1000 });
  page.setDefaultTimeout(18000);
  page.setDefaultNavigationTimeout(90000);
  page.on('pageerror', error => report.errors.push(error.stack || error.message));
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL).origin) {
      report.externalBlocked.push({ origin: url.origin, path: url.pathname });
      return route.abort();
    }
    return route.fallback();
  });
  await context.route('**/api/images/operate', async route => {
    const body = route.request().postDataJSON();
    report.requests.push({ path: new URL(route.request().url()).pathname, method: 'POST', operation: body.operation, model: body.model });
    await route.fulfill({ json: { images: [`data:image/png;base64,${generated.toString('base64')}`], historyIds: [], payment: 'fixture' } });
  });
  try {
    await page.goto(`${baseURL}/profile#profile-tutorials`);
    await page.waitForTimeout(1000);
    const announcementDialog = page.getByRole('dialog', { name: '站点公告', exact: true });
    if (await announcementDialog.count()) await announcementDialog.getByRole('button', { name: '关闭公告', exact: true }).click({ force: true });
    const closeAnnouncement = page.getByRole('button', { name: '关闭公告', exact: true });
    if (await closeAnnouncement.count()) await closeAnnouncement.click({ force: true });
    await page.locator('[data-tutorial-id="prompt-writing"]').getByRole('button', { name: /手把手教程$/ }).click();
    await page.waitForURL('**/image');
    await page.locator('.feature-tutorial-panel h2').getByText('确认模型来源与图像模型', { exact: true }).waitFor();
    await page.waitForTimeout(1000);

    for (let index = 0; index < 7; index++) {
      const state = await verifyTarget(page, index);
      if (index === 0) {
        const guide = await page.locator('.feature-tutorial-body').innerText();
        assert(/模型列表为空|加载状态/.test(guide) && /检查来源配置/.test(guide), 'First step must explain what to do before source/model readiness');
        const modelPicker = page.getByRole('button', { name: '模型', exact: true });
        await modelPicker.click();
        const modelList = page.getByRole('listbox', { name: '模型', exact: true });
        await modelList.waitFor();
        const availableModels = await modelList.getByRole('option').allTextContents();
        report.availableModels = availableModels.map(value => value.trim());
        assert(report.availableModels.length > 0, `Model API fixture must populate the real model picker; list=${JSON.stringify(report.availableModels)}`);
        const safeFixtureModel = modelList.getByRole('option', { name: 'nai-v3', exact: true });
        if (await safeFixtureModel.count()) await safeFixtureModel.click();
        else await modelList.getByRole('option').first().click();
        await page.waitForFunction(() => !document.querySelector('.studio-model-controls')?.innerText.includes('模型\n请选择'));
        report.initialModelState = await page.locator('.studio-model-controls').innerText();
        assert(!report.initialModelState.includes('模型\n请选择'), 'A fixture model should be selected before continuing');
        report.initialModelSelection = { source: report.initialModelState.match(/模型来源\n([^\n]+)/)?.[1], model: report.initialModelState.match(/模型\n([^\n]+)/)?.[1] };
        assert.deepEqual(report.initialModelSelection, { source: 'NewAPI 账号', model: 'nai-v3' }, 'The real controls must show the selected local fixture model');
      }
      if (index === 1) {
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '收起说明，继续操作', exact: true }).click();
        const prompt = page.locator('.replica-prompt textarea, .replica-prompt [contenteditable="true"]').filter({ visible: true }).first();
        await prompt.fill('1girl, blue hair, white dress, garden, sunlight');
        await prompt.dispatchEvent('blur');
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '展开教程说明', exact: true }).click();
      }
      if (index === 2) {
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '收起说明，继续操作', exact: true }).click();
        await page.getByRole('button', { name: '标签模式', exact: true }).first().click();
        const chip = page.locator('.replica-prompt .tag-chip').filter({ hasText: /blue[_\s]hair/ }).first();
        assert.equal(await chip.count(), 1, 'The prompt tag must be available to emphasize');
        await chip.click({ button: 'right' });
        const menu = page.getByRole('menu').filter({ hasText: '增加权重' }).first();
        await menu.getByRole('menuitem', { name: /增加权重/ }).click();
        assert.equal(await page.locator('.replica-prompt .tag-chip').filter({ hasText: /blue[_\s]hair/ }).locator('.tag-chip-weight').innerText(), '1.05', 'Weight menu should visibly update the selected tag');
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '展开教程说明', exact: true }).click();
      }
      if (index === 3) {
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '收起说明，继续操作', exact: true }).click();
        const quality = page.getByRole('button', { name: '选择质量词', exact: true }).first();
        assert.equal(await quality.count(), 1, 'Quality preset control should be present for the selected model');
        await quality.click();
        await page.getByRole('button', { name: 'Standard', exact: true }).click();
        const uc = page.getByRole('button', { name: '选择负面质量词预设', exact: true }).first();
        await uc.click();
        await page.getByRole('button', { name: '轻度', exact: true }).click();
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '展开教程说明', exact: true }).click();
      }
      if (index === 4) {
        const versions = page.locator('.replica-prompt button[aria-label="提示词版本"]').first();
        assert.equal(await versions.count(), 1, 'Prompt version history control should exist');
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '收起说明，继续操作', exact: true }).click();
        await versions.click();
        const dialog = page.getByRole('dialog', { name: '提示词版本', exact: true });
        await dialog.waitFor();
        assert((await dialog.innerText()).includes('blue hair'), 'Edited prompt should appear in version history');
        await page.getByRole('button', { name: '关闭版本记录', exact: true }).click();
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '展开教程说明', exact: true }).click();
      }
      if (index === 5) {
        report.selectedModelControlsBeforeSubmit = report.initialModelSelection;
        assert.equal(report.selectedModelControlsBeforeSubmit.model, 'nai-v3', 'Generation must use the model explicitly selected from the local model fixture');
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '收起说明，继续操作', exact: true }).click();
        report.apiRequestsBeforeSubmit = [...requests];
        const generate = page.locator('.replica-run-button:visible, [data-studio-generate]:visible').first();
        assert.equal(await generate.count(), 1, 'The real workbench generation button should be visible');
        await generate.click();
        await page.waitForFunction(() => [...document.querySelectorAll('.mobile-studio-preview-section img, .replica-media img, [data-layout-module="canvas"] img')].some(img => img.currentSrc.startsWith('data:image/png;base64,')) || /体验模式不会发送真实请求|登录状态已过期/.test(document.body.innerText), undefined, { timeout: 30000 });
        const generatedLocally = await page.locator('.replica-media img, .mobile-studio-preview-section img, [data-layout-module="canvas"] img').evaluateAll(images => images.some(img => img.currentSrc.startsWith('data:image/png;base64,')));
        report.generationOutcome = generatedLocally ? 'intercepted local fixture' : (await page.locator('body').innerText()).match(/体验模式不会发送真实请求|登录状态已过期[^\n]*/)?.[0] || 'blocked before API submission';
        if (!generatedLocally) assert.equal(report.requests.length, 0, 'Blocked generation must not issue a real or fixture POST');
        else assert(report.requests.some(request => request.path === '/api/images/operate' && request.method === 'POST' && request.model === report.selectedModelControlsBeforeSubmit.model), 'Generation must be served by the local intercepted fixture for the selected model');
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '展开教程说明', exact: true }).click();
      }
      if (index === 6) {
        assert.equal(await page.locator('.replica-media, [data-layout-module="canvas"]').count() > 0, true, 'The result preview area should be mounted, even before an image is generated');
      }
      report.steps.push(state);
      await screenshot(page, index);
      if (index < 6) {
        await page.locator('.feature-tutorial-panel footer').getByRole('button').last().click();
        await page.waitForFunction(previous => document.querySelector('.feature-tutorial-panel h2')?.textContent !== previous, state.title);
        await page.waitForTimeout(450);
      }
    }

    assert(report.externalBlocked.length >= 0);
    assert.equal(requests.filter(request => request.method !== 'GET' && request.path !== '/api/images/operate').length, 0, 'No non-generation API writes may occur');
    await page.getByRole('button', { name: '完成教程，返回教程中心', exact: true }).click();
    await page.waitForURL('**/profile#profile-tutorials');
    await page.locator('[data-tutorial-id="prompt-writing"] .tutorial-completed').waitFor();
    report.completedReturnedToCenter = true;

    await page.locator('[data-tutorial-id="prompt-writing"]').getByRole('button', { name: '提示词、负面词与权重：图文教程', exact: true }).click();
    for (let index = 1; index <= 7; index++) {
      const image = page.locator(`#tutorial-prompt-writing-${index - 1} [data-tutorial-shot]`);
      await image.waitFor({ state: 'visible' });
      await image.scrollIntoViewIfNeeded();
      await image.evaluate(el => { if (el.loading === 'lazy') el.loading = 'eager'; });
      await image.waitFor({ state: 'attached' });
      await page.waitForFunction(element => element.complete && element.naturalWidth >= 1200, await image.elementHandle(), { timeout: 15000 });
      assert(await image.evaluate(el => el.complete && el.naturalWidth >= 1200), `Illustrated mode step ${index}: actual screenshot should load`);
    }
    report.illustratedModeLoadedAllSevenScreenshots = true;
    await page.getByRole('button', { name: '返回教程目录', exact: true }).click();
    await page.locator('[data-tutorial-id="prompt-writing"]').getByRole('button', { name: /手把手教程$/ }).click();
    await page.waitForURL('**/image');
    await page.getByRole('button', { name: '退出教程，返回个人资料的教程中心', exact: true }).click();
    await page.waitForURL('**/profile#profile-tutorials');
    report.exitReturnedToCenter = true;
    report.nonGetRequests = requests.filter(request => request.method !== 'GET').map(request => ({ path: request.path, method: request.method }));
    report.apiRequests = requests;
  } catch (error) {
    report.failure = error.stack || error.message;
    report.promptControls = await page.locator('[data-layout-module="prompt"]').evaluateAll(elements => elements.map(el => ({ text: el.innerText.slice(0, 500), html: el.innerHTML.slice(0, 3000) }))).catch(() => []);
    report.formFields = await page.locator('textarea,input,[contenteditable="true"]').evaluateAll(elements => elements.map(el => ({ tag: el.tagName, label: el.getAttribute('aria-label'), placeholder: el.getAttribute('placeholder'), cls: el.className, value: el.value || el.innerText || '', outer: el.outerHTML.slice(0, 600) }))).catch(() => []);
    report.apiRequests = requests;
    await page.screenshot({ path: path.join(output, 'failure.png'), animations: 'disabled' }).catch(() => {});
    throw error;
  } finally {
    report.browserErrors = report.errors;
    fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(report, null, 2));
    await context.close();
    await browser.close();
  }
  assert.equal(report.errors.length, 0, report.errors.join('\n'));
  if (fs.existsSync(path.join(output, 'failure.png'))) fs.unlinkSync(path.join(output, 'failure.png'));
  console.log(JSON.stringify({ steps: report.steps.length, screenshots: report.screenshots, completedReturnedToCenter: report.completedReturnedToCenter, exitReturnedToCenter: report.exitReturnedToCenter, illustratedModeLoadedAllSevenScreenshots: report.illustratedModeLoadedAllSevenScreenshots, requests: report.nonGetRequests, externalBlocked: report.externalBlocked.length, browserErrors: report.errors }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
