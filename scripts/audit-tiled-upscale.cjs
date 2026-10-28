/* Local-only audit for the tiled-upscale feature tutorial. */
/* eslint-disable @typescript-eslint/no-require-imports -- standalone browser audit */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');

assert(['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname), 'Use localhost only');
assert(process.env.LFN_UI_TEST_SESSION_SECRET, 'Set the fixture-only LFN_UI_TEST_SESSION_SECRET');

const publicDir = path.resolve('public/tutorials/tiled-upscale');
const tempDir = path.resolve('.tmp/tiled-upscale-audit');
const failureDir = path.join(tempDir, 'failures');
const stepTargets = [
  ['.studio-mode-picker', '.mobile-studio-mode-selector'],
  ['[data-tutorial="source"]', '.mobile-studio-reference-panel', 'button[data-tutorial-editor="canvas"]'],
  ['.editor-mode-tabs button:nth-child(3)'],
  ['[data-tutorial="editor-params"]', '.editor-mobile-sheet-body'],
  ['.editor-actions button.generate-button'],
  ['.editor-actions .download-result-button summary', '.editor-actions button.apply-button'],
];
const results = [];

async function blockExternalRequests(context, audit) {
  const allowedOrigin = new URL(baseURL).origin;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== allowedOrigin) {
      audit.blockedExternal.push(url.href);
      return route.abort('blockedbyclient');
    }
    return route.fallback();
  });
}

async function highlightedTarget(page, allowed) {
  return page.evaluate(selectors => {
    const marked = [...document.querySelectorAll('[data-feature-tutorial-target="true"]')];
    if (marked.length !== 1) return { error: `expected one highlighted target, found ${marked.length}` };
    const element = marked[0];
    const rect = element.getBoundingClientRect();
    return {
      matches: selectors.some(selector => element.matches(selector)),
      tag: element.tagName.toLowerCase(),
      text: (element.innerText || element.getAttribute('aria-label') || '').trim().slice(0, 160),
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      visible: rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth,
      emphasizedTerms: document.querySelectorAll('.feature-tutorial-body mark.tutorial-keyword').length,
    };
  }, allowed);
}

async function waitForTarget(page, allowed, step) {
  await page.waitForFunction(selectors => {
    const marked = [...document.querySelectorAll('[data-feature-tutorial-target="true"]')];
    if (marked.length !== 1) return false;
    const element = marked[0], rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && selectors.some(selector => element.matches(selector));
  }, allowed, { timeout: 15000 });
  const state = await highlightedTarget(page, allowed);
  assert.equal(state.matches, true, `step ${step}: wrong DOM target ${JSON.stringify(state)}`);
  assert.equal(state.visible, true, `step ${step}: target outside viewport ${JSON.stringify(state)}`);
  assert(state.emphasizedTerms > 0, `step ${step}: tutorial terms are not emphasized`);
  return state;
}

async function screenshot(page, filename) {
  await page.waitForTimeout(350);
  await page.screenshot({ path: filename, animations: 'disabled' });
}

async function expandGuide(page) {
  const button = page.locator('.feature-tutorial-panel button[aria-label="展开教程说明"]');
  if (await button.count()) await button.first().click();
}

async function openGuide(page) {
  await page.goto(`${baseURL}/profile#profile-tutorials`);
  const card = page.locator('[data-tutorial-id="tiled-upscale"]');
  await card.waitFor({ state: 'visible' });
  await card.getByRole('button', { name: '分块超分：手把手教程', exact: true }).click();
  await page.locator('[data-testid="feature-tutorial"]').waitFor({ state: 'visible' });
  await page.waitForURL(/\/image(?:\?|$)/);
}

async function nextStep(page, expected) {
  await page.locator('.feature-tutorial-panel footer button').last().click();
  await page.waitForFunction(title => document.querySelector('.feature-tutorial-panel h2')?.innerText === title, expected);
}

