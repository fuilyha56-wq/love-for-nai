/* Local-only browser audit for the director feature tutorial. */
/* eslint-disable @typescript-eslint/no-require-imports -- standalone local browser audit */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

process.env.LFN_UI_BASE_URL ||= 'http://localhost:3010';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
process.env.LFN_UI_TEST_SESSION_SECRET ||= 'lfn-local-tutorial-ui-test-secret-only-20261026';
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');

assert(['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname), 'Use a local-only base URL');
const publicDir = path.resolve('public/tutorials/director');
const stepCount = 5;
const toolButton = '.nai-director-grid .nai-director-button, .custom-image-tools button';
const stepSelectors = [
  ['[aria-label="模型"]', '.studio-model-controls .popup-select-trigger', '.mobile-studio-mode-selector', 'button[aria-label="打开生成参数"]'],
  [toolButton, '[data-layout-module="director"] .panel-section-head', '.mobile-studio-mode-selector [aria-label="生成模式"]', 'button[aria-label="打开图像工具"]', 'button[aria-label="打开生成参数"]'],
  ['[data-tutorial="source"] label', '.mobile-studio-reference-panel .mobile-reference-action', '.mobile-studio-reference-panel button[aria-label*="上传"]', 'button[aria-label="上传源图片"]', 'button[aria-label*="上传"]'],
  ['.replica-run-button', 'button[data-studio-generate]', '.nai-generate-button'],
  ['.workspace-result-download summary', '.replica-media-open', '.workspace-result-image', '.replica-download-menu summary', '.image-download-menu summary'],
];

async function installNetworkGuards(context, audit, fixturePng) {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      audit.externalRequests.push({ url: url.href, method: request.method() });
      return route.abort('blockedbyclient');
    }
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      const write = { path: url.pathname, method: request.method() };
      audit.apiWrites.push(write);
      if (url.pathname === '/api/images/operate' && request.method() === 'POST') {
        const payload = request.postDataJSON();
        audit.fixtureCalls.push({ operation: payload.operation, model: payload.model, width: payload.width, height: payload.height });
        return route.fulfill({ json: { images: [`data:image/png;base64,${fixturePng.toString('base64')}`], historyIds: [], payment: 'local-fixture' } });
      }
      audit.unexpectedWrites.push(write);
      return route.fulfill({ status: 409, json: { message: 'director local audit blocks every non-fixture write' } });
    }
    return route.fallback();
  });
}

async function openGuide(page) {
  await page.goto(`${baseURL}/profile#profile-tutorials`, { waitUntil: 'domcontentloaded' });
  const card = page.locator('[data-tutorial-id="director"]');
  await card.waitFor({ state: 'visible' });
  await card.getByRole('button', { name: '去背景、线稿、上色与表情：手把手教程', exact: true }).click();
  await page.locator('[data-testid="feature-tutorial"]').waitFor({ state: 'visible' });
  await page.waitForURL(/\/image(?:\?|$)/);
}

async function collapseGuide(page) {
  const button = page.getByRole('button', { name: '收起说明，继续操作', exact: true });
  if (await button.count()) await button.first().click();
}

async function expandGuide(page) {
  const button = page.locator('.feature-tutorial-panel button[aria-label="展开教程说明"]');
  if (await button.count()) await button.first().click();
}

async function waitStep(page, title) {
  await page.locator('.feature-tutorial-panel h2').getByText(title, { exact: true }).waitFor();
  await page.waitForTimeout(250);
}

