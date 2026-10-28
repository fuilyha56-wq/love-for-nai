/* eslint-disable @typescript-eslint/no-require-imports -- Local browser audit for one feature tutorial. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
process.env.LFN_UI_BASE_URL ||= 'http://127.0.0.1:3000';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
process.env.LFN_UI_TEST_SESSION_SECRET ||= 'lfn-local-tutorial-ui-test-secret-only-20261026';
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const output = path.resolve('public/tutorials/text-to-image');
const reportFile = path.resolve('.tmp/feature-tutorials/text-to-image-audit.json');
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(path.dirname(reportFile), { recursive: true });
const report = { baseURL, steps: [], operations: [], downloads: [], errors: [] };
let exitReturned = false;

async function screenshot(page, index) {
  await page.evaluate(() => document.fonts.ready);
  // Hide only Next's development status portal, which can otherwise cover
  // application controls while the dev server recompiles a route.
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  const file = path.join(output, `step-${String(index + 1).padStart(2, '0')}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  const meta = await sharp(file).metadata();
  return { file: `/tutorials/text-to-image/step-${String(index + 1).padStart(2, '0')}.png`, width: meta.width, height: meta.height };
}

async function verifyTarget(page, index) {
  await page.waitForTimeout(450);
  const target = page.locator('[data-feature-tutorial-target="true"]');
  const spotlight = page.locator('.feature-tutorial-spotlight');
  assert.equal(await target.count(), 1, `Step ${index + 1} must mark exactly one target`);
  assert(await spotlight.isVisible(), `Step ${index + 1} must show its spotlight`);
  const [targetBox, spotBox] = await Promise.all([target.boundingBox(), spotlight.boundingBox()]);
  assert(targetBox && spotBox, `Step ${index + 1} target must have visible bounds`);
  assert(Math.abs(spotBox.x - Math.max(4, targetBox.x - 4)) < 2 && Math.abs(spotBox.y - Math.max(4, targetBox.y - 4)) < 2, `Step ${index + 1} spotlight must align with its target`);
  const panelBox = await page.locator('.feature-tutorial-panel').boundingBox();
  const panelOccludesTarget = Boolean(panelBox && targetBox.x < panelBox.x + panelBox.width && targetBox.x + targetBox.width > panelBox.x && targetBox.y < panelBox.y + panelBox.height && targetBox.y + targetBox.height > panelBox.y);
  assert(index !== 5 || !panelOccludesTarget, 'Result step instructions must not cover the download target');
  const text = (await page.locator('.feature-tutorial-body').innerText()).trim();
  assert(text.length > 0, `Step ${index + 1} explanation must be visible`);
  return {
    title: await page.locator('.feature-tutorial-panel h2').innerText(), panelOccludesTarget,
    target: await target.evaluate(el => ({ tag: el.tagName, role: el.getAttribute('role'), label: el.getAttribute('aria-label'), text: el.innerText.trim().slice(0, 160), className: typeof el.className === 'string' ? el.className : '', html: el.outerHTML.slice(0, 1400) })),
    emphasized: await page.locator('.feature-tutorial-body .tutorial-keyword').allTextContents(), text,
  };
}

async function next(page) {
  await page.locator('.feature-tutorial-panel footer').getByRole('button', { name: /下一步/ }).click();
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const { context, page, requests } = await setup(browser, { theme: 'paper', workspaceLayout: 'lfn' }, { width: 1440, height: 1000 });
  page.setDefaultTimeout(18000);
  page.setDefaultNavigationTimeout(90000);
  page.on('pageerror', error => report.errors.push(error.stack || error.message));
  const fixtureSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="832" height="1216"><rect width="832" height="1216" fill="#dce8e7"/><circle cx="680" cy="170" r="86" fill="#f2cc93"/><path d="M0 850L170 620L330 820L520 500L832 900V1216H0Z" fill="#7faaa0"/><path d="M0 1010L230 820L450 1030L650 730L832 920V1216H0Z" fill="#426e65"/><text x="48" y="1140" fill="white" font-size="40" font-family="sans-serif">LOCAL UI TEST IMAGE</text></svg>');
  try {
    await context.route('**/api/models', route => route.fulfill({ json: { items: ['nai-v3', 'nai-v5-full', 'nai-v5-full-medium'].map(id => ({ id, kind: '图像模型' })) } }));
    await context.route('**/api/images/operate', async route => {
      const body = route.request().postDataJSON();
      report.operations.push({ operation: body.operation, model: body.model, width: body.width, height: body.height });
      const image = await sharp(fixtureSvg).png().toBuffer();
      await route.fulfill({ json: { images: [`data:image/png;base64,${image.toString('base64')}`], historyIds: [], payment: 'aff' } });
    });
    await page.goto(`${baseURL}/profile#profile-tutorials`);
    await page.locator('[data-tutorial-id="text-to-image"]').getByRole('button', { name: /图文教程$/ }).click();
    await page.locator('#tutorial-article-title').getByText('生成第一张图片', { exact: true }).waitFor();
    const article = page.locator('.tutorial-article');
    const articleShots = article.locator('[data-tutorial-shot]');
    assert.equal(await articleShots.count(), 6, 'Article must contain six screenshot figures');
    for (let index = 0; index < 6; index++) {
      await articleShots.nth(index).scrollIntoViewIfNeeded();
      await page.waitForFunction(index => { const image = document.querySelectorAll('.tutorial-article [data-tutorial-shot]')[index]; return Boolean(image?.complete && image.naturalWidth > 0); }, index);
    }
    const loadedArticleImages = await article.locator('[data-tutorial-shot]').evaluateAll(images => images.map(img => ({ src: img.getAttribute('src'), width: img.naturalWidth, height: img.naturalHeight, alt: img.getAttribute('alt') })));
    assert.equal(loadedArticleImages.length, 6, 'Illustrated guide must render six real screenshots');
    assert(loadedArticleImages.every(image => image.width === 1440 && image.height === 1000), 'All article screenshots must be the saved local application captures');
    assert(await article.locator('.tutorial-article-step .tutorial-keyword').count() > 0, 'Article controls and key terms should be emphasized');
    report.article = { opened: true, steps: loadedArticleImages.length, images: loadedArticleImages };
    await page.getByRole('button', { name: '返回教程目录', exact: true }).click();
    await page.locator('[data-tutorial-id="text-to-image"]').waitFor();
    await page.locator('[data-tutorial-id="text-to-image"]').getByRole('button', { name: /手把手教程$/ }).click();
    await page.waitForURL('**/image');
    await page.locator('.feature-tutorial-panel h2').getByText('选择图像模型', { exact: true }).waitFor();
    await page.waitForTimeout(1300);

    // Step 1: capture the actual model/mode controls. For the remaining screenshots
    // follow the tutorial's own Next action, making only a local prompt edit.
    for (let index = 0; index < 6; index++) {
      const state = await verifyTarget(page, index);
      assert(state.emphasized.length > 0, `Step ${index + 1} should emphasize key controls or terms`);
      if (index === 1) {
        assert((await page.locator('.feature-tutorial-body').innerText()).includes('1girl, blue hair'), 'Prompt example should match the instruction');
        assert(state.emphasized.length > 0, 'Important controls and terms should be emphasized');
      }
      const shot = await screenshot(page, index);
      report.steps.push({ index, ...state, screenshot: shot });

      if (index === 0) {
        // Confirm an available image model in the real UI.
        const modelButton = page.getByRole('button', { name: '模型', exact: true }).filter({ visible: true }).first();
        if (await modelButton.count()) {
          await modelButton.click();
          const options = page.getByRole('option').filter({ visible: true });
          await options.first().waitFor();
          const labels = await options.allTextContents();
          report.modelOptions = labels;
          await options.first().click();
        }
      } else if (index === 1) {
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '收起说明，继续操作', exact: true }).click();
        const promptArea = page.locator('[data-layout-module="prompt"]');
        const input = promptArea.locator('textarea, [contenteditable="true"]').filter({ visible: true }).first();
        if (await input.count()) await input.fill('1girl, blue hair, white dress, garden, sunlight');
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '展开教程说明', exact: true }).click();
      } else if (index === 4) {
        // The generation API is intercepted above, so this exercises app state
        // without sending a paid task upstream.
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '收起说明，继续操作', exact: true }).click();
        const generate = page.locator('[data-layout-module="generate"] [data-studio-generate]:visible').first();
        if (await generate.count()) await generate.click();
        else await page.locator('[data-studio-generate]:visible').first().click();
        await page.waitForFunction(() => document.querySelector('.mobile-studio-preview-section img, .replica-media img, [data-layout-module="canvas"] img')?.getAttribute('src')?.startsWith('data:image/'), undefined, { timeout: 30000 });
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '展开教程说明', exact: true }).click();
      } else if (index === 5) {
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '收起说明，继续操作', exact: true }).click();
        const download = page.locator('.workspace-result-download, .replica-media .replica-download-menu, .image-download-menu').filter({ visible: true }).first();
        if (await download.count()) {
          await download.locator('summary').click();
          const menu = page.getByRole('menu', { name: '图片下载方式', exact: true });
          await menu.waitFor();
          const labels = await menu.innerText();
          report.downloads.push({ labels, target: await download.innerText() });
          assert(/下载/.test(labels), 'Download menu should offer a real image download');
          const downloadEvent = page.waitForEvent('download', { timeout: 5000 }).catch(() => null);
          await menu.getByRole('menuitem', { name: '下载原图', exact: true }).click();
          const file = await downloadEvent;
          if (file) {
            report.downloads[0].filename = file.suggestedFilename();
            await file.cancel();
          } else {
            await page.waitForFunction(() => document.querySelector('.workspace-result-download summary')?.getAttribute('aria-expanded') === 'false');
            assert(!/下载失败/.test(await page.locator('body').innerText()), 'Download handler should complete without a UI error');
            report.downloads[0].menuClosedAfterClick = true;
          }
        } else {
          report.downloads.push({ skipped: 'No visible result download menu matched desktop selector', controls: await page.locator('[data-layout-module="canvas"]').innerText() });
        }
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '展开教程说明', exact: true }).click();
      }

      if (index < 5) {
        await next(page);
        await page.waitForFunction(previous => document.querySelector('.feature-tutorial-panel h2')?.textContent !== previous, state.title);
        await page.waitForTimeout(900);
      }
    }

    assert.equal(report.operations.length, 1, 'Exactly one local fixture generation must be made');
    assert.equal(report.operations[0].operation, 'generate');
    assert(report.downloads[0]?.filename || report.downloads[0]?.skipped, 'Download path must be recorded');
    await page.getByRole('button', { name: '完成教程，返回教程中心', exact: true }).click();
    await page.waitForURL('**/profile#profile-tutorials');
    await page.locator('[data-tutorial-id="text-to-image"] .tutorial-completed').waitFor();
    report.returnedToTutorialCenter = true;
    report.nonGetRequests = requests.filter(request => request.method !== 'GET').map(request => ({ path: request.path, method: request.method }));
    assert(report.nonGetRequests.every(request => request.path === '/api/images/operate'), 'Tutorial audit must not perform external writes');

    const exitRun = await setup(browser, { theme: 'paper', workspaceLayout: 'lfn' }, { width: 1440, height: 1000 });
    try {
      exitRun.page.setDefaultTimeout(18000);
      await exitRun.page.goto(`${baseURL}/profile#profile-tutorials`);
      await exitRun.page.locator('[data-tutorial-id="text-to-image"]').getByRole('button', { name: /手把手教程$/ }).click();
      await exitRun.page.waitForURL('**/image');
      await exitRun.page.locator('.feature-tutorial-panel h2').getByText('选择图像模型', { exact: true }).waitFor();
      await exitRun.page.getByRole('button', { name: '退出教程，返回个人资料的教程中心', exact: true }).click();
      await exitRun.page.waitForURL('**/profile#profile-tutorials');
      await exitRun.page.locator('#tutorial-center-content').waitFor();
      assert.equal(await exitRun.page.locator('.feature-tutorial-panel').count(), 0, 'Exit must close the guide before returning');
      exitReturned = true;
    } finally { await exitRun.context.close(); }
  } catch (error) {
    report.failure = error.stack || error.message;
    report.debug = await page.evaluate(() => ({ body: document.body.innerText.slice(-3000), images: [...document.querySelectorAll('img')].map(img => ({ src: img.currentSrc.slice(0, 120), parent: img.parentElement?.className })), toolbars: [...document.querySelectorAll('.replica-media-actions')].map(el => ({ text: el.innerText, display: getComputedStyle(el).display, bounds: el.getBoundingClientRect().toJSON() })) })).catch(() => null);
    await page.screenshot({ path: path.resolve('.tmp/feature-tutorials/text-to-image-failure.png'), animations: 'disabled' }).catch(() => {});
    throw error;
  } finally {
    await context.close();
    await browser.close();
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  }
  const audit = {
    baseURL: report.baseURL,
    article: report.article,
    guidedSteps: report.steps.map(step => ({ index: step.index, title: step.title, target: { tag: step.target.tag, label: step.target.label, text: step.target.text, className: step.target.className }, panelOccludesTarget: step.panelOccludesTarget, emphasized: step.emphasized, screenshot: step.screenshot })),
    localFixtureGeneration: report.operations,
    download: report.downloads,
    returnedByCompletion: report.returnedToTutorialCenter,
    returnedByExit: exitReturned,
    nonGetRequests: report.nonGetRequests,
    runtimeErrors: report.errors.length,
  };
  fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(audit, null, 2));
  console.log(JSON.stringify({ articleSteps: report.article?.steps, guidedSteps: report.steps.length, operations: report.operations.length, downloads: report.downloads, returnedByCompletion: report.returnedToTutorialCenter, returnedByExit: exitReturned, errors: report.errors.length }, null, 2));
  assert.equal(report.errors.length, 0, report.errors.join('\n'));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