async function enterImageToImage(page) {
  const model = page.locator('.studio-model-controls .popup-select-trigger[aria-label="模型"]:visible, [role="dialog"] [aria-label="模型"]:visible').first();
  if (await model.count()) {
    await model.click();
    const option = page.getByRole('option', { name: /nai-v5-full/i }).first();
    if (await option.count()) await option.click();
    else await page.keyboard.press('Escape');
  }
  const mobile = page.locator('.mobile-studio-mode-selector:visible');
  if (await mobile.count()) {
    await page.getByRole('button', { name: '生成模式', exact: true }).click();
    const option = page.getByRole('option', { name: '图生图', exact: true });
    if (await option.count()) await option.click();
    else await page.getByText('图生图', { exact: true }).last().click();
  } else {
    const trigger = page.locator('.studio-mode-picker .studio-mode-badge:visible').first();
    await trigger.click();
    const option = page.getByRole('option', { name: '图生图', exact: true });
    if (await option.count()) await option.click();
    else await page.getByText('图生图', { exact: true }).last().click();
  }
  await page.waitForFunction(() => document.querySelector('.studio-mode-picker .studio-mode-badge, .mobile-studio-mode-selector')?.getAttribute('data-current-operation') === 'img2img');
}

async function runGuide(browser, viewport, shared, sourceBuffer) {
  const { context, page, requests } = await setup(browser, { theme: 'paper', workspaceLayout: 'lfn' }, viewport);
  await blockExternalRequests(context, shared);
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(90000);
  const errors = [];
  const consoleErrors = [];
  const apiWrites = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin === new URL(baseURL).origin && url.pathname.startsWith('/api/') && request.method() !== 'GET')
      apiWrites.push({ path: url.pathname, method: request.method() });
  });
  const imageCalls = [];
  await context.route('**/api/images/operate', async route => {
    const body = route.request().postDataJSON();
    imageCalls.push({ operation: body.operation, width: body.width, height: body.height, model: body.model });
    const width = Math.max(64, Math.min(1024, Number(body.width) || 512));
    const height = Math.max(64, Math.min(1024, Number(body.height) || 512));
    const png = await sharp(sourceBuffer).resize(width, height, { fit: 'fill' }).png().toBuffer();
    await route.fulfill({ json: { images: [`data:image/png;base64,${png.toString('base64')}`], historyIds: [], payment: 'fixture' } });
  });
  const result = { viewport, steps: [], requests, imageCalls, apiWrites, errors, consoleErrors };
  const screenshotDir = viewport.width < 1024 ? path.join(tempDir, 'mobile') : path.join(tempDir, 'desktop');
  fs.mkdirSync(screenshotDir, { recursive: true });

  try {
    await openGuide(page);
    for (let index = 0; index < stepTargets.length; index += 1) {
      if (index === 0) {
        await page.getByRole('button', { name: '收起说明，继续操作', exact: true }).first().click();
        await enterImageToImage(page);
      }
      if (index === 1) {
        const uploadButton = page.getByRole('button', { name: /上传图片|上传源图片|上传源图|源图片/ }).filter({ visible: true }).first();
        let chooser;
        if (await uploadButton.count()) {
          const event = page.waitForEvent('filechooser');
          await uploadButton.click();
          chooser = await event;
        } else {
          const input = page.locator('[data-tutorial="source"] input[type="file"], .mobile-studio-reference-panel input[type="file"], input[type="file"]').first();
          await input.setInputFiles({ name: 'tiled-upscale-practice.png', mimeType: 'image/png', buffer: sourceBuffer });
        }
        if (chooser) await chooser.setFiles({ name: 'tiled-upscale-practice.png', mimeType: 'image/png', buffer: sourceBuffer });
        await page.waitForFunction(() => Boolean(document.querySelector('[data-tutorial-source-ready="true"]')) || Boolean(document.querySelector('[data-tutorial="source"] img, .mobile-studio-reference-panel img')));
      }
      if (index === 2) {
        if (viewport.width < 1024) await page.getByRole('button', { name: '收起说明，继续操作', exact: true }).first().click();
        await page.getByRole('button', { name: '分块超分', exact: true }).click();
        await page.waitForURL(/mode=tiled-upscale/);
        if (viewport.width < 1024) await page.getByRole('button', { name: '打开编辑面板' }).click().catch(() => {});
      }
      if (index === 3 && viewport.width < 1024) {
        const paramsTab = page.getByRole('button', { name: '生成', exact: true }).first();
        if (await paramsTab.count()) await paramsTab.click();
      }

      await expandGuide(page);
      const target = await waitForTarget(page, stepTargets[index], index + 1);
      const name = `step-${String(index + 1).padStart(2, '0')}.png`;
      const screenshotPath = path.join(screenshotDir, name);
      await screenshot(page, screenshotPath);
      if (viewport.width >= 1024) fs.copyFileSync(screenshotPath, path.join(publicDir, name));
      result.steps.push({ number: index + 1, target, screenshot: screenshotPath });

      if (index === 1) {
        const entry = page.locator('button[data-tutorial-editor="canvas"]:visible').first();
        await entry.waitFor({ state: 'visible' });
        await entry.click();
        await page.waitForURL(/\/image\/editor\?/);
        await page.locator('.editor-stage canvas').first().waitFor({ state: 'visible' });
      }
      if (index === 4) {
        await page.locator('.editor-actions button.generate-button:visible').click();
        await page.locator('.editor-actions button.apply-button:visible').waitFor({ state: 'visible', timeout: 90000 });
        assert(imageCalls.length >= 1, 'the image operation must be captured by the local fixture');
      }
      if (index < stepTargets.length - 1) {
        if (index === 0) await nextStep(page, '从源图打开图像编辑器');
        else if (index === 1) await nextStep(page, '切换到分块超分');
        else if (index === 2) await nextStep(page, '核对倍率、块数与模型');
        else if (index === 3) await nextStep(page, '提交并等待分块拼接');
        else if (index === 4) await nextStep(page, '检查拼接结果并保存');
      }
    }

    await page.locator('.feature-tutorial-panel footer button').last().click();
    await page.waitForURL(/\/profile#profile-tutorials/);
    await page.locator('[role="status"]').filter({ hasText: '已完成「分块超分」，已回到教程中心。' }).waitFor();
    assert(apiWrites.every(write => write.path === '/api/images/operate' && write.method === 'POST'), `unexpected API writes: ${JSON.stringify(apiWrites)}`);
    result.returnedToTutorialCenter = true;
    assert.deepEqual(errors, [], `page runtime errors: ${errors.join('\n')}`);
    return result;
  } catch (error) {
    fs.mkdirSync(failureDir, { recursive: true });
    try { await page.screenshot({ path: path.join(failureDir, `${viewport.width}x${viewport.height}-failure.png`), fullPage: true }); } catch {}
    fs.writeFileSync(path.join(failureDir, `${viewport.width}x${viewport.height}-partial.json`), `${JSON.stringify(result, null, 2)}\n`);
    throw error;
  } finally { await context.close(); }
}

