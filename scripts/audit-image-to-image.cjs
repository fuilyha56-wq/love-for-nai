/* eslint-disable @typescript-eslint/no-require-imports -- Local Playwright audit for one feature tutorial. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
process.env.LFN_UI_BASE_URL ||= 'http://127.0.0.1:3000';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
// Shared local Next dev uses this synthetic session secret; do not load the
// user's real .env.local secret into the browser audit.
process.env.LFN_UI_TEST_SESSION_SECRET = 'lfn-local-tutorial-ui-test-secret-only-20261026';
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');

const output = path.resolve('public/tutorials/image-to-image');
const tempOutput = path.resolve('.tmp/feature-tutorials/image-to-image');
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(tempOutput, { recursive: true });
const report = { baseURL, testedAt: new Date().toISOString(), article: null, desktop: [], mobile: [], completionReturnedToCenter: false, exitReturnedToCenter: false, operations: [], operationNetwork: [], externalRequestsBlocked: [], nonGetRequests: [], runtimeErrors: [] };
const sourceSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="832" height="1216"><rect width="832" height="1216" fill="#dce8e7"/><circle cx="650" cy="180" r="110" fill="#f2cc93"/><path d="M0 900L190 600L360 850L530 510L832 930V1216H0Z" fill="#7faaa0"/><path d="M0 1030L230 810L450 1040L680 770L832 940V1216H0Z" fill="#426e65"/></svg>');
const resultSvg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="832" height="1216"><rect width="832" height="1216" fill="#f3e1dc"/><circle cx="650" cy="180" r="110" fill="#e3a276"/><path d="M0 900L190 600L360 850L530 510L832 930V1216H0Z" fill="#d79291"/><path d="M0 1030L230 810L450 1040L680 770L832 940V1216H0Z" fill="#965b72"/></svg>');
const sourcePng = sharp(sourceSvg).png().toBuffer();
const generatedPng = sharp(resultSvg).png().toBuffer();
const fixtureFile = path.join(tempOutput, 'local-source-fixture.png');

async function capture(page, index, isMobile) {
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  const name = `step-${String(index + 1).padStart(2, '0')}.png`;
  const file = isMobile ? path.join(tempOutput, `mobile-${name}`) : path.join(output, name);
  await page.screenshot({ path: file, animations: 'disabled' });
  const meta = await sharp(file).metadata();
  assert(meta.width >= 320 && meta.height >= 640, `${name} must be a real browser screenshot`);
  if (!isMobile) assert(meta.width >= 1200 && meta.height >= 800, `${name} must capture the desktop application`);
  return { file: isMobile ? `.tmp/feature-tutorials/image-to-image/${path.basename(file)}` : `/tutorials/image-to-image/${name}`, width: meta.width, height: meta.height };
}

async function verifyStep(page, index, isMobile) {
  await page.waitForTimeout(550);
  const target = page.locator('[data-feature-tutorial-target="true"]');
  const spotlight = page.locator('.feature-tutorial-spotlight');
  assert.equal(await target.count(), 1, `${isMobile ? 'Mobile' : 'Desktop'} step ${index + 1} must mark exactly one DOM target`);
  assert(await spotlight.isVisible(), `Step ${index + 1} must show a spotlight`);
  const [targetBox, spotBox] = await Promise.all([target.boundingBox(), spotlight.boundingBox()]);
  assert(targetBox && spotBox && targetBox.width > 0 && targetBox.height > 0, `Step ${index + 1} target must be visible`);
  assert(Math.abs(spotBox.x - Math.max(4, targetBox.x - 4)) < 2 && Math.abs(spotBox.y - Math.max(4, targetBox.y - 4)) < 2, `Step ${index + 1} spotlight must align to its target`);
  assert(Math.abs(spotBox.width - (Math.min(page.viewportSize().width - 4, targetBox.x + targetBox.width + 4) - Math.max(4, targetBox.x - 4))) < 2, `Step ${index + 1} spotlight width must align to its target`);
  assert(await target.evaluate(el => getComputedStyle(el).outlineStyle === 'solid'), `Step ${index + 1} target needs a visible outline`);
  const emphasized = await page.locator('.feature-tutorial-body .tutorial-keyword').allTextContents();
  assert(emphasized.length > 0, `Step ${index + 1} must emphasize important terms`);
  const state = {
    index: index + 1,
    title: await page.locator('.feature-tutorial-panel h2').innerText(),
    target: await target.evaluate(el => ({ tag: el.tagName, label: el.getAttribute('aria-label'), text: (el.innerText || el.value || '').trim().slice(0, 180), className: typeof el.className === 'string' ? el.className : '' })),
    targetBounds: targetBox,
    spotlightBounds: spotBox,
    emphasized,
  };
  return state;
}

async function launchGuide(page) {
  await page.goto(`${baseURL}/profile#profile-tutorials`);
  await page.locator('[data-tutorial-id="image-to-image"]').getByRole('button', { name: /手把手教程$/ }).click();
  await page.waitForURL('**/image');
  await page.locator('.feature-tutorial-panel h2').getByText('选择图生图模式', { exact: true }).waitFor();
  await page.waitForTimeout(1200);
}

