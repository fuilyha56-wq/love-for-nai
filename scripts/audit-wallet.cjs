/* Local-only browser audit for the wallet feature tutorial. */
/* eslint-disable @typescript-eslint/no-require-imports -- standalone local UI audit */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const sharp = require('sharp');

process.env.LFN_UI_BASE_URL ||= 'http://127.0.0.1:3000';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
process.env.LFN_UI_TEST_SESSION_SECRET ||= 'local-wallet-tutorial-audit-fixture-secret';

const { chromium } = require(process.env.LFN_PLAYWRIGHT_MODULE);
const { loadTutorialCatalog } = require('./tutorial-test-support.cjs');
const output = path.resolve('public/tutorials/wallet');
fs.mkdirSync(output, { recursive: true });
const catalog = loadTutorialCatalog();
const tutorial = catalog.featureTutorials.find(item => item.id === 'wallet');
assert(tutorial, 'Wallet tutorial exists in the current catalog');
assert.equal(tutorial.steps.length, 4, 'Wallet tutorial has four catalog steps');
const baseURL = process.env.LFN_UI_BASE_URL;
assert(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Audit only permits localhost');
assert(process.env.LFN_UI_TEST_SESSION_SECRET, 'Fixture-only session secret must be configured');

const expectedTargets = [
  ['#profile-wallet'],
  ['.profile-checkin-card'],
  ['#profile-redeem'],
  ['.usage-filter-card'],
];
const fixture = {
  user: { id: 7777777, username: 'wallet-tutorial-fixture', displayName: '钱包教程测试', display_name: '钱包教程测试', balance: 100, group: 'default' },
  wallet: {
    newApi: { balance: 42.5, used: 7.5, group: 'tutorial-fixture' },
    aff: { enabled: true, balance: 120, packageBalance: 24, totalBalance: 144, checkInEnabled: true, checkedInToday: false, checkInReward: 6, packageRateLimitRemaining: 10 },
    imagePackage: { purchaseEnabled: false, priceUsd: 0, affPerPackage: 0, rateLimit: 0 },
  },
  redemption: { id: 'wallet-tutorial-redemption-fixture', code: 'WALLET••••42', amount: 10, rewardType: 'aff', redeemedAt: '2026-10-26T09:30:00.000Z' },
};
const audit = {
  tutorial: 'wallet',
  catalogStepCount: tutorial.steps.length,
  fixtures: { userId: fixture.user.id, wallet: fixture.wallet, redemptionHistoryCount: 1, usageItems: 0 },
  protections: { allBrowserWritesBlocked: true, allExternalRequestsBlocked: true, checkInSubmitted: false, redemptionSubmitted: false },
  devices: [], screenshots: [], blockedExternalRequests: [], blockedWrites: [], unexpectedWrites: [],
};

function testCookie(secret) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = { userId: fixture.user.id, username: fixture.user.username, displayName: fixture.user.displayName, upstreamCookie: '', authenticatedAt: Date.now(), expiresAt: Date.now() + 3600000, epoch: 1, userEpoch: 1 };
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

async function setup(browser, device) {
  const context = await browser.newContext({ viewport: { width: device.width, height: device.height }, isMobile: device.width < 1024, hasTouch: device.width < 1024, deviceScaleFactor: 1 });
  await context.addCookies([{ name: 'lfn_session', value: testCookie(process.env.LFN_UI_TEST_SESSION_SECRET), url: baseURL }]);
  await context.addInitScript(() => {
    localStorage.setItem('lfn-onboarding-v1', 'done');
    localStorage.setItem('lfn-guide-launcher-visible', 'false');
    localStorage.setItem('lfn-mobile-onboarding-v1', 'done');
    localStorage.setItem('lfn-mobile-guide-launcher-visible', 'false');
    localStorage.setItem('lfn-ui-preferences-v1', JSON.stringify({ version: 1, theme: 'paper', workspaceLayout: 'lfn' }));
    localStorage.setItem('lfn-mobile-ui-preferences-v1', JSON.stringify({ version: 1, theme: 'paper', workspaceLayout: 'lfn' }));
  });
  const origin = new URL(baseURL).origin;
  // This catch-all is registered first; the later API fixture route takes precedence.
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      audit.blockedExternalRequests.push(url.origin);
      return route.abort('blockedbyclient');
    }
    if (!['GET', 'HEAD'].includes(request.method())) {
      const record = { method: request.method(), path: url.pathname };
      audit.blockedWrites.push(record);
      audit.unexpectedWrites.push(record);
      return route.fulfill({ status: 409, json: { message: 'Wallet tutorial audit blocks every write request.' } });
    }
    return route.fallback();
  });
  await context.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!['GET', 'HEAD'].includes(request.method())) {
      const record = { method: request.method(), path: url.pathname };
      audit.blockedWrites.push(record);
      audit.unexpectedWrites.push(record);
      return route.fulfill({ status: 409, json: { message: 'Wallet tutorial audit blocks every API write.' } });
    }
    const responses = {
      '/api/me': { authenticated: true, user: fixture.user },
      '/api/wallet': fixture.wallet,
      '/api/aff/ledger': { transactions: [{ id: 'wallet-ledger-fixture', type: 'check-in', amount: 6, createdAt: '2026-10-26T09:30:00.000Z', description: '签到奖励（本地夹具）' }] },
      '/api/redeem/history': { items: [fixture.redemption] },
      '/api/aff/referral': { enabled: false, invitedCount: 0, registrationReward: 0 },
      '/api/usage': { items: [], total: 0, page: 1, pageSize: 20 },
      '/api/models': { items: [] },
      '/api/announcements': { items: [] },
      '/api/admin': { admin: false },
      '/api/public/image-policy': { enableV5Models: true, enableV45Models: true },
    };
    return route.fulfill({ json: responses[url.pathname] || { items: [] } });
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  return { context, page };
}