async function auditArticle(browser, shared) {
  const { context, page } = await setup(browser, {}, { width: 1440, height: 1000 });
  await blockExternalRequests(context, shared);
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  try {
    await page.goto(`${baseURL}/profile#profile-tutorials`);
    const card = page.locator('[data-tutorial-id="tiled-upscale"]');
    await card.getByRole('button', { name: '分块超分：图文教程', exact: true }).click();
    const steps = page.locator('.tutorial-article-step');
    assert.equal(await steps.count(), stepTargets.length, 'article must show all tiled-upscale steps');
    const images = page.locator('img[data-tutorial-shot]');
    assert.equal(await images.count(), stepTargets.length, 'every article step must have a real screenshot');
    for (const image of await images.all()) {
      await image.scrollIntoViewIfNeeded();
      await page.waitForFunction(element => element.complete && element.naturalWidth > 0, await image.elementHandle());
      await image.evaluate(element => element.decode());
    }
    const emphasized = await steps.locator('mark.tutorial-keyword').count();
    assert(emphasized >= stepTargets.length, 'important terms must be emphasized in the article');
    assert.deepEqual(errors, [], `article runtime errors: ${errors.join('\n')}`);
    return { steps: await steps.count(), screenshotsLoaded: await images.count(), emphasizedTerms: emphasized };
  } finally { await context.close(); }
}

