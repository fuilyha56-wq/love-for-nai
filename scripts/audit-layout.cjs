/* Local-only browser audit for the theme and workspace layout tutorial. */
/* eslint-disable @typescript-eslint/no-require-imports -- standalone local UI audit */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

process.env.LFN_UI_BASE_URL ||= 'http://localhost:3010';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
process.env.LFN_UI_TEST_SESSION_SECRET ||= 'lfn-local-tutorial-ui-test-secret-only-20261026';
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const { loadTutorialCatalog } = require('./tutorial-test-support.cjs');

const output = path.resolve('public/tutorials/layout');
fs.mkdirSync(output, { recursive: true });
const catalog = loadTutorialCatalog();
const tutorial = catalog.featureTutorials.find(item => item.id === 'layout');
assert(tutorial, 'Layout tutorial exists in the current catalog');
assert.equal(tutorial.steps.length, 4, 'Layout tutorial has four catalog steps');
assert(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Audit only permits localhost');
assert(process.env.LFN_UI_TEST_SESSION_SECRET, 'Local-only test session is configured');

const selectors = [
  "article.panel button[aria-pressed='true']",
  'a[href="/image/setting/layout"]',
  '[data-layout-module="image"] .layout-drag-handle',
  '.layout-editor-bottom button',
];
const audit = {
  tutorial: 'layout', catalogStepCount: tutorial.steps.length,
  devices: [], screenshots: [], blockedExternalRequests: [], unexpectedWrites: [],
  interceptedWrites: [], localPreferenceChanges: [],
};

async function installGuards(context) {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      audit.blockedExternalRequests.push({ origin: url.origin, path: url.pathname, method: request.method() });
      return route.abort('blockedbyclient');
    }
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      const record = { method: request.method(), path: url.pathname };
      if (url.pathname.startsWith('/api/')) audit.unexpectedWrites.push(record);
      else audit.interceptedWrites.push(record);
      return route.fulfill({ status: 409, json: { message: 'Layout tutorial audit blocks network writes.' } });
    }
    return route.fallback();
  });
}