async function screenshot(page, name) {
  const filename = path.join(output, name);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(180);
  await page.screenshot({ path: filename, animations: 'disabled' });
  const metadata = await sharp(filename).metadata();
  assert(metadata.width >= 375 && metadata.height >= 600, `Full page UI screenshot captured: ${name}`);
  audit.screenshots.push({ file: name, width: metadata.width, height: metadata.height });
}

async function center(page) {
  await page.goto(`${baseURL}/profile#profile-tutorials`);
  await page.locator('#tutorial-center-content').waitFor();
  await page.locator('[data-tutorial-id="wallet"]').getByRole('button', { name: '签到、兑换码与创作额度：手把手教程', exact: true }).click();
  await page.locator('.feature-tutorial-panel h2').getByText(tutorial.steps[0].title, { exact: true }).waitFor();
}

async function verifyIllustratedScreenshots(browser) {
  const { context, page } = await setup(browser, { name: 'article-check', width: 1440, height: 1000 });
  try {
    await page.goto(`${baseURL}/profile#profile-tutorials`);
    await page.locator('#tutorial-center-content').waitFor();
    await page.getByRole('button', { name: '签到、兑换码与创作额度：图文教程', exact: true }).click();
    const article = page.locator('.tutorial-article');
    await article.waitFor({ state: 'visible' });
    const images = article.locator('img[data-tutorial-shot]');
    assert.equal(await images.count(), tutorial.steps.length, 'Illustrated tutorial contains one image per current catalog step');
    await images.evaluateAll(nodes => nodes.forEach(image => { image.loading = 'eager'; }));
    await page.waitForFunction(() => [...document.querySelectorAll('.tutorial-article img[data-tutorial-shot]')].every(image => image.complete && image.naturalWidth > 0), null, { timeout: 20000 });
    const loaded = await images.evaluateAll(nodes => nodes.map(image => ({ src: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight })));
    assert(loaded.every(image => image.width > 0 && image.height > 0), 'Every screenshot in the illustrated tutorial loads from the local capture files');
    return loaded;
  } finally { await context.close(); }
}