async function verifyTarget(page, index, device) {
  await expandGuide(page);
  const target = page.locator('[data-feature-tutorial-target="true"]');
  await page.waitForFunction(selectors => {
    const marked = [...document.querySelectorAll('[data-feature-tutorial-target="true"]')];
    return marked.length === 1 && selectors.some(selector => marked[0].matches(selector)) && marked[0].getBoundingClientRect().width > 0;
  }, stepSelectors[index], { timeout: 20000 });
  await page.waitForFunction(() => {
    const target = document.querySelector('[data-feature-tutorial-target="true"]')?.getBoundingClientRect();
    const spotlight = document.querySelector('.feature-tutorial-spotlight')?.getBoundingClientRect();
    return Boolean(target && spotlight && Math.abs(spotlight.x - Math.max(4, target.x - 4)) < 2 && Math.abs(spotlight.y - Math.max(4, target.y - 4)) < 2);
  }, null, { timeout: 5000 });
  const state = await target.evaluate((element, selectors) => {
    const rect = element.getBoundingClientRect();
    const spotlight = document.querySelector('.feature-tutorial-spotlight')?.getBoundingClientRect();
    const center = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      matched: selectors.some(selector => element.matches(selector)),
      tag: element.tagName.toLowerCase(),
      text: (element.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').trim().slice(0, 140),
      box: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      spotlightAligned: Boolean(spotlight && Math.abs(spotlight.x - Math.max(4, rect.x - 4)) < 2 && Math.abs(spotlight.y - Math.max(4, rect.y - 4)) < 2),
      centerInside: Boolean(center && (center === element || element.contains(center))),
      centerHit: center ? `${center.tagName.toLowerCase()}${typeof center.className === 'string' && center.className ? `.${center.className.trim().replace(/\s+/g, '.')}` : ''}` : null,
      keywords: [...document.querySelectorAll('.feature-tutorial-body mark.tutorial-keyword')].map(item => item.textContent),
    };
  }, stepSelectors[index]);
  assert(state.matched, `${device} step ${index + 1}: spotlight must point to the expected real control`);
  assert(state.box.width > 0 && state.box.height > 0, `${device} step ${index + 1}: target is visible`);
  assert(state.spotlightAligned, `${device} step ${index + 1}: spotlight aligns with the control; ${JSON.stringify(state)}`);
  assert(state.keywords.length > 0, `${device} step ${index + 1}: important words are emphasized`);
  if (device === 'phone') {
    const hit = await target.evaluate(element => {
      const rect = element.getBoundingClientRect();
      const point = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      return Boolean(point && (point === element || element.contains(point)));
    });
    assert(hit, `phone step ${index + 1}: center tap reaches the highlighted control; ${JSON.stringify(state)}`);
  }
  return state;
}