async function earlyExit(browser, shared) {
  const { context, page } = await setup(browser, {}, { width: 1440, height: 1000 });
  await blockExternalRequests(context, shared);
  try {
    await openGuide(page);
    await page.locator('.feature-tutorial-panel footer button').last().click();
    await page.locator('.feature-tutorial-panel h2').getByText('从源图打开图像编辑器', { exact: true }).waitFor();
    await page.locator('.feature-tutorial-exit').click();
    await page.waitForURL(/\/profile#profile-tutorials/);
    await page.locator('[role="status"]').filter({ hasText: '已退出「分块超分」，已回到教程中心。' }).waitFor();
    return { returnedToTutorialCenter: true, midTutorial: true };
  } finally { await context.close(); }
}

(async () => {
  fs.mkdirSync(publicDir, { recursive: true });
  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(failureDir, { recursive: true });
  for (const filename of fs.readdirSync(publicDir)) {
    if (/^step-\d{2}\.png$/.test(filename) || filename === 'audit.json') fs.unlinkSync(path.join(publicDir, filename));
  }
  // This bitmap is only a harmless browser input fixture. The evidence files are
  // screenshots captured from the running application in Chromium/Edge.
  const fixtureSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1536" height="1024"><defs><linearGradient id="sky" y2="1"><stop stop-color="#c8dff2"/><stop offset="1" stop-color="#f4d8b8"/></linearGradient></defs><rect width="1536" height="1024" fill="url(#sky)"/><circle cx="1190" cy="220" r="100" fill="#fff0bf"/><path d="M0 700 360 350 700 690 1060 280 1536 720V1024H0Z" fill="#6e917d"/><path d="M0 850 480 600 870 870 1190 570 1536 850V1024H0Z" fill="#476c61"/><path d="M0 980Q400 760 760 960T1536 900V1024H0Z" fill="#bd9a70"/></svg>';
  const sourceBuffer = await sharp(Buffer.from(fixtureSvg)).png().toBuffer();
  const shared = { blockedExternal: [] };
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    const desktop = await runGuide(browser, { width: 1440, height: 1000 }, shared, sourceBuffer);
    console.log('PASS desktop guide and fixture-backed tiled operation');
    for (let index = 1; index <= stepTargets.length; index += 1) {
      const name = `step-${String(index).padStart(2, '0')}.png`;
      fs.copyFileSync(path.join(tempDir, 'desktop', name), path.join(publicDir, name));
    }
    const mobile = await runGuide(browser, { width: 390, height: 844 }, shared, sourceBuffer);
    console.log('PASS phone guide and fixture-backed tiled operation');
    const article = await auditArticle(browser, shared);
    console.log('PASS article screenshots loaded');
    const exit = await earlyExit(browser, shared);
    console.log('PASS mid-tutorial exit return path');
    const apiWrites = [...desktop.apiWrites, ...mobile.apiWrites];
    assert(apiWrites.every(write => write.path === '/api/images/operate' && write.method === 'POST'), `unexpected API writes: ${JSON.stringify(apiWrites)}`);
    const audit = {
      auditedAt: new Date().toISOString(),
      baseURL,
      method: 'Local Edge browser, fake test session, real application screenshots and local-only image-operation fixture',
      externalRequestsBlocked: true,
      blockedExternalRequestCount: shared.blockedExternal.length,
      imageOperationWrites: 'POST /api/images/operate was fulfilled in Playwright with a local PNG fixture; other API writes were rejected by the shared helper.',
      fixtureOperationCalls: desktop.imageCalls.length + mobile.imageCalls.length,
      apiWrites,
      pageRuntimeErrors: [...desktop.errors, ...mobile.errors],
      unrelatedConsoleErrors: [...desktop.consoleErrors, ...mobile.consoleErrors],
      article,
      completion: desktop.returnedToTutorialCenter && mobile.returnedToTutorialCenter,
      earlyExit: exit,
      desktop: { steps: desktop.steps.map(({ number, target, screenshot }) => ({ number, target, screenshot: `/tutorials/tiled-upscale/${path.basename(screenshot)}` })) },
      mobile: { steps: mobile.steps.map(({ number, target }) => ({ number, target })) },
    };
    fs.writeFileSync(path.join(publicDir, 'audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
    fs.writeFileSync(path.join(tempDir, 'audit-results.json'), `${JSON.stringify(audit, null, 2)}\n`);
    console.log(`PASS: six steps audited on desktop and phone; article screenshots loaded; fixture operation intercepted; completion and mid-exit returned to tutorial center.`);
  } catch (error) {
    fs.writeFileSync(path.join(failureDir, 'failure.txt'), error.stack || error.message);
    console.error(`FAIL: ${error.stack || error.message}`);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
