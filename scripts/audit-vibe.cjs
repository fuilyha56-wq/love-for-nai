/* eslint-disable @typescript-eslint/no-require-imports -- Local-only Vibe tutorial browser audit. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.LFN_UI_BASE_URL ||= 'http://127.0.0.1:3000';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
process.env.LFN_UI_TEST_SESSION_SECRET ||= 'lfn-local-tutorial-ui-test-secret-only-20261026';

const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const { loadTutorialCatalog } = require('./tutorial-test-support.cjs');
const output = path.resolve('public/tutorials/vibe');
fs.mkdirSync(output, { recursive: true });
const catalog = loadTutorialCatalog();
const tutorial = catalog.featureTutorials.find(item => item.id === 'vibe');
assert(tutorial, 'Vibe tutorial is present');
assert.equal(tutorial.steps.length, 6, 'The Vibe guide has six illustrated steps');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=', 'base64');
const results = [];

async function shot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(180);
  await page.screenshot({ path: path.join(output, name), animations: 'disabled' });
}

async function center(page) {
  await page.goto(`${baseURL}/profile#profile-tutorials`);
  const announcementClose = page.getByRole('button', { name: '我知道了', exact: true });
  for (let count = 0; count < 8 && await announcementClose.isVisible().catch(() => false); count++) {
    await announcementClose.click();
    await page.waitForTimeout(100);
  }
  await page.getByRole('heading', { name: '选择你想学习的功能' }).waitFor();
}

async function start(page) {
  await page.locator('[data-tutorial-id="vibe"]').getByRole('button', { name: /：手把手教程$/ }).click();
  await page.waitForURL('**/image');
  await page.locator('.feature-tutorial-panel h2').getByText(tutorial.steps[0].title, { exact: true }).waitFor();
}

async function next(page) {
  const old = await page.locator('.feature-tutorial-panel h2').textContent();
  await page.locator('.feature-tutorial-panel footer').getByRole('button', { name: /下一步/ }).click();
  await page.waitForFunction(previous => document.querySelector('.feature-tutorial-panel h2')?.textContent !== previous, old);
}

async function returnToCenter(page, completed) {
  const buttonName = completed ? '完成教程，返回教程中心' : '退出教程，返回个人资料的教程中心';
  await page.locator('.feature-tutorial-panel').getByRole('button', { name: buttonName, exact: true }).click();
  await page.waitForURL('**/profile#profile-tutorials');
  await page.locator('#tutorial-center-content').waitFor();
  await page.waitForFunction(() => !sessionStorage.getItem('lfn-feature-tutorial-session-v1'));
  assert.equal(await page.locator('.feature-tutorial-panel').count(), 0);
  if (completed) await page.locator('[data-tutorial-id="vibe"] .tutorial-completed').waitFor();
}

async function blockExternal(context, blocked) {
  await context.route('**/api/pricing*', route => {
    const model = new URL(route.request().url()).searchParams.get('model') || 'nai-v5-full';
    return route.fulfill({ json: { model, modelRatio: 1, modelPrice: 0.01, modelRatioKnown: true, modelPriceKnown: true, quotaType: 1, effectiveGroup: 'default', groupRatio: 1 } });
  });
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === new URL(baseURL).port) return route.fallback();
    blocked.push(url.origin);
    return route.abort('blockedbyclient');
  });
}

