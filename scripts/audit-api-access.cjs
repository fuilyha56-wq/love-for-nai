/* Local-only browser audit for the API-access feature tutorial. */
/* eslint-disable @typescript-eslint/no-require-imports -- standalone audit runner */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const ts = require('typescript');

process.env.LFN_UI_BASE_URL ||= 'http://localhost:3010';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
process.env.LFN_UI_TEST_SESSION_SECRET ||= 'lfn-local-tutorial-ui-test-secret-only-20261026';

const { chromium } = require(process.env.LFN_PLAYWRIGHT_MODULE);
const { loadTutorialCatalog } = require('./tutorial-test-support.cjs');
const output = path.resolve('public/tutorials/api-access');
const failureDir = path.resolve('.tmp/audit-api-access/failures');
const baseURL = process.env.LFN_UI_BASE_URL;
assert(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'API access audit only permits localhost');
assert(process.env.LFN_UI_TEST_SESSION_SECRET, 'Fixture-only fake session secret must be configured');

const tutorial = loadTutorialCatalog().featureTutorials.find(item => item.id === 'api-access');
assert(tutorial, 'api-access tutorial exists in current catalog');
const expectedTargets = [['#api-tokens'], ['#api-tokens form label:first-child'], ['article'], ['article']];
assert.equal(tutorial.steps.length, expectedTargets.length, 'Expected target map follows catalog step count');
const apiKey = 'sk-lfn-api-access-audit-fixture-only-20261026';
const documentationGuides = (() => {
  const filename = path.resolve('src/lib/documentation-content.ts');
  const exports = {};
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  new Function('exports', compiled)(exports);
  return exports.documentationGuides;
})();
const docs = ['api-keys-and-clients', 'troubleshooting'].map(slug => {
  const guide = documentationGuides.find(item => item.slug === slug);
  assert(guide, `Documentation fixture contains ${slug}`);
  return { slug: guide.slug, title: guide.title, category: guide.category, summary: guide.summary, content: guide.content, status: 'published', sortOrder: guide.sortOrder, createdAt: '2026-10-26T00:00:00.000Z', updatedAt: '2026-10-26T00:00:00.000Z' };
});
const fakeToken = { id: 9912026, name: 'API access local fixture', status: 1, created_time: 1792972800, expired_time: -1, remain_quota: 0, used_quota: 0, unlimited_quota: true, group: 'tutorial-fixture' };
const audit = {
  tutorial: 'api-access', catalogStepCount: tutorial.steps.length,
  method: 'Local Edge browser, fake session cookie, real application UI captures, API requests fulfilled by Playwright route fixtures',
  baseURL, externalRequestsBlocked: true, blockedExternalRequests: [], blockedWrites: [], unexpectedWrites: [],
  fixtures: { apiKeyCreation: 'fake record only', docs: docs.map(item => item.slug), modelCatalog: ['nai-v5-full-fixture'] },
  protections: { sessionIsFake: true, apiKeyIsFake: true, keyCreationIntercepted: true, clientValidationIntercepted: true, noRealKeyPersistence: true, noGenerationRequest: true },
  devices: [], screenshots: [],
};

function testCookie(secret) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = { userId: 7777777, username: 'api-access-tutorial-fixture', displayName: 'API 接入教程测试', upstreamCookie: '', authenticatedAt: Date.now(), expiresAt: Date.now() + 3600000, epoch: 1, userEpoch: 1 };
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

function publicTokenList() { return { items: [fakeToken], groups: [{ name: 'tutorial-fixture', desc: '本地 fixture', ratio: 1 }] }; }