async function saveShot(page, index) {
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  const file = path.join(publicDir, `step-${String(index + 1).padStart(2, '0')}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  const metadata = await sharp(file).metadata();
  assert.equal(metadata.width, 1440, `${path.basename(file)} width`);
  assert.equal(metadata.height, 1000, `${path.basename(file)} height`);
  return { file: `/tutorials/director/${path.basename(file)}`, width: metadata.width, height: metadata.height };
}

async function fillSource(page, fixturePng, device) {
  await collapseGuide(page);
  if (device === 'phone') {
    const upload = page.locator('.mobile-studio-reference-panel .mobile-reference-action').filter({ hasText: '上传图片' }).first();
    const chooserPromise = page.waitForEvent('filechooser');
    await upload.click();
    await (await chooserPromise).setFiles({ name: 'director-practice.png', mimeType: 'image/png', buffer: fixturePng });
  } else {
    const label = page.locator('[data-tutorial="source"] label').first();
    const chooserPromise = page.waitForEvent('filechooser');
    await label.click();
    await (await chooserPromise).setFiles({ name: 'director-practice.png', mimeType: 'image/png', buffer: fixturePng });
  }
  await page.waitForFunction(() => document.querySelector('[data-tutorial-source-ready="true"]') || document.querySelector('[data-tutorial="source"] img, .mobile-studio-reference-panel img'));
}

async function runFlow(browser, viewport, sourcePng, resultPng, audit) {
  const { context, page } = await setup(browser, { theme: 'paper', workspaceLayout: viewport.width >= 1024 ? 'custom' : 'lfn' }, viewport);
  await installNetworkGuards(context, audit, resultPng);
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(90000);
  const errors = [];
  const consoleErrors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  const device = viewport.width < 1024 ? 'phone' : 'desktop';
  const result = { viewport, device, steps: [], errors, consoleErrors };
  try {
    await openGuide(page);
    for (let index = 0; index < stepCount; index += 1) {
      if (index === 3) {
        await collapseGuide(page);
        if (device === 'phone') {
          await page.waitForTimeout(1400);
          await page.locator('.mobile-studio-prompt-toggle').click();
        }
        const prompt = page.locator('[data-tutorial="prompt"] textarea, [data-layout-module="prompt"] textarea, .replica-prompt textarea, .mobile-studio-prompt-content textarea').filter({ visible: true }).first();
        await prompt.waitFor({ state: 'visible' });
        await prompt.fill('柔和的蓝紫色调，保留清晰线条与原有构图');
        if (device === 'phone') await page.getByRole('dialog', { name: '提示词区域' }).getByRole('button', { name: '完成', exact: true }).click();
      }
      const target = await verifyTarget(page, index, device);
      const screenshot = device === 'desktop' ? await saveShot(page, index) : undefined;
      result.steps.push({ number: index + 1, title: await page.locator('.feature-tutorial-panel h2').innerText(), target, screenshot });
      if (index === 1) {
        await collapseGuide(page);
        if (viewport.width < 1024) {
          const mode = page.locator('.mobile-studio-mode-selector [aria-label="生成模式"]');
          const point = await mode.evaluate(element => {
            const rect = element.getBoundingClientRect();
            const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
            const hit = document.elementFromPoint(x, y);
            return { x, y, hit: Boolean(hit && (hit === element || element.contains(hit))) };
          });
          assert(point.hit, 'phone mode selector tap point reaches the real control');
          await page.mouse.click(point.x, point.y);
          await page.getByRole('option', { name: '线稿上色', exact: true }).click();
        } else {
          await page.locator('[data-layout-module="director"] .panel-section-head').click();
          const button = page.getByRole('button', { name: '线稿上色', exact: true }).filter({ visible: true }).first();
          await button.waitFor({ state: 'visible' });
          await button.click();
        }
        await page.waitForFunction(() => document.querySelector('.nai-director-button.is-active')?.innerText.includes('线稿上色') || document.querySelector('.mobile-studio-mode-selector')?.getAttribute('data-current-operation') === 'director-colorize');
      }
      if (index === 2) await fillSource(page, sourcePng, device);
      if (index === 3) {
        await collapseGuide(page);
        const generate = page.locator('.replica-run-button:visible, button[data-studio-generate]:visible, .nai-generate-button:visible').first();
        await generate.waitFor({ state: 'visible' });
        const operationResponse = page.waitForResponse(response => response.url().includes('/api/images/operate') && response.request().method() === 'POST', { timeout: 30000 }).catch(error => ({ auditError: error }));
        if (device === 'phone') {
          const point = await generate.evaluate(element => {
            element.scrollIntoView({ block: 'center', behavior: 'instant' });
            const rect = element.getBoundingClientRect();
            const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
            const hit = document.elementFromPoint(x, y);
            return { x, y, rect: rect.toJSON(), hitInside: Boolean(hit && (hit === element || element.contains(hit))), hitTag: hit?.tagName || null, hitClass: typeof hit?.className === 'string' ? hit.className : '' };
          });
          result.phoneGenerateTap = point;
          assert(point.hitInside, `phone generate tap reaches the real button: ${JSON.stringify(point)}`);
          await page.touchscreen.tap(point.x, point.y);
        } else await generate.click();
        const response = await operationResponse;
        if (response.auditError) throw response.auditError;
        result.operationResponse = { status: response.status(), contentType: response.headers()['content-type'] };
        await page.waitForFunction(() => [...document.querySelectorAll('img')].some(image => ['NAI 主结果', '生成结果 1'].includes(image.alt) && image.complete && image.naturalWidth > 0), null, { timeout: 30000 });
        await expandGuide(page);
      }
      if (index < stepCount - 1) {
        await expandGuide(page);
        await page.locator('.feature-tutorial-panel footer button').last().click();
        await page.waitForFunction(title => document.querySelector('.feature-tutorial-panel h2')?.innerText === title, ['选择导演工具', '上传一张源图片', '生成候选结果', '检查处理结果并保存'][index]);
      } else {
        await expandGuide(page);
        await page.locator('.feature-tutorial-panel footer button').last().click();
        await page.waitForURL(/\/profile#profile-tutorials/);
        await page.locator('[data-tutorial-id="director"] .tutorial-completed').waitFor();
        result.completedAndReturned = true;
      }
    }
    assert.deepEqual(errors, [], `${device} runtime errors: ${errors.join('\n')}`);
    assert.deepEqual(consoleErrors, [], `${device} browser console errors: ${consoleErrors.join('\n')}`);
    return result;
  } catch (error) {
    result.failure = error.stack || error.message;
    try {
      result.failureUrl = page.url();
      result.failureText = (await page.locator('body').innerText()).slice(0, 6000);
      result.failureDOM = await page.evaluate(() => ({
        promptToggles: [...document.querySelectorAll('.mobile-studio-prompt-toggle')].map(element => ({ text: element.innerText, hidden: Boolean(element.closest('[hidden], [inert]')), rect: element.getBoundingClientRect().toJSON() })),
        promptAreas: [...document.querySelectorAll('.mobile-studio-workspace-dialog [data-workspace-pane="prompt"]')].map(element => ({ hidden: Boolean(element.closest('[hidden], [inert]')), textareas: [...element.querySelectorAll('textarea')].map(area => ({ visible: area.getBoundingClientRect().width > 0, placeholder: area.placeholder })) })),
        dialogs: [...document.querySelectorAll('[role="dialog"]')].map(element => ({ label: element.getAttribute('aria-label'), text: element.innerText.slice(0, 150) })),
        allTextareas: [...document.querySelectorAll('textarea')].map(area => ({ visible: area.getBoundingClientRect().width > 0, placeholder: area.placeholder, classes: area.className })),
      }));
    } catch {}
    throw Object.assign(error, { auditResult: result });
  } finally {
    await context.close();
  }
}

async function earlyExit(browser, fixturePng, audit) {
  const { context, page } = await setup(browser, {}, { width: 1440, height: 1000 });
  await installNetworkGuards(context, audit, fixturePng);
  try {
    await openGuide(page);
    await page.locator('.feature-tutorial-panel footer button').last().click();
    await page.locator('.feature-tutorial-panel h2').getByText('选择导演工具', { exact: true }).waitFor();
    await page.locator('.feature-tutorial-exit').click();
    await page.waitForURL(/\/profile#profile-tutorials/);
    await page.locator('[data-tutorial-id="director"]').waitFor({ state: 'visible' });
    return { returnedTo: page.url(), midTutorial: true };
  } finally { await context.close(); }
}

async function auditArticle(browser, fixturePng, audit) {
  const { context, page } = await setup(browser, {}, { width: 1440, height: 1000 });
  await installNetworkGuards(context, audit, fixturePng);
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  try {
    await page.goto(`${baseURL}/profile#profile-tutorials`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-tutorial-id="director"]').getByRole('button', { name: '去背景、线稿、上色与表情：图文教程', exact: true }).click();
    const steps = page.locator('.tutorial-article-step');
    const images = page.locator('img[data-tutorial-shot]');
    assert.equal(await steps.count(), stepCount, 'director article has all catalog steps');
    assert.equal(await images.count(), stepCount, 'each director article step has a screenshot');
    for (const image of await images.all()) {
      await image.scrollIntoViewIfNeeded();
      await page.waitForFunction(element => element.complete && element.naturalWidth === 1440 && element.naturalHeight === 1000, await image.elementHandle());
      await image.evaluate(element => element.decode());
    }
    const emphasizedTerms = await steps.locator('mark.tutorial-keyword').count();
    assert(emphasizedTerms >= stepCount, 'director article highlights important words');
    assert.deepEqual(errors, [], `article browser errors: ${errors.join('\n')}`);
    return { stepCount: await steps.count(), screenshotCount: await images.count(), emphasizedTerms };
  } finally { await context.close(); }
}