async function setVibeReference(page) {
  const vibeSection = page.locator('.replica-section[data-tutorial="vibe"]');
  if (!widthIsPhone(page) && await vibeSection.count() && await vibeSection.isVisible().catch(() => false)) {
    const toggle = vibeSection.locator('.replica-section-heading button');
    if (await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
    await vibeSection.getByRole('button', { name: '从文件添加' }).click();
    await page.locator('.replica-controls > input[type="file"]').setInputFiles({ name: 'vibe-reference-fixture.png', mimeType: 'image/png', buffer: png });
    await vibeSection.getByRole('img', { name: 'vibe-reference-fixture.png' }).waitFor();
    return vibeSection;
  }
  if (widthIsPhone(page)) {
    await page.locator('.feature-tutorial-locate').getByRole('button', { name: '收起说明，继续操作', exact: true }).click();
    await page.getByRole('button', { name: '生成模式', exact: true }).click();
    await page.getByRole('option', { name: 'Vibe', exact: true }).click();
  } else {
    await page.locator('button[aria-label^="当前"][aria-label$="点击选择生成模式"]').click();
    await page.getByRole('dialog', { name: '选择生成模式' }).getByRole('button', { name: /Vibe/ }).click();
  }
  const referenceUpload = page.locator('label').filter({ hasText: '参考图片' }).locator('input[type="file"]');
  await referenceUpload.last().setInputFiles({ name: 'vibe-reference-fixture.png', mimeType: 'image/png', buffer: png });
  await page.locator('[title="vibe-reference-fixture.png"]').waitFor({ state: 'visible' });
  if (widthIsPhone(page)) await page.locator('.feature-tutorial-panel').getByRole('button', { name: '展开教程说明', exact: true }).click();
  return page.locator('.reference-parameter-card');
}

function widthIsPhone(page) {
  return page.viewportSize().width < 1024;
}

async function runDevice(browser, { name, width, height, theme, layout, imagePrefix, complete }) {
  const { context, page, requests } = await setup(browser, { theme, workspaceLayout: layout }, { width, height });
  const blocked = [];
  const runtimeErrors = [];
  await blockExternal(context, blocked);
  page.setDefaultTimeout(18000);
  page.on('pageerror', error => runtimeErrors.push(error.stack || error.message));
  page.on('console', message => { if (message.type() === 'error' && /hydration|hydrated|didn't match/i.test(message.text())) runtimeErrors.push(message.text()); });
  try {
    await center(page);
    await page.locator('[data-tutorial-id="vibe"]').getByRole('button', { name: /：图文教程$/ }).click();
    await page.getByRole('heading', { name: tutorial.title, exact: true }).waitFor();
    assert.equal(await page.locator('.tutorial-article-step img[data-tutorial-shot]').count(), 6, 'Illustrated mode has one actual screenshot per step');
    const screenshotsAlreadyExist = tutorial.steps.every((_, index) => fs.existsSync(path.join(output, `step-${String(index + 1).padStart(2, '0')}.png`)));
    if (screenshotsAlreadyExist) {
      await page.locator('.tutorial-article-step img[data-tutorial-shot]').evaluateAll(images => images.forEach(image => { image.loading = 'eager'; }));
      await page.waitForFunction(() => [...document.querySelectorAll('.tutorial-article-step img[data-tutorial-shot]')].every(image => image.complete && image.naturalWidth > 0));
      const imageStatus = await page.locator('.tutorial-article-step img[data-tutorial-shot]').evaluateAll(images => images.map(image => ({ loaded: image.complete && image.naturalWidth > 0, src: image.getAttribute('src') })));
      assert(imageStatus.every(image => image.loaded), `All tutorial screenshots load: ${JSON.stringify(imageStatus)}`);
    }
    assert.equal(await page.locator('.tutorial-article-step img[data-tutorial-shot]').count(), tutorial.steps.length);
    for (const keyword of ['参考强度', '信息提取', '图片库']) assert((await page.locator('.tutorial-article').innerText()).includes(keyword), `Illustrated guide explains ${keyword}`);
    await shot(page, `${imagePrefix}-illustrated-mode.png`);
    await page.getByRole('button', { name: '返回教程目录', exact: true }).click();
    await start(page);
    await shot(page, `${imagePrefix}-step-01-model.png`);
    if (width >= 1024) await shot(page, 'step-01.png');

    // The dev fixture uses nai-v5-full. Confirm the loaded model controls and
    // then select a real Vibe operation before adding the reference fixture.
    if (width >= 1024) {
      assert(await page.locator('[aria-label="模型"]').count(), 'The actual desktop model selector is present');
      assert((await page.locator('body').innerText()).includes('nai-v5-full'), 'A Vibe-compatible model is selected in the desktop controls');
      await next(page);
      await setVibeReference(page);
      await shot(page, `${imagePrefix}-step-02-reference.png`);
      await shot(page, 'step-02.png');
      await next(page);
      const strength = page.getByLabel('参考强度', { exact: true }).last();
      const encoding = page.getByLabel('信息提取', { exact: true }).last();
      assert.equal(await strength.inputValue(), '0.6');
      assert.equal(await encoding.inputValue(), '1');
      await strength.fill('0.4');
      await encoding.fill('0.8');
      assert.equal(await strength.inputValue(), '0.4');
      assert.equal(await encoding.inputValue(), '0.8');
      await shot(page, `${imagePrefix}-step-03-strength-encoding.png`);
      await shot(page, 'step-03.png');
      await next(page);
      await shot(page, `${imagePrefix}-step-04-prompt.png`);
      await shot(page, 'step-04.png');
      await next(page);
      const generateSelectorCount = await page.locator('[data-studio-generate]:visible').count();
      const generateButtonEvidence = await page.locator('button').evaluateAll(buttons => buttons.filter(button => /生成/.test(button.textContent || '')).map(button => ({ text: button.textContent?.trim(), className: button.className, data: button.hasAttribute('data-studio-generate'), box: (() => { const box = button.getBoundingClientRect(); return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) }; })() })));
      assert(generateButtonEvidence.some(button => button.box.width > 0 && button.box.height > 0), `Generation action is visible: ${JSON.stringify({ generateSelectorCount, generateButtonEvidence })}`);
      await shot(page, `${imagePrefix}-step-05-ready-to-generate.png`);
      await shot(page, 'step-05.png');
      await page.locator('button').filter({ hasText: /^生成/ }).last().click();
      const confirmation = page.getByRole('alertdialog', { name: '确认生成与费用', exact: true });
      await confirmation.waitFor();
      await confirmation.getByRole('button', { name: '确认并生成', exact: true }).click();
      await page.locator('.studio-canvas img, .replica-media img').last().waitFor({ state: 'visible' });
      await next(page);
      await page.locator('.feature-tutorial-panel h2').getByText(tutorial.steps[5].title, { exact: true }).waitFor();
      await shot(page, `${imagePrefix}-step-06-result.png`);
      await shot(page, 'step-06.png');
    } else {
      await next(page);
      await setVibeReference(page);
      await shot(page, `${imagePrefix}-step-02-reference.png`);
      await next(page);
      const strength = page.getByLabel('参考强度', { exact: true }).last();
      const encoding = page.getByLabel('信息提取', { exact: true }).last();
      if (widthIsPhone(page)) await page.locator('.feature-tutorial-locate').getByRole('button', { name: '收起说明，继续操作', exact: true }).click();
      assert.equal(await strength.inputValue(), '0.6');
      assert.equal(await encoding.inputValue(), '1');
      await strength.fill('0.4');
      await encoding.fill('0.8');
      await shot(page, `${imagePrefix}-step-03-strength-encoding.png`);
      if (widthIsPhone(page)) await page.locator('.feature-tutorial-panel').getByRole('button', { name: '展开教程说明', exact: true }).click();
      await next(page);
      await shot(page, `${imagePrefix}-step-04-prompt.png`);
      await next(page);
      await shot(page, `${imagePrefix}-step-05-ready-to-generate.png`);
      await page.locator('[data-studio-generate]:visible').first().click();
      const confirmation = page.getByRole('alertdialog', { name: '确认生成与费用', exact: true });
      if (await confirmation.isVisible().catch(() => false)) await confirmation.getByRole('button', { name: '确认并生成', exact: true }).click();
      await page.locator('.mobile-studio-preview-section img').first().waitFor({ state: 'visible' });
      await next(page);
      await page.locator('.feature-tutorial-panel h2').getByText(tutorial.steps[5].title, { exact: true }).waitFor();
      await shot(page, `${imagePrefix}-step-06-result.png`);
    }

    assert.equal(blocked.length, 0, `No external request was attempted: ${blocked.join(', ')}`);
    const writes = requests.filter(request => request.method !== 'GET');
    assert.deepEqual(writes.map(request => `${request.method} ${request.path}`), ['POST /api/images/operate'], 'Only the local image fixture endpoint receives a write');
    assert(runtimeErrors.length === 0, `No browser runtime errors: ${runtimeErrors.join('\n')}`);

    if (complete) {
      await page.locator('.feature-tutorial-panel').getByRole('button', { name: '完成教程，返回教程中心', exact: true }).waitFor();
      await returnToCenter(page, true);
    } else {
      await returnToCenter(page, false);
    }
    results.push({ device: name, passed: true, articleScreenshotsLoaded: tutorial.steps.length, referenceSelected: true, strength: 0.4, informationExtraction: 0.8, fixtureWrites: writes.length, blockedExternalRequests: blocked.length, runtimeErrors: runtimeErrors.length, returnedTo: `${new URL(page.url()).pathname}${new URL(page.url()).hash}` });
  } catch (error) {
    await shot(page, `${imagePrefix}-failure.png`).catch(() => {});
    results.push({ device: name, passed: false, error: error.stack || error.message, blocked, requests: requests.map(request => `${request.method} ${request.path}`), runtimeErrors });
    throw error;
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.LFN_UI_BROWSER_CHANNEL || 'msedge' });
  try {
    const devices = [
      { name: 'desktop', width: 1440, height: 1000, theme: 'paper', layout: 'nlw', imagePrefix: 'desktop', complete: true },
      { name: 'phone early exit', width: 390, height: 844, theme: 'night', layout: 'lfn', imagePrefix: 'phone-early-exit', complete: false },
      { name: 'phone completion', width: 390, height: 844, theme: 'night', layout: 'lfn', imagePrefix: 'phone-completion', complete: true },
    ];
    const selected = process.env.LFN_VIBE_AUDIT_DEVICE;
    for (const device of devices.filter(item => !selected || item.name.startsWith(selected))) await runDevice(browser, device);
  } finally {
    await browser.close();
    const auditPath = path.join(output, 'audit.json');
    let priorResults = [];
    if (process.env.LFN_VIBE_AUDIT_DEVICE && fs.existsSync(auditPath)) {
      try { priorResults = JSON.parse(fs.readFileSync(auditPath, 'utf8')).results || []; } catch {}
      priorResults = priorResults.filter(result => !result.device.startsWith(process.env.LFN_VIBE_AUDIT_DEVICE));
    }
    fs.writeFileSync(auditPath, JSON.stringify({ tutorial: 'vibe', screenshots: fs.readdirSync(output).filter(name => name.endsWith('.png')).sort(), results: [...priorResults, ...results] }, null, 2));
  }
  console.log(JSON.stringify(results, null, 2));
  assert(results.every(result => result.passed), 'All Vibe desktop and phone audits passed');
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