async function chooseFixtureModel(page, isMobile) {
  if (isMobile) {
    const parameters = page.getByRole('button', { name: '打开生成参数', exact: true });
    if (await parameters.count()) await parameters.click();
  }
  const model = page.getByRole('button', { name: '模型', exact: true }).filter({ visible: true }).first();
  if (await model.count()) {
    await model.click();
    const options = page.getByRole('option').filter({ visible: true });
    await options.first().waitFor({ timeout: 12000 });
    await options.first().click();
  }
  if (isMobile) await page.keyboard.press('Escape');
}

async function setSource(page, isMobile) {
  const sourceReady = page.locator('[data-tutorial-source-ready="true"]');
  if (await sourceReady.count()) return;
  await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '收起说明，继续操作', exact: true }).click();
  if (isMobile) {
    const referenceButton = page.getByRole('button', { name: /参考图与更多工具/ });
    if (await referenceButton.count()) await referenceButton.click();
    const file = page.locator('.mobile-reference-tools input[type="file"][accept*="image"]');
    await file.setInputFiles({ name: 'local-image-to-image-fixture.png', mimeType: 'image/png', buffer: await sourcePng });
  } else {
    const file = page.locator('[data-tutorial="source"] input[type="file"][accept*="image"]').first();
    await file.setInputFiles({ name: 'local-image-to-image-fixture.png', mimeType: 'image/png', buffer: await sourcePng });
  }
  await page.waitForSelector('[data-tutorial-source-ready="true"]', { timeout: 12000 });
  await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '展开教程说明', exact: true }).click();
}