async function openTutorial(page) {
  await page.goto(`${baseURL}/profile#profile-tutorials`, { waitUntil: 'domcontentloaded' });
  const card = page.locator('[data-tutorial-id="layout"]');
  await card.waitFor({ state: 'visible' });
  await card.getByRole('button', { name: '主题与工作台布局：手把手教程', exact: true }).click();
  await page.locator('.feature-tutorial-panel h2').getByText(tutorial.steps[0].title, { exact: true }).waitFor();
  await page.waitForURL(/\/settings#appearance/);
}

async function verifyStep(page, index, device) {
  const expected = selectors[index];
  await page.locator('.feature-tutorial-panel h2').getByText(tutorial.steps[index].title, { exact: true }).waitFor();
  await page.waitForFunction(selector => {
    const marked = [...document.querySelectorAll('[data-feature-tutorial-target="true"]')];
    if (marked.length !== 1 || !marked[0].matches(selector)) return false;
    const rect = marked[0].getBoundingClientRect();
    const spotlight = document.querySelector('.feature-tutorial-spotlight')?.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.left < innerWidth && rect.right > 0 && rect.top < innerHeight && rect.bottom > 0 && spotlight?.width > 0 && spotlight?.height > 0;
  }, expected, { timeout: 20000 }).catch(async error => {
    const detail = await page.locator('[data-feature-tutorial-target="true"]').evaluateAll(nodes => nodes.map(node => ({ html: node.outerHTML.slice(0, 400), rect: node.getBoundingClientRect().toJSON() })));
    throw new Error(`${error.message}\n${JSON.stringify({ index, expected, detail, panel: await page.locator('.feature-tutorial-panel').innerText().catch(() => '') })}`);
  });
  const state = await page.evaluate(selector => {
    const target = document.querySelector('[data-feature-tutorial-target="true"]');
    const rect = target.getBoundingClientRect();
    const spotlight = document.querySelector('.feature-tutorial-spotlight')?.getBoundingClientRect();
    return {
      matches: target.matches(selector),
      text: (target.innerText || target.getAttribute('aria-label') || target.textContent || '').trim().slice(0, 120),
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      spotlight: spotlight && { x: Math.round(spotlight.x), y: Math.round(spotlight.y), width: Math.round(spotlight.width), height: Math.round(spotlight.height) },
      spotlightAligned: Boolean(spotlight && Math.abs(spotlight.x - Math.max(4, rect.x - 4)) < 3 && Math.abs(spotlight.y - Math.max(4, rect.y - 4)) <= 16),
      spotlightOffset: spotlight && { x: Math.round(spotlight.x - rect.x), y: Math.round(spotlight.y - rect.y) },
      visible: rect.width > 0 && rect.height > 0 && rect.left < innerWidth && rect.right > 0 && rect.top < innerHeight && rect.bottom > 0,
      emphasized: [...document.querySelectorAll('.feature-tutorial-body mark.tutorial-keyword')].map(node => node.textContent.trim()).filter(Boolean),
    };
  }, expected);
  assert(state.matches && state.visible, `${device} step ${index + 1}: the real expected target is visible`);
  assert(state.spotlight && state.spotlight.width > 0 && state.spotlight.height > 0 && state.spotlightAligned, `${device} step ${index + 1}: spotlight follows the real target: ${JSON.stringify(state)}`);
  assert(state.emphasized.length > 0, `${device} step ${index + 1}: important terms are emphasized`);
  return state;
}

async function saveScreenshot(page, device, index) {
  await page.evaluate(() => document.fonts.ready);
  const name = `${device}-step-${String(index + 1).padStart(2, '0')}.png`;
  const filename = path.join(output, name);
  await page.screenshot({ path: filename, animations: 'disabled' });
  const metadata = await sharp(filename).metadata();
  assert.equal(metadata.width, device === 'desktop' ? 1440 : 390, `${name} viewport width`);
  assert.equal(metadata.height, device === 'desktop' ? 1000 : 844, `${name} viewport height`);
  audit.screenshots.push({ file: name, width: metadata.width, height: metadata.height });
}

async function advance(page, title) {
  await page.locator('.feature-tutorial-panel footer').getByRole('button', { name: /下一步|继续/ }).click();
  await page.locator('.feature-tutorial-panel h2').getByText(title, { exact: true }).waitFor();
}

async function returnToCenter(page, completed) {
  await page.locator('.feature-tutorial-panel').getByRole('button', {
    name: completed ? '完成教程，返回教程中心' : '退出教程，返回个人资料的教程中心', exact: true,
  }).click();
  await page.waitForURL('**/profile#profile-tutorials');
  await page.locator('#tutorial-center-content').waitFor();
  await page.waitForFunction(() => !sessionStorage.getItem('lfn-feature-tutorial-session-v1'));
}

async function verifyArticle(page) {
  await page.locator('[data-tutorial-id="layout"]').getByRole('button', { name: '主题与工作台布局：图文教程', exact: true }).click();
  const images = page.locator('article.tutorial-article img[data-tutorial-shot]');
  assert.equal(await images.count(), tutorial.steps.length, 'The article has one actual screenshot per catalog step');
  const decoded = [];
  for (let i = 0; i < await images.count(); i += 1) {
    const image = images.nth(i);
    await image.scrollIntoViewIfNeeded();
    decoded.push(await image.evaluate(async element => {
      await element.decode();
      return { src: new URL(element.currentSrc || element.src).pathname, loaded: element.complete, width: element.naturalWidth, height: element.naturalHeight };
    }));
  }
  assert(decoded.every(image => image.loaded && image.width === 1440 && image.height === 1000), `All article screenshots decode at the recorded dimensions: ${JSON.stringify(decoded)}`);
  return decoded;
}

async function runDevice(browser, device) {
  const { context, page } = await setup(browser, { theme: 'paper', workspaceLayout: 'lfn' }, { width: device.width, height: device.height });
  await installGuards(context);
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  const result = { device: device.name, viewport: { width: device.width, height: device.height }, steps: [], completion: device.complete ? 'complete' : 'exit' };
  let originalOrder = null;
  try {
    await openTutorial(page);
    for (let index = 0; index < tutorial.steps.length; index += 1) {
      const target = await verifyStep(page, index, device.name);
      await saveScreenshot(page, device.name, index);
      result.steps.push({ number: index + 1, title: tutorial.steps[index].title, target });
      if (index === 0) {
        await page.getByRole('button', { name: /暮色/ }).click();
        const appearance = await page.evaluate(() => JSON.parse(localStorage.getItem(innerWidth < 1024 ? 'lfn-mobile-ui-preferences-v1' : 'lfn-ui-preferences-v1') || '{}'));
        assert.equal(appearance.theme, 'dusk', `${device.name}: theme selection updates only local preferences`);
        audit.localPreferenceChanges.push({ device: device.name, key: device.width < 1024 ? 'lfn-mobile-ui-preferences-v1' : 'lfn-ui-preferences-v1', change: 'theme=dusk' });
        await advance(page, tutorial.steps[1].title);
      } else if (index === 1) {
        await page.locator('a[href="/image/setting/layout"]').click();
        await page.waitForURL('**/image/setting/layout');
        await advance(page, tutorial.steps[2].title);
      } else if (index === 2) {
        originalOrder = await page.locator('[data-layout-zone="controls"] [data-layout-module]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-layout-module')));
        await page.locator('[data-layout-module="image"] .layout-drag-handle').press('ArrowDown');
        await page.locator('[data-layout-module="image"] .layout-module-visibility').click();
        await page.getByRole('slider', { name: '选中卡片宽度' }).press('ArrowLeft');
        const current = await page.locator('[data-layout-zone="controls"] [data-layout-module]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-layout-module')));
        assert.notDeepEqual(current, originalOrder, `${device.name}: keyboard reorder changes module order`);
        assert.equal(await page.locator('[data-layout-module="image"]').getAttribute('class').then(value => value.includes('is-hidden')), true, `${device.name}: visibility control changes the selected module`);
        await advance(page, tutorial.steps[3].title);
      } else {
        await page.locator('.layout-editor-bottom button').click();
        await page.getByRole('status').filter({ hasText: '自定义布局已保存到此浏览器。' }).waitFor();
        const stored = await page.evaluate(() => ({
          appearance: JSON.parse(localStorage.getItem(innerWidth < 1024 ? 'lfn-mobile-ui-preferences-v1' : 'lfn-ui-preferences-v1') || '{}'),
          layout: JSON.parse(localStorage.getItem(innerWidth < 1024 ? 'lfn-mobile-custom-layout-v1' : 'lfn-custom-layout-v1') || '{}'),
        }));
        assert.equal(stored.appearance.workspaceLayout, 'custom', `${device.name}: saved layout is selected locally`);
        assert.notDeepEqual(stored.layout.moduleOrder, originalOrder, `${device.name}: saved module order differs from the initial arrangement`);
        assert.equal(stored.layout.visibleModules?.image, false, `${device.name}: saved visibility is persisted locally`);
        audit.localPreferenceChanges.push({ device: device.name, key: device.width < 1024 ? 'lfn-mobile-custom-layout-v1' : 'lfn-custom-layout-v1', change: 'saved module arrangement' });
        await page.goto(`${baseURL}/image`, { waitUntil: 'domcontentloaded' });
        await page.locator('.feature-tutorial-panel').waitFor({ state: 'visible' });
        await page.waitForFunction(() => {
          const workspace = document.querySelector('[data-workspace-layout="custom"]');
          const hiddenModule = workspace?.querySelector('.settings-scroll > [data-layout-module="image"]');
          return Boolean(workspace && hiddenModule && getComputedStyle(hiddenModule).display === 'none');
        });
        result.workbenchState = await page.locator('[data-workspace-layout="custom"] .settings-scroll > [data-layout-module="image"]').evaluate(element => ({ layout: element.closest('[data-workspace-layout]')?.getAttribute('data-workspace-layout'), display: getComputedStyle(element).display }));
        result.workbenchChecked = true;
        await returnToCenter(page, device.complete);
      }
    }
    assert.deepEqual(audit.unexpectedWrites, [], 'No API write was made');
    assert.deepEqual(audit.blockedExternalRequests, [], 'No external request was attempted');
    assert.equal(errors.length, 0, `No page runtime errors: ${errors.join('\n')}`);
    result.passed = true;
    result.returnedTo = `${new URL(page.url()).pathname}${new URL(page.url()).hash}`;
    result.runtimeErrors = errors;
    if (device.complete) result.articleImages = await verifyArticle(page);
  } catch (error) {
    result.passed = false;
    result.error = error.stack || error.message;
    await page.screenshot({ path: path.join(output, `${device.name}-failure.png`), fullPage: true }).catch(() => {});
    await page.goto(`${baseURL}/profile#profile-tutorials`).catch(() => {});
    throw error;
  } finally {
    audit.devices.push(result);
    await context.close();
  }
}

