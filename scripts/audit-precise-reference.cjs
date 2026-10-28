/* eslint-disable @typescript-eslint/no-require-imports -- Local browser audit for the precise-reference tutorial only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

process.env.LFN_UI_BASE_URL ||= 'http://127.0.0.1:3000';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
process.env.LFN_UI_TEST_SESSION_SECRET = 'lfn-local-tutorial-ui-test-secret-only-20261027';
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');

const output = path.resolve('public/tutorials/precise-reference');
fs.mkdirSync(output, { recursive: true });
const report = { baseURL, screenshots: [], desktop: {}, mobile: {}, articleImages: [], externalBlocked: [], writesBlocked: [], pageErrors: [] };
const fixture = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="832" height="1216"><rect width="832" height="1216" fill="#dce8e7"/><circle cx="650" cy="180" r="110" fill="#f2cc93"/><path d="M0 900L190 600L360 850L530 510L832 930V1216H0Z" fill="#7faaa0"/><path d="M0 1030L230 810L450 1040L680 770L832 940V1216H0Z" fill="#426e65"/></svg>');
const fixturePng = sharp(fixture).png().toBuffer();

function expandButton(page) { return page.locator('.feature-tutorial-panel button[aria-label="展开教程说明"]'); }
function collapseButton(page) { return page.locator('.feature-tutorial-panel button[aria-label="收起说明，继续操作"]'); }
function nextButton(page) { return page.locator('.feature-tutorial-panel footer').getByRole('button').last(); }

async function setGuideExpanded(page, expanded) {
  const button = expanded ? expandButton(page) : collapseButton(page);
  if (await button.count()) await button.first().click();
}

async function verifyStep(page, index, device) {
  await page.waitForTimeout(400);
  const target = page.locator('[data-feature-tutorial-target="true"]');
  const spotlight = page.locator('.feature-tutorial-spotlight');
  await page.waitForFunction(() => {
    const target = document.querySelector('[data-feature-tutorial-target="true"]')?.getBoundingClientRect();
    const spotlight = document.querySelector('.feature-tutorial-spotlight')?.getBoundingClientRect();
    return target && spotlight && Math.abs(spotlight.x - Math.max(4, target.x - 4)) < 2 && Math.abs(spotlight.y - Math.max(4, target.y - 4)) < 2;
  }, undefined, { timeout: 5000 });
  const count = await target.count();
  assert.equal(count, 1, `${device} step ${index + 1}: exactly one real target is marked; candidate models=${await page.locator('[aria-label="模型"]').count()} body=${(await page.locator('body').innerText()).slice(0, 2400)}`);
  assert(await target.isVisible(), `${device} step ${index + 1}: target is visible`);
  assert(await spotlight.isVisible(), `${device} step ${index + 1}: spotlight is visible`);
  assert(await target.evaluate(el => !el.closest('[hidden], [inert], [aria-hidden="true"]')), `${device} step ${index + 1}: target is not inside a hidden or inert panel`);
  const [targetBox, spotlightBox] = await Promise.all([target.boundingBox(), spotlight.boundingBox()]);
  assert(targetBox && targetBox.width > 0 && targetBox.height > 0, `${device} step ${index + 1}: target has visible bounds`);
  assert(Math.abs(spotlightBox.x - Math.max(4, targetBox.x - 4)) < 2 && Math.abs(spotlightBox.y - Math.max(4, targetBox.y - 4)) < 2, `${device} step ${index + 1}: spotlight encloses the target; target=${JSON.stringify(targetBox)} spotlight=${JSON.stringify(spotlightBox)}`);
  assert(await target.evaluate(el => getComputedStyle(el).outlineStyle === 'solid'), `${device} step ${index + 1}: target has visible focus styling`);
  const keywords = await page.locator('.feature-tutorial-body .tutorial-keyword').allTextContents();
  assert(keywords.length > 0, `${device} step ${index + 1}: important words are emphasized`);
  return {
    index: index + 1,
    title: (await page.locator('.feature-tutorial-panel h2').innerText()).trim(),
    target: await target.evaluate(el => ({ tag: el.tagName, role: el.getAttribute('role'), label: el.getAttribute('aria-label'), text: el.innerText.trim().slice(0, 160), className: typeof el.className === 'string' ? el.className : '' })),
    emphasized: keywords,
    targetBounds: targetBox,
  };
}

async function saveScreenshot(page, index) {
  await page.evaluate(() => document.fonts.ready);
  const fileName = `step-${String(index + 1).padStart(2, '0')}.png`;
  const file = path.join(output, fileName);
  await page.screenshot({ path: file, animations: 'disabled' });
  const meta = await sharp(file).metadata();
  assert.equal(meta.width, 1440, `${fileName}: desktop screenshot width`);
  assert.equal(meta.height, 1000, `${fileName}: desktop screenshot height`);
  report.screenshots.push({ src: `/tutorials/precise-reference/${fileName}`, width: meta.width, height: meta.height, bytes: fs.statSync(file).size });
}

async function guardContext(context) {
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
      report.externalBlocked.push(`${route.request().method()} ${url.origin}${url.pathname}`);
      return route.abort();
    }
    const req = route.request();
    if (url.pathname.startsWith('/api/') && req.method() !== 'GET' && req.method() !== 'HEAD') {
      report.writesBlocked.push(`${req.method()} ${url.pathname}`);
      return route.abort();
    }
    return route.fallback();
  });
}

async function openGuide(page) {
  await page.goto(`${baseURL}/profile#profile-tutorials`);
  const card = page.locator('[data-tutorial-id="precise-reference"]');
  await card.waitFor();
  await card.getByRole('button', { name: /手把手教程$/ }).click();
  await page.waitForURL('**/image');
  await page.locator('.feature-tutorial-panel h2').getByText('选择支持参考图的模型', { exact: true }).waitFor();
}