async function verifyStep(page, index, device) {
  const selectors = expectedTargets[index];
  await page.waitForFunction(expected => {
    const targets = [...document.querySelectorAll('[data-feature-tutorial-target="true"]')];
    const spotlight = document.querySelector('.feature-tutorial-spotlight')?.getBoundingClientRect();
    if (targets.length !== 1 || !expected.some(selector => targets[0].matches(selector)) || !spotlight || spotlight.width <= 0 || spotlight.height <= 0) return false;
    const bounds = targets[0].getBoundingClientRect();
    return spotlight.right >= bounds.left && spotlight.left <= bounds.right && spotlight.bottom >= bounds.top && spotlight.top <= bounds.bottom;
  }, selectors, { timeout: 20000 });
  const evidence = await page.evaluate(expected => {
    const target = document.querySelector('[data-feature-tutorial-target="true"]');
    const bounds = target.getBoundingClientRect();
    const spot = document.querySelector('.feature-tutorial-spotlight')?.getBoundingClientRect();
    return {
      matches: expected.some(selector => target.matches(selector)),
      tag: target.tagName.toLowerCase(),
      label: target.getAttribute('aria-label') || target.getAttribute('title') || target.innerText?.trim().slice(0, 120),
      bounds: { x: Math.round(bounds.x), y: Math.round(bounds.y), width: Math.round(bounds.width), height: Math.round(bounds.height) },
      spotlight: spot ? { x: Math.round(spot.x), y: Math.round(spot.y), width: Math.round(spot.width), height: Math.round(spot.height) } : null,
      visible: bounds.width > 0 && bounds.height > 0 && bounds.left < innerWidth && bounds.right > 0 && bounds.top < innerHeight && bounds.bottom > 0,
      emphasized: [...document.querySelectorAll('.feature-tutorial-body .tutorial-keyword')].map(node => node.textContent.trim()).filter(Boolean),
    };
  }, selectors);
  assert(evidence.matches && evidence.visible, `${device} step ${index + 1}: spotlight maps to visible real UI (${JSON.stringify(evidence)})`);
  assert(evidence.spotlight && evidence.spotlight.width > 0 && evidence.spotlight.height > 0, `${device} step ${index + 1}: spotlight is visible (${JSON.stringify(evidence)})`);
  const sourceText = await page.locator('.feature-tutorial-body').innerText();
  const expectedKeywords = tutorial.steps[index].keywords || [];
  assert(expectedKeywords.length > 0, `${device} step ${index + 1}: tutorial catalog declares keywords`);
  for (const keyword of expectedKeywords) {
    assert(sourceText.toLowerCase().includes(keyword.toLowerCase()), `${device} step ${index + 1}: keyword exists in tutorial copy (${keyword})`);
    assert(evidence.emphasized.some(value => value.toLowerCase().includes(keyword.toLowerCase())), `${device} step ${index + 1}: keyword is actually highlighted (${keyword})`);
  }
  return evidence;
}

async function next(page, expectedTitle) {
  await page.locator('.feature-tutorial-panel footer').getByRole('button', { name: /下一步/ }).click();
  await page.locator('.feature-tutorial-panel h2').getByText(expectedTitle, { exact: true }).waitFor();
}

async function returnToCenter(page, completed) {
  const label = completed ? '完成教程，返回教程中心' : '退出教程，返回个人资料的教程中心';
  await page.locator('.feature-tutorial-panel').getByRole('button', { name: label, exact: true }).click();
  await page.waitForURL('**/profile#profile-tutorials');
  await page.locator('#tutorial-center-content').waitFor();
  await page.waitForFunction(() => !sessionStorage.getItem('lfn-feature-tutorial-session-v1'));
  assert.equal(await page.locator('.feature-tutorial-panel').count(), 0, 'Tutorial panel is closed after return');
}