async function runEarlyExit(browser) {
  const { context, page } = await setup(browser, { theme: 'paper', workspaceLayout: 'lfn' }, { width: 390, height: 844 });
  await installGuards(context);
  try {
    await openTutorial(page);
    await verifyStep(page, 0, 'mobile early-exit');
    await returnToCenter(page, false);
    audit.earlyExit = { passed: true, returnedTo: `${new URL(page.url()).pathname}${new URL(page.url()).hash}`, afterStep: 1 };
  } finally { await context.close(); }
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.LFN_UI_BROWSER_CHANNEL || 'msedge' });
  try {
    await runDevice(browser, { name: 'desktop', width: 1440, height: 1000, complete: true });
    await runDevice(browser, { name: 'mobile', width: 390, height: 844, complete: false });
    await runEarlyExit(browser);
  } finally {
    await browser.close();
    audit.screenshots.sort((a, b) => a.file.localeCompare(b.file));
    fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(audit, null, 2));
  }
  assert(audit.devices.every(device => device.passed), 'Desktop and mobile layout tutorial audits pass');
  assert.equal(audit.screenshots.length, tutorial.steps.length * 2, 'Every catalog step has desktop and mobile screenshots');
  assert.equal(audit.interceptedWrites.length, 0, 'The tutorial makes no network writes');
  assert(audit.earlyExit?.passed, 'Mid-tutorial exit returns to the tutorial center');
  console.log(JSON.stringify({ devices: audit.devices.map(({ device, passed, returnedTo, completion, workbenchChecked }) => ({ device, passed, returnedTo, completion, workbenchChecked })), earlyExit: audit.earlyExit, screenshotCount: audit.screenshots.length, blockedExternalRequests: audit.blockedExternalRequests.length, unexpectedWrites: audit.unexpectedWrites.length }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