async function chooseModel(page, mobile = false) {
  if (mobile) {
    await page.getByRole('button', { name: '打开生成参数', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '生成参数', exact: true });
    await dialog.waitFor();
    const picker = dialog.getByLabel('模型', { exact: true });
    await picker.waitFor({ state: 'visible' });
    await picker.click();
    await page.getByRole('option').filter({ hasText: /nai-v5-full/i }).first().click();
    await page.keyboard.press('Escape');
  } else {
    const picker = page.locator('[aria-label="模型"]').filter({ visible: true }).first();
    await picker.waitFor();
    await picker.click();
    await page.getByRole('option').filter({ hasText: /nai-v5-full/i }).first().click();
  }
}

async function choosePreciseMode(page, mobile = false) {
  if (mobile) {
    await page.locator('.mobile-studio-mode-selector .popup-select-trigger').click();
    await page.getByRole('option', { name: '精准参考', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.mobile-studio-mode-selector')?.getAttribute('data-current-operation') === 'precise-reference');
    return;
  }
  await page.locator('button[aria-label*="点击选择生成模式"]').filter({ visible: true }).first().click();
  const dialog = page.getByRole('dialog', { name: '选择生成模式', exact: true });
  await dialog.waitFor();
  const option = dialog.locator('.studio-mode-option').filter({ hasText: '精准参考' }).first();
  await option.waitFor({ state: 'visible' });
  assert(await option.isEnabled(), `Precise-reference mode must be enabled for the selected model: ${await option.innerText()}`);
  await option.click();
  await page.waitForFunction(() => document.querySelector('[aria-label*="精准参考，点击选择生成模式"]') || document.querySelector('.mobile-studio-mode-selector')?.innerText.includes('精准参考'));
}

async function addReference(page, mobile = false) {
  const target = mobile
    ? page.locator('.mobile-studio-reference-panel .mobile-reference-action.is-primary')
    : page.locator('.replica-section[data-tutorial="precise"] .replica-tonal-button:visible').filter({ hasText: '添加参考图' }).first();
  await target.waitFor();
  const fileInput = mobile
    ? page.locator('.mobile-reference-tools input[type="file"]')
    : page.locator('.replica-controls input[type="file"]').first();
  await target.click();
  await fileInput.setInputFiles({ name: 'local-reference-fixture.png', mimeType: 'image/png', buffer: await fixturePng });
  await page.getByRole('img', { name: 'local-reference-fixture.png', exact: true }).waitFor();
}

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.LFN_UI_BROWSER_PATH ? { executablePath: process.env.LFN_UI_BROWSER_PATH } : {}), ...(process.env.LFN_UI_BROWSER_CHANNEL ? { channel: process.env.LFN_UI_BROWSER_CHANNEL } : {}) });
  try {
    const desktop = await setup(browser, { theme: 'paper', workspaceLayout: 'nlw' }, { width: 1440, height: 1000 });
    desktop.page.setDefaultTimeout(20000);
    desktop.page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
    await guardContext(desktop.context);
    await openGuide(desktop.page);
    const steps = [];
    for (let index = 0; index < 6; index++) {
      await setGuideExpanded(desktop.page, true);
      steps.push(await verifyStep(desktop.page, index, 'desktop'));
      await saveScreenshot(desktop.page, index);
      if (index === 0) {
        assert((await desktop.page.locator('body').innerText()).includes('nai-v5-full'), 'A compatible local fixture model is selected and visible');
        await nextButton(desktop.page).click();
      } else if (index === 1) {
        await setGuideExpanded(desktop.page, false);
        await choosePreciseMode(desktop.page);
        await setGuideExpanded(desktop.page, true);
        await nextButton(desktop.page).click();
      } else if (index === 2) {
        await setGuideExpanded(desktop.page, false);
        await addReference(desktop.page);
        await setGuideExpanded(desktop.page, true);
        await nextButton(desktop.page).click();
      } else if (index === 3) {
        await setGuideExpanded(desktop.page, false);
        await desktop.page.locator('.replica-reference-type .popup-select-trigger:visible').click();
        await desktop.page.getByRole('option', { name: '角色', exact: true }).click();
        await setGuideExpanded(desktop.page, true);
        await nextButton(desktop.page).click();
      } else if (index === 4) {
        await setGuideExpanded(desktop.page, false);
        const prompt = desktop.page.locator('.replica-prompt textarea:visible, [data-tutorial="prompt"] textarea:visible').first();
        await prompt.fill('a person turning around in a garden, afternoon sunlight, medium shot');
        await setGuideExpanded(desktop.page, true);
        await nextButton(desktop.page).click();
      } else {
        assert.equal((await desktop.page.locator('.feature-tutorial-exit').innerText()).trim(), '退出教程，返回个人资料的教程中心');
        await desktop.page.getByRole('button', { name: '完成教程，返回教程中心', exact: true }).click();
        await desktop.page.waitForURL('**/profile#profile-tutorials');
        assert(await desktop.page.locator('[data-tutorial-id="precise-reference"] .tutorial-completed').isVisible(), 'Completion marks and returns to tutorial center');
      }
    }
    assert.equal(desktop.requests.filter(item => item.method !== 'GET').length, 0, 'Helper observed no API writes');
    report.desktop = { viewport: '1440x1000', steps, apiWrites: desktop.requests.filter(item => item.method !== 'GET').length, completedAndReturned: true };

    // Confirm the illustrated guide loads the six real screenshots in the actual tutorial article.
    await desktop.page.locator('[data-tutorial-id="precise-reference"]').getByRole('button', { name: /图文教程$/ }).click();
    const article = desktop.page.locator('.tutorial-article');
    await article.waitFor();
    const images = article.locator('img[src^="/tutorials/precise-reference/step-"]');
    await images.first().waitFor();
    report.articleImages = [];
    for (let index = 0; index < await images.count(); index++) {
      const image = images.nth(index);
      await image.evaluate(node => node.scrollIntoView({ block: 'center' }));
      await image.evaluate(node => node.decode());
      report.articleImages.push(await image.evaluate(img => ({ src: img.getAttribute('src'), complete: img.complete, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight, alt: img.alt })));
    }
    assert.equal(report.articleImages.length, 6, 'Article renders all six supplied screenshots');
    assert(report.articleImages.every(image => image.complete && image.naturalWidth === 1440 && image.naturalHeight === 1000), 'Every article screenshot loads at its declared size');
    assert.equal(await article.locator('.tutorial-keyword').count() >= 6, true, 'Article highlights important terms');
    await desktop.context.close();

    const mobile = await setup(browser, { theme: 'paper', workspaceLayout: 'nai' }, { width: 390, height: 844 });
    mobile.page.setDefaultTimeout(20000);
    mobile.page.on('pageerror', error => report.pageErrors.push(error.stack || error.message));
    await guardContext(mobile.context);
    await openGuide(mobile.page);
    const mobileSteps = [];
    for (let index = 0; index < 3; index++) {
      await setGuideExpanded(mobile.page, true);
      mobileSteps.push(await verifyStep(mobile.page, index, 'mobile'));
      await setGuideExpanded(mobile.page, false);
      if (index === 0) {
        assert((await mobile.page.locator('body').innerText()).includes('nai-v5-full'), 'A compatible local fixture model is selected and visible on mobile');
        await setGuideExpanded(mobile.page, true);
        await nextButton(mobile.page).click();
      } else if (index === 1) {
        await choosePreciseMode(mobile.page, true);
        await setGuideExpanded(mobile.page, true);
        await nextButton(mobile.page).click();
      } else {
        await addReference(mobile.page, true);
        await setGuideExpanded(mobile.page, true);
        assert.equal((await mobile.page.locator('.feature-tutorial-exit').innerText()).trim(), '退出教程，返回个人资料的教程中心');
        await mobile.page.getByRole('button', { name: /退出教程，返回个人资料的教程中心/ }).click();
        await mobile.page.waitForURL('**/profile#profile-tutorials');
        assert(await mobile.page.locator('[data-tutorial-id="precise-reference"]').isVisible(), 'Early exit returns to tutorial center');
      }
    }
    assert.equal(mobile.requests.filter(item => item.method !== 'GET').length, 0, 'Helper observed no mobile API writes');
    report.mobile = { viewport: '390x844', steps: mobileSteps, earlyExitAfterReferenceUpload: true, apiWrites: mobile.requests.filter(item => item.method !== 'GET').length, returnedToTutorialCenter: true };
    await mobile.context.close();

    assert.equal(report.screenshots.length, 6, 'Exactly six desktop tutorial screenshots were captured');
    assert.equal(report.externalBlocked.length, 0, `No external requests were attempted: ${JSON.stringify(report.externalBlocked)}`);
    assert.equal(report.writesBlocked.length, 0, `No non-fixture API writes were attempted: ${JSON.stringify(report.writesBlocked)}`);
    assert.equal(report.pageErrors.length, 0, report.pageErrors.join('\n'));
    report.passed = true;
    fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: true, desktopSteps: report.desktop.steps.length, mobileSteps: report.mobile.steps.length, screenshots: report.screenshots.length, articleImagesLoaded: report.articleImages.length, externalRequests: report.externalBlocked.length, writes: report.writesBlocked.length, pageErrors: report.pageErrors.length }, null, 2));
  } catch (error) {
    report.passed = false;
    report.error = error.stack || error.message;
    fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(report, null, 2));
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