async function runDevice(browser, device) {
  const { context, page } = await setup(browser, device);
  const result = { device: device.name, viewport: { width: device.width, height: device.height }, steps: [], returnedTo: null, completion: device.complete ? 'complete' : 'exit' };
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.stack || error.message));
  page.on('console', message => { if (message.type() === 'error' && /hydration|hydrated|didn't match/i.test(message.text())) runtimeErrors.push(message.text()); });
  try {
    await center(page);
    for (let index = 0; index < tutorial.steps.length; index += 1) {
      const evidence = await verifyStep(page, index, device.name);
      await screenshot(page, `${device.name}-step-${String(index + 1).padStart(2, '0')}.png`);
      result.steps.push({ index: index + 1, title: tutorial.steps[index].title, target: evidence });
      if (index === 1) {
        // The real check-in button remains unclicked; every write route is blocked.
        assert(await page.locator('.profile-checkin-card button:not([aria-label])').isVisible(), 'Fixture shows the enabled check-in control without submitting it');
      }
      if (index === 2) {
        assert(await page.locator('#profile-redeem-code').isVisible(), 'Fixture shows the redemption input without submitting a code');
        assert((await page.locator('.profile-redeem-history').innerText()).includes('10 AFF'), 'Redemption history is rendered from the local fixture');
      }
      if (index === 3) {
        assert(await page.locator('.usage-filter-card').isVisible(), 'Usage filters render against the local empty ledger fixture');
        assert((await page.locator('body').innerText()).includes('暂无使用记录'), 'Usage list renders the fixture empty state');
      }
      if (index < tutorial.steps.length - 1) await next(page, tutorial.steps[index + 1].title);
    }
    assert.deepEqual(audit.unexpectedWrites, [], 'No browser write request was attempted');
    assert.deepEqual(audit.blockedExternalRequests, [], 'No external request was attempted');
    assert.equal(runtimeErrors.length, 0, `No UI runtime errors: ${runtimeErrors.join('\n')}`);
    await returnToCenter(page, device.complete);
    result.passed = true;
    result.returnedTo = `${new URL(page.url()).pathname}${new URL(page.url()).hash}`;
    result.runtimeErrors = runtimeErrors;
    audit.devices.push(result);
  } catch (error) {
    await screenshot(page, `${device.name}-failure.png`).catch(() => {});
    result.passed = false;
    result.error = error.stack || error.message;
    result.runtimeErrors = runtimeErrors;
    audit.devices.push(result);
    await page.goto(`${baseURL}/profile#profile-tutorials`).catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.LFN_UI_BROWSER_CHANNEL || 'msedge' });
  try {
    for (const device of [
      { name: 'desktop', width: 1440, height: 1000, complete: true },
      { name: 'mobile', width: 390, height: 844, complete: false },
    ]) await runDevice(browser, device);
    audit.illustratedTutorialLoaded = await verifyIllustratedScreenshots(browser);
  } finally {
    await browser.close();
    audit.screenshots.sort((a, b) => a.file.localeCompare(b.file));
    fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(audit, null, 2));
  }
  assert(audit.devices.every(device => device.passed), 'Desktop and mobile wallet tutorial audits pass');
  assert.equal(audit.screenshots.length, tutorial.steps.length * 2, 'Every catalog step has desktop and mobile screenshots');
  assert.deepEqual(audit.unexpectedWrites, [], 'No blocked write was attempted');
  console.log(JSON.stringify({ devices: audit.devices.map(({ device, passed, returnedTo, completion }) => ({ device, passed, returnedTo, completion })), screenshotCount: audit.screenshots.length, blockedExternalRequests: audit.blockedExternalRequests.length, writesBlocked: audit.blockedWrites.length, unexpectedWrites: audit.unexpectedWrites.length }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