async function setup(browser, device) {
  const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, isMobile: device.width < 1024, hasTouch: device.width < 1024, deviceScaleFactor: 1 });
  await context.addCookies([{ name: 'lfn_session', value: testCookie(process.env.LFN_UI_TEST_SESSION_SECRET), url: baseURL }]);
  await context.addInitScript(() => {
    for (const key of ['lfn-onboarding-v1', 'lfn-mobile-onboarding-v1']) localStorage.setItem(key, 'done');
    for (const key of ['lfn-guide-launcher-visible', 'lfn-mobile-guide-launcher-visible']) localStorage.setItem(key, 'false');
    localStorage.setItem('lfn-ui-preferences-v1', JSON.stringify({ version: 1, theme: 'paper', workspaceLayout: 'lfn' }));
    localStorage.setItem('lfn-mobile-ui-preferences-v1', JSON.stringify({ version: 1, theme: 'paper', workspaceLayout: 'lfn' }));
  });
  const origin = new URL(baseURL).origin;
  // Register the broad local-only guard first; route fixtures registered after
  // it take precedence and fulfill selected requests without hitting the app.
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      audit.blockedExternalRequests.push({ method: request.method(), origin: url.origin, path: url.pathname });
      return route.abort('blockedbyclient');
    }
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      const record = { method: request.method(), path: url.pathname };
      audit.blockedWrites.push(record);
      audit.unexpectedWrites.push(record);
      return route.fulfill({ status: 409, json: { message: 'API access tutorial audit blocks un-fixtured writes.' } });
    }
    return route.fallback();
  });
  const fixtureRequests = [];
  await context.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    fixtureRequests.push({ method, path: url.pathname });
    if (url.pathname === '/api/keys' && method === 'POST') {
      const body = request.postDataJSON();
      assert.equal(body.name, 'API 接入本地假密钥', 'Only the fake tutorial key name may be submitted');
      return route.fulfill({ json: { success: true } });
    }
    if (method !== 'GET' && method !== 'HEAD') {
      const record = { method, path: url.pathname };
      audit.blockedWrites.push(record);
      audit.unexpectedWrites.push(record);
      return route.fulfill({ status: 409, json: { message: 'API access tutorial audit blocks this write.' } });
    }
    if (url.pathname === '/api/keys') return route.fulfill({ json: publicTokenList() });
    if (url.pathname === '/api/models') return route.fulfill({ json: { items: [{ id: 'nai-v5-full-fixture', kind: '图像模型', capabilities: ['image'] }] } });
    if (url.pathname === '/api/me') return route.fulfill({ json: { authenticated: true, user: { id: 7777777, username: 'api-access-tutorial-fixture', displayName: 'API 接入教程测试', display_name: 'API 接入教程测试', group: 'tutorial-fixture' } } });
    if (url.pathname === '/api/admin') return route.fulfill({ json: { admin: false } });
    if (url.pathname === '/api/docs') return route.fulfill({ json: { items: docs } });
    if (url.pathname === '/api/aff/ledger') return route.fulfill({ json: { transactions: [] } });
    if (url.pathname === '/api/redeem/history') return route.fulfill({ json: { items: [] } });
    return route.fulfill({ json: { items: [] } });
  });
  const validationRequests = [];
  await context.route('**/v1/models', async route => {
    const request = route.request();
    const authorization = request.headers().authorization || '';
    validationRequests.push({ method: request.method(), path: new URL(request.url()).pathname, hasFixtureBearer: authorization === `Bearer ${apiKey}` });
    assert.equal(request.method(), 'GET', 'Client validation fixture only accepts read-only GET');
    assert.equal(authorization, `Bearer ${apiKey}`, 'Client validation uses only the fake API key');
    return route.fulfill({ json: { object: 'list', data: [{ id: 'nai-v5-full-fixture', object: 'model', owned_by: 'lfn-local-fixture' }] } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  return { context, page, fixtureRequests, validationRequests, errors };
}

async function screenshot(page, name) {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  const filename = path.join(output, name);
  await page.screenshot({ path: filename, animations: 'disabled' });
  const bytes = fs.readFileSync(filename);
  assert.equal(bytes.toString('hex', 0, 4), '89504e47', `PNG screenshot is valid: ${name}`);
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  assert(width >= 375 && height >= 600, `Capture has expected viewport size: ${name}`);
  audit.screenshots.push({ file: name, width, height });
}

async function openGuide(page) {
  await page.goto(`${baseURL}/profile#profile-tutorials`);
  await page.locator('#tutorial-center-content').waitFor({ state: 'visible' });
  await page.locator('[data-tutorial-id="api-access"]').getByRole('button', { name: `${tutorial.title}：手把手教程`, exact: true }).click();
  await page.locator('[data-testid="feature-tutorial"]').waitFor({ state: 'visible' });
}

async function verifyTarget(page, index, device) {
  const expected = expectedTargets[index];
  await page.waitForFunction(selectors => {
    const target = document.querySelector('[data-feature-tutorial-target="true"]');
    const spot = document.querySelector('.feature-tutorial-spotlight')?.getBoundingClientRect();
    if (!target || !selectors.some(selector => target.matches(selector)) || !spot || spot.width <= 0 || spot.height <= 0) return false;
    const rect = target.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight && spot.right >= rect.left && spot.left <= rect.right && spot.bottom >= rect.top && spot.top <= rect.bottom;
  }, expected, { timeout: 20000 });
  const evidence = await page.evaluate(selectors => {
    const element = document.querySelector('[data-feature-tutorial-target="true"]');
    const rect = element.getBoundingClientRect();
    const spot = document.querySelector('.feature-tutorial-spotlight').getBoundingClientRect();
    return { matches: selectors.some(selector => element.matches(selector)), text: (element.innerText || '').trim().slice(0, 140), bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }, spotlight: { x: Math.round(spot.x), y: Math.round(spot.y), width: Math.round(spot.width), height: Math.round(spot.height) }, visible: rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth && rect.bottom > 0 && rect.top < innerHeight, emphasized: [...document.querySelectorAll('.feature-tutorial-body mark.tutorial-keyword')].map(node => node.textContent.trim()).filter(Boolean) };
  }, expected);
  assert(evidence.matches && evidence.visible, `${device} step ${index + 1}: target is the expected visible real UI target`);
  assert(evidence.spotlight.width > 0 && evidence.spotlight.height > 0, `${device} step ${index + 1}: spotlight is visible`);
  assert(evidence.emphasized.length > 0, `${device} step ${index + 1}: important terms are highlighted`);
  for (const keyword of tutorial.steps[index].keywords || []) assert(evidence.emphasized.some(term => term.toLowerCase().includes(keyword.toLowerCase())), `${device} step ${index + 1}: catalog keyword highlighted (${keyword})`);
  return evidence;
}

async function runDevice(browser, device, captureScreenshots) {
  const { context, page, fixtureRequests, validationRequests, errors } = await setup(browser, device);
  const result = { device, steps: [], fixtureRequests, validationRequests, errors, passed: false };
  try {
    await openGuide(page);
    for (let index = 0; index < tutorial.steps.length; index += 1) {
      await page.waitForURL(url => url.pathname === new URL(tutorial.steps[index].path, baseURL).pathname && (index < 2 ? url.hash === '#api-tokens' : url.search === new URL(tutorial.steps[index].path, baseURL).search));
      if (index < 2) await page.getByText('API access local fixture', { exact: true }).waitFor({ state: 'visible' });
      if (index === 1) {
        await page.locator('.feature-tutorial-panel button[aria-label="收起说明，继续操作"]').click();
        await page.getByRole('button', { name: '创建密钥', exact: true }).first().click();
        await page.getByLabel('新密钥名称').fill('API 接入本地假密钥');
        await page.locator('.feature-tutorial-panel button[aria-label="展开教程说明"]').click();
      }
      if (index === 3) {
        await page.locator('.feature-tutorial-panel button[aria-label="收起说明，继续操作"]').click();
        if (device.width < 1024) await page.getByRole('button', { name: '返回目录', exact: true }).click();
        await page.getByRole('button', { name: /常见错误与请求排查/ }).click();
        await page.getByRole('heading', { name: '常见错误与请求排查', exact: true }).waitFor();
        await page.locator('.feature-tutorial-panel button[aria-label="展开教程说明"]').click();
      }
      if (index === 2) await page.getByRole('heading', { name: '创建密钥与选择外部工具', exact: true }).waitFor();
      const target = await verifyTarget(page, index, device.width < 1024 ? 'mobile' : 'desktop');
      const filename = `step-${String(index + 1).padStart(2, '0')}.png`;
      if (captureScreenshots) await screenshot(page, filename);
      result.steps.push({ number: index + 1, title: tutorial.steps[index].title, target, ...(captureScreenshots ? { screenshot: `/tutorials/api-access/${filename}` } : {}) });

      if (index === 1) {
        await page.locator('.feature-tutorial-panel button[aria-label="收起说明，继续操作"]').click();
        await page.locator('#api-tokens form').getByRole('button', { name: '创建密钥', exact: true }).click();
        await page.getByText('API 密钥已创建。可点击复制按钮获取完整密钥。', { exact: true }).waitFor();
        assert(fixtureRequests.some(request => request.method === 'POST' && request.path === '/api/keys'), 'API key creation was handled by the route fixture');
        await page.locator('.feature-tutorial-panel button[aria-label="展开教程说明"]').click();
      }
      if (index === 3) {
        const checked = await page.evaluate(async ({ token }) => {
          const response = await fetch('/v1/models', { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
          return { status: response.status, body: await response.json() };
        }, { token: apiKey });
        assert.equal(checked.status, 200, 'Local fixture accepted the read-only client validation request');
        assert.equal(checked.body.data[0].id, 'nai-v5-full-fixture');
        assert(validationRequests.some(request => request.method === 'GET' && request.path === '/v1/models' && request.hasFixtureBearer), 'Client validation was intercepted by the route fixture using the fake key');
      }
      if (index < tutorial.steps.length - 1) {
        await page.locator('.feature-tutorial-panel footer button').last().click();
        await page.getByRole('heading', { name: tutorial.steps[index + 1].title, exact: true }).waitFor();
      }
    }
    await page.locator('.feature-tutorial-panel footer button').last().click();
    await page.waitForURL(/\/profile#profile-tutorials/);
    await page.locator('[data-tutorial-id="api-access"]').waitFor({ state: 'visible' });
    const completion = await page.evaluate(() => JSON.parse(sessionStorage.getItem('lfn-feature-tutorial-result-v1') || 'null'));
    assert.deepEqual(completion, { tutorialId: 'api-access', completed: true });
    result.returnedToTutorialCenter = true;
    result.passed = true;
    assert.deepEqual(errors, [], `${device.width}x${device.height}: no browser runtime errors`);
    return result;
  } catch (error) {
    fs.mkdirSync(failureDir, { recursive: true });
    try { await page.screenshot({ path: path.join(failureDir, `${device.width}x${device.height}-failure.png`), fullPage: true }); } catch {}
    try { result.diagnostic = await page.evaluate(() => ({ url: location.href, text: document.body.innerText.slice(0, 1200), marked: [...document.querySelectorAll('[data-feature-tutorial-target="true"]')].map(item => ({ tag: item.tagName, text: (item.innerText || '').slice(0, 100) })) })); } catch {}
    result.failure = error.stack || error.message;
    fs.writeFileSync(path.join(failureDir, `${device.width}x${device.height}-partial.json`), `${JSON.stringify({ result, fixtureRequests, validationRequests }, null, 2)}\n`);
    throw error;
  } finally { await context.close(); }
}

async function auditArticle(browser) {
  const { context, page, errors } = await setup(browser, { width: 1440, height: 1000 });
  try {
    await page.goto(`${baseURL}/profile#profile-tutorials`);
    await page.locator('#tutorial-center-content').waitFor();
    await page.locator('[data-tutorial-id="api-access"]').getByRole('button', { name: `${tutorial.title}：图文教程`, exact: true }).click();
    const steps = page.locator('.tutorial-article-step');
    const images = page.locator('.tutorial-article img[data-tutorial-shot]');
    assert.equal(await steps.count(), tutorial.steps.length, 'Illustrated tutorial shows every catalog step');
    assert.equal(await images.count(), tutorial.steps.length, 'Illustrated tutorial has one capture per catalog step');
    await images.evaluateAll(list => list.forEach(image => { image.loading = 'eager'; }));
    const imageResults = [];
    for (const image of await images.all()) {
      await image.scrollIntoViewIfNeeded();
      await image.evaluate(element => element.decode());
      imageResults.push(await image.evaluate(element => ({ src: element.getAttribute('src'), width: element.naturalWidth, height: element.naturalHeight, complete: element.complete })));
    }
    assert(imageResults.every(image => image.complete && image.width >= 375 && image.height >= 600), 'Every article screenshot loaded from its local capture');
    const keywords = await steps.locator('mark.tutorial-keyword').count();
    assert(keywords >= tutorial.steps.length, 'Article highlights important terms in every catalog step');
    assert.deepEqual(errors, [], `Article runtime errors: ${errors.join('\n')}`);
    return { catalogSteps: tutorial.steps.length, articleSteps: await steps.count(), screenshotCount: await images.count(), screenshotsLoaded: imageResults, emphasizedTerms: keywords };
  } finally { await context.close(); }
}

async function earlyExit(browser) {
  const { context, page } = await setup(browser, { width: 1440, height: 1000 });
  try {
    await openGuide(page);
    await page.locator('.feature-tutorial-panel footer button').last().click();
    await page.getByRole('heading', { name: tutorial.steps[1].title, exact: true }).waitFor();
    await page.locator('.feature-tutorial-exit').click();
    await page.waitForURL(/\/profile#profile-tutorials/);
    await page.locator('[data-tutorial-id="api-access"]').waitFor({ state: 'visible' });
    const completion = await page.evaluate(() => JSON.parse(sessionStorage.getItem('lfn-feature-tutorial-result-v1') || 'null'));
    assert.deepEqual(completion, { tutorialId: 'api-access', completed: false });
    return { returnedToTutorialCenter: true, midTutorial: true };
  } finally { await context.close(); }
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  fs.mkdirSync(failureDir, { recursive: true });
  for (const name of fs.readdirSync(output)) if (/^step-\d{2}\.png$/.test(name) || name === 'audit.json') fs.unlinkSync(path.join(output, name));
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    audit.devices.push(await runDevice(browser, { width: 1440, height: 1000 }, true));
    audit.devices.push(await runDevice(browser, { width: 390, height: 844 }, false));
    audit.article = await auditArticle(browser);
    audit.earlyExit = await earlyExit(browser);
    assert.deepEqual(audit.unexpectedWrites, [], 'No un-fixtured browser write request occurred');
    assert.deepEqual(audit.blockedExternalRequests, [], 'No external network request was attempted');
    assert.equal(audit.devices[0].fixtureRequests.filter(item => item.method === 'POST' && item.path === '/api/keys').length, 1, 'Desktop key creation was intercepted exactly once');
    assert.equal(audit.devices[1].fixtureRequests.filter(item => item.method === 'POST' && item.path === '/api/keys').length, 1, 'Mobile key creation was intercepted exactly once');
    assert.equal(audit.devices[0].validationRequests.filter(item => item.path === '/v1/models').length, 1);
    assert.equal(audit.devices[1].validationRequests.filter(item => item.path === '/v1/models').length, 1);
    assert.equal(audit.screenshots.length, tutorial.steps.length, 'One real desktop browser capture per catalog step');
    audit.screenshots.sort((a, b) => a.file.localeCompare(b.file));
    fs.writeFileSync(path.join(output, 'audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
    console.log(JSON.stringify({ steps: tutorial.steps.length, desktop: audit.devices[0].passed, mobile: audit.devices[1].passed, articleScreenshotsLoaded: audit.article.screenshotsLoaded.length, completion: audit.devices.every(result => result.returnedToTutorialCenter), earlyExit: audit.earlyExit.returnedToTutorialCenter, interceptedKeyCreations: 2, interceptedClientValidations: 2, blockedExternalRequests: 0, unexpectedWrites: 0, screenshotCount: audit.screenshots.length }, null, 2));
  } catch (error) {
    fs.writeFileSync(path.join(failureDir, 'failure.txt'), error.stack || error.message);
    console.error(`FAIL: ${error.stack || error.message}`);
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