async function exercise(browser, isMobile, browserErrors) {
  const size = isMobile ? { width: 390, height: 844 } : { width: 1440, height: 1000 };
  const { context, page, requests } = await setup(browser, { theme: 'paper', workspaceLayout: 'lfn' }, size);
  page.setDefaultTimeout(18000);
  page.setDefaultNavigationTimeout(90000);
  page.on('pageerror', error => browserErrors.push(`${isMobile ? 'mobile' : 'desktop'}: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error' && !/favicon|Failed to load resource.*404/.test(message.text())) browserErrors.push(`${isMobile ? 'mobile' : 'desktop'} console: ${message.text()}`); });
  page.on('request', request => {
    if (new URL(request.url()).pathname === '/api/images/operate') {
      const body = request.postDataJSON();
      report.operationNetwork.push({ device: isMobile ? 'mobile' : 'desktop', method: request.method(), operation: body.operation });
    }
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(baseURL).origin) {
      report.externalRequestsBlocked.push({ device: isMobile ? 'mobile' : 'desktop', origin: url.origin, path: url.pathname });
      return route.abort();
    }
    return route.fallback();
  });
  await context.route('**/api/models', route => route.fulfill({ json: { items: ['nai-v5-full', 'nai-v5-full-medium', 'nai-v3'].map(id => ({ id, kind: '图像模型' })) } }));
  await context.route('**/api/images/operate', async route => {
    const body = route.request().postDataJSON();
    report.operations.push({ device: isMobile ? 'mobile' : 'desktop', operation: body.operation, model: body.model, width: body.width, height: body.height });
    const png = await generatedPng;
    return route.fulfill({ json: { images: [`data:image/png;base64,${png.toString('base64')}`], historyIds: [], payment: 'local-fixture' } });
  });
  await page.route('**/api/images/operate', async route => {
    const body = route.request().postDataJSON();
    report.operations.push({ device: isMobile ? 'mobile' : 'desktop', operation: body.operation, model: body.model, width: body.width, height: body.height });
    const png = await generatedPng;
    return route.fulfill({ json: { images: [`data:image/png;base64,${png.toString('base64')}`], historyIds: [], payment: 'local-fixture' } });
  });
  try {
    await launchGuide(page);
    await chooseFixtureModel(page, isMobile);
    const states = [];
    for (let index = 0; index < 6; index++) {
      const state = await verifyStep(page, index, isMobile);
      const shot = await capture(page, index, isMobile);
      state.screenshot = shot;
      states.push(state);

      if (index === 0) {
        if (isMobile) {
          const chooser = page.locator('.mobile-studio-mode-selector .popup-select-trigger');
          await chooser.click();
          await page.getByRole('option', { name: '图生图', exact: true }).filter({ visible: true }).click();
        } else {
          await page.locator('.studio-mode-picker button.studio-mode-badge').click();
          await page.locator('.studio-mode-option').filter({ hasText: '图生图' }).click();
        }
      } else if (index === 1) {
        await setSource(page, isMobile);
      } else if (index === 2) {
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '收起说明，继续操作', exact: true }).click();
        const prompt = page.locator('[data-tutorial="prompt"] textarea:visible, [data-layout-module="prompt"] textarea:visible, .mobile-studio-prompt-content textarea:visible').first();
        await prompt.fill('保留蓝发人物与姿势，改成白色连衣裙和花园阳光');
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '展开教程说明', exact: true }).click();
      } else if (index === 3) {
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '收起说明，继续操作', exact: true }).click();
        const strength = page.locator('[data-layout-module="operations"] input[type="range"]:visible, .replica-slider-label input[aria-label="变化强度"]:visible, .mobile-parameter-panel .studio-operation-settings input[type="range"]:visible').first();
        await strength.evaluate(el => {
          const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
          setter.call(el, '0.45');
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
        });
        assert.equal(await strength.inputValue(), '0.45', 'Local practice should adjust the actual strength slider');
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '展开教程说明', exact: true }).click();
      } else if (index === 4) {
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '收起说明，继续操作', exact: true }).click();
        const operationResponse = page.waitForResponse(response => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api/images/operate', { timeout: 20000 });
        await page.locator('[data-studio-generate]:visible').first().click();
        const response = await operationResponse;
        assert.equal(response.status(), 200, 'The local image operation fixture should return successfully');
        const resultData = `data:image/png;base64,${(await generatedPng).toString('base64')}`;
        await page.waitForFunction(expected => [...document.querySelectorAll('.mobile-studio-preview-section img, .replica-media img, [data-layout-module="canvas"] img')].some(img => img.currentSrc === expected), resultData, { timeout: 30000 });
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '展开说明', exact: true }).click().catch(async () => {
          await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '展开教程说明', exact: true }).click();
        });
      } else if (index === 5) {
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '收起说明，继续操作', exact: true }).click();
        const download = page.locator('.workspace-result-download summary, .replica-media .replica-download-menu summary, .mobile-studio-preview-section .image-download-menu summary').filter({ visible: true }).first();
        await download.waitFor();
        await download.click();
        const menu = page.getByRole('menu', { name: '图片下载方式', exact: true });
        await menu.waitFor();
        assert(/下载原图|下载/.test(await menu.innerText()), 'Result should expose a working image download menu');
        await page.keyboard.press('Escape');
        await page.locator('.feature-tutorial-panel header').getByRole('button', { name: '展开教程说明', exact: true }).click();
      }

      if (index < 5) {
        const previous = state.title;
        await page.locator('.feature-tutorial-panel footer').getByRole('button').last().click();
        await page.waitForFunction(title => document.querySelector('.feature-tutorial-panel h2')?.textContent !== title, previous);
        await page.waitForTimeout(650);
      }
    }
    assert.equal(states.length, 6);
    const setupWrites = requests.filter(request => request.method !== 'GET').map(request => ({ path: request.path, method: request.method }));
    assert.equal(setupWrites.length, 0, 'No unrelated API writes are allowed');
    const operationWrites = report.operationNetwork.filter(request => request.device === (isMobile ? 'mobile' : 'desktop'));
    assert.equal(operationWrites.length, 1, 'Exactly one local image operation POST must be made');
    assert.equal(operationWrites[0].method, 'POST');
    assert.equal(operationWrites[0].operation, 'img2img');
    if (isMobile) report.mobile = states;
    else report.desktop = states;
    return { context, page, requests };
  } catch (error) {
    console.error(JSON.stringify({ device: isMobile ? 'mobile' : 'desktop', requestLog: requests.map(({ path, method }) => ({ path, method })), visibleStatus: await page.locator('body').innerText().then(text => text.slice(-1600)).catch(() => '') }, null, 2));
    await page.screenshot({ path: path.join(tempOutput, `${isMobile ? 'mobile' : 'desktop'}-failure.png`), animations: 'disabled' }).catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}

(async () => {
  fs.writeFileSync(fixtureFile, await sourcePng);
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  let desktopRun;
  try {
    desktopRun = await exercise(browser, false, report.runtimeErrors);
    await exercise(browser, true, report.runtimeErrors);

    const { context, page, requests } = await setup(browser, { theme: 'paper', workspaceLayout: 'lfn' }, { width: 1440, height: 1000 });
    page.setDefaultTimeout(18000);
    page.on('pageerror', error => report.runtimeErrors.push(`article/return: ${error.stack || error.message}`));
    await page.goto(`${baseURL}/profile#profile-tutorials`);
    await page.locator('[data-tutorial-id="image-to-image"]').getByRole('button', { name: /图文教程$/ }).click();
    const article = page.locator('.tutorial-article');
    const shots = article.locator('[data-tutorial-shot]');
    assert.equal(await shots.count(), 6, 'Illustrated guide must display six steps');
    const images = [];
    for (let index = 0; index < 6; index++) {
      await shots.nth(index).scrollIntoViewIfNeeded();
      await page.waitForFunction(i => { const image = document.querySelectorAll('.tutorial-article [data-tutorial-shot]')[i]; return Boolean(image?.complete && image.naturalWidth > 0); }, index);
      const loaded = await shots.nth(index).evaluate(img => ({ src: img.getAttribute('src'), width: img.naturalWidth, height: img.naturalHeight, alt: img.getAttribute('alt') }));
      assert.equal(loaded.width, 1440, `Illustration ${index + 1} should be an actual desktop screenshot`);
      assert.equal(loaded.height, 1000, `Illustration ${index + 1} should be an actual desktop screenshot`);
      images.push(loaded);
    }
    assert(await article.locator('.tutorial-keyword').count() > 0, 'Illustrated tutorial should emphasize important terms');
    report.article = { steps: images.length, images };
    await page.getByRole('button', { name: '返回教程目录', exact: true }).click();
    await page.locator('[data-tutorial-id="image-to-image"]').getByRole('button', { name: /手把手教程$/ }).click();
    await page.waitForURL('**/image');
    await page.getByRole('button', { name: '退出教程，返回个人资料的教程中心', exact: true }).click();
    await page.waitForURL('**/profile#profile-tutorials');
    await page.locator('#tutorial-center-content').waitFor();
    report.exitReturnedToCenter = true;
    report.nonGetRequests = requests.filter(request => request.method !== 'GET').map(request => ({ path: request.path, method: request.method }));
    assert.equal(report.nonGetRequests.length, 0, 'Article and early exit must not write to APIs');
    await context.close();

    const finalContext = await setup(browser, { theme: 'paper', workspaceLayout: 'lfn' }, { width: 1440, height: 1000 });
    finalContext.page.setDefaultTimeout(18000);
    finalContext.page.on('pageerror', error => report.runtimeErrors.push(`completion: ${error.stack || error.message}`));
    await finalContext.page.goto(`${baseURL}/profile#profile-tutorials`);
    await finalContext.page.locator('[data-tutorial-id="image-to-image"]').getByRole('button', { name: /手把手教程$/ }).click();
    await finalContext.page.waitForURL('**/image');
    for (let index = 0; index < 5; index++) {
      const previous = await finalContext.page.locator('.feature-tutorial-panel h2').innerText();
      await finalContext.page.locator('.feature-tutorial-panel footer').getByRole('button').last().click();
      await finalContext.page.waitForFunction(title => document.querySelector('.feature-tutorial-panel h2')?.textContent !== title, previous);
    }
    await finalContext.page.getByRole('button', { name: '完成教程，返回教程中心', exact: true }).click();
    await finalContext.page.waitForURL('**/profile#profile-tutorials');
    await finalContext.page.locator('[data-tutorial-id="image-to-image"] .tutorial-completed').waitFor();
    report.completionReturnedToCenter = true;
    await finalContext.context.close();
  } finally {
    await browser.close();
  }

  assert.equal(report.operations.length, 2, 'Desktop and mobile should each exercise one intercepted local fixture request');
  assert(report.operations.every(operation => operation.operation === 'img2img'), 'Both operations must use image-to-image mode');
  assert.equal(report.desktop.length, 6);
  assert.equal(report.mobile.length, 6);
  assert.equal(report.runtimeErrors.length, 0, report.runtimeErrors.join('\n'));
  assert(report.completionReturnedToCenter && report.exitReturnedToCenter, 'Completion and exit must both return to the profile tutorial center');

  const audit = {
    baseURL,
    testedAt: report.testedAt,
    desktop: report.desktop.map(({ index, title, target, targetBounds, spotlightBounds, emphasized, screenshot }) => ({ index, title, target, targetBounds, spotlightBounds, emphasized, screenshot })),
    mobile: report.mobile.map(({ index, title, target, targetBounds, spotlightBounds, emphasized, screenshot }) => ({ index, title, target, targetBounds, spotlightBounds, emphasized, screenshot })),
    illustratedGuide: report.article,
    fixtureRequests: report.operations,
    operationNetwork: report.operationNetwork,
    externalRequestsBlocked: report.externalRequestsBlocked,
    nonGetRequestsOutsideFixture: report.nonGetRequests,
    completionReturnedToTutorialCenter: report.completionReturnedToCenter,
    earlyExitReturnedToTutorialCenter: report.exitReturnedToCenter,
    runtimeErrors: report.runtimeErrors,
  };
  for (let index = 1; index <= 6; index++) {
    const file = path.join(output, `step-${String(index).padStart(2, '0')}.png`);
    assert(fs.existsSync(file), `Missing published screenshot ${path.basename(file)}`);
  }
  fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(audit, null, 2));
  const unexpected = fs.readdirSync(output).filter(name => !/^step-0[1-6]\.png$/.test(name) && name !== 'audit.json');
  assert.deepEqual(unexpected, [], `Only six screenshots and audit.json may remain in the tutorial asset folder: ${unexpected.join(', ')}`);
  console.log(JSON.stringify({ desktopSteps: report.desktop.length, mobileSteps: report.mobile.length, articleScreenshots: report.article.steps, interceptedOperations: report.operations, completionReturnedToCenter: report.completionReturnedToCenter, exitReturnedToCenter: report.exitReturnedToCenter, blockedExternalRequests: report.externalRequestsBlocked.length, runtimeErrors: report.runtimeErrors }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