(async () => {
  fs.mkdirSync(publicDir, { recursive: true });
  for (const file of fs.readdirSync(publicDir)) if (/^step-\d{2}\.png$/.test(file) || ['audit.json', 'debug-after-operation.png'].includes(file)) fs.unlinkSync(path.join(publicDir, file));
  const sourceSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768"><rect width="1024" height="768" fill="#f2e7d7"/><circle cx="512" cy="250" r="150" fill="#57718f"/><path d="M280 640Q340 390 512 400Q680 390 744 640Z" fill="#b87864"/><path d="M250 650H774" stroke="#39475b" stroke-width="14" fill="none"/></svg>';
  const sourcePng = await sharp(Buffer.from(sourceSvg)).png().toBuffer();
  const resultSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="768"><rect width="1024" height="768" fill="#f2e7d7"/><circle cx="512" cy="250" r="150" fill="#7787b7"/><path d="M280 640Q340 390 512 400Q680 390 744 640Z" fill="#9686b0"/><path d="M250 650H774" stroke="#39475b" stroke-width="14" fill="none"/></svg>';
  const resultPng = await sharp(Buffer.from(resultSvg)).png().toBuffer();
  const audit = { auditedAt: new Date().toISOString(), baseURL, method: 'Local Edge browser; fake session; local-only API fixtures; no external network', externalRequests: [], apiWrites: [], unexpectedWrites: [], fixtureCalls: [], desktop: null, phone: null, article: null, earlyExit: null };
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    if (process.env.LFN_DIRECTOR_PHONE_ONLY !== '1') {
      audit.desktop = await runFlow(browser, { width: 1440, height: 1000 }, sourcePng, resultPng, audit);
      console.log('PASS director desktop hands-on flow');
    }
    audit.phone = await runFlow(browser, { width: 390, height: 844 }, sourcePng, resultPng, audit);
    console.log('PASS director phone hands-on flow');
    audit.article = await auditArticle(browser, sourcePng, audit);
    console.log('PASS director article screenshots loaded and emphasized');
    audit.earlyExit = await earlyExit(browser, sourcePng, audit);
    console.log('PASS director mid-tutorial exit returns to tutorial center');
    assert.equal(audit.fixtureCalls.length, 2, 'desktop and phone operations are fulfilled only by local route fixtures');
    assert(audit.fixtureCalls.every(call => call.operation === 'director-colorize'), 'only the selected local director tool was submitted');
    assert.deepEqual(audit.unexpectedWrites, [], 'no unexpected API writes');
    assert.deepEqual(audit.externalRequests, [], 'no external requests were attempted');
    assert.deepEqual(audit.desktop.errors, [], 'zero desktop page errors');
    assert.deepEqual(audit.phone.errors, [], 'zero phone page errors');
    audit.zeroUnexpectedApiWrites = true;
    audit.zeroExternalRequests = true;
    audit.zeroBrowserErrors = true;
    audit.fixtureOperationCount = audit.fixtureCalls.length;
    fs.writeFileSync(path.join(publicDir, 'audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
    console.log('PASS zero unexpected writes, external requests, and browser errors');
  } catch (error) {
    audit.failure = error.stack || error.message;
    if (error.auditResult) audit.failedFlow = error.auditResult;
    fs.writeFileSync(path.join(publicDir, 'audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
