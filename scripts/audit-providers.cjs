/* Local UI audit for the providers tutorial. All upstream and non-fixture traffic is blocked. */
/* eslint-disable @typescript-eslint/no-require-imports -- standalone local tutorial audit runner */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
process.env.LFN_UI_BASE_URL ||= 'http://localhost:3010';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
process.env.LFN_UI_TEST_SESSION_SECRET ||= 'lfn-local-tutorial-ui-test-secret-only-20261026';
const { chromium, baseURL, setup } = require('./check-mobile-ui.cjs');
assert(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Use the shared localhost dev server');

const output = path.resolve('public/tutorials/providers');
fs.mkdirSync(output, { recursive: true });
const tutorial = require('./tutorial-test-support.cjs').loadTutorialCatalog().featureTutorials.find(item => item.id === 'providers');
assert(tutorial, 'providers must exist in the tutorial catalog');
assert.equal(tutorial.steps.length, 4, 'providers catalog has four steps');
assert(tutorial.steps.every((step, index) => step.screenshot?.src === `/tutorials/providers/step-${String(index + 1).padStart(2, '0')}.png`), 'Every catalog step must reference its local desktop screenshot');

const fakeProvider = {
  id: 'providers-audit-fixture', name: '本机审计图像接口', baseUrl: 'https://api.fixture.invalid/v1',
  models: ['fixture-image-v1'], capabilities: ['image'], protocol: 'openai-images', hasKey: true,
  createdAt: '2026-10-27T00:00:00.000Z',
};
const fakeNovelAiAccount = {
  connected: true, tier: 3, active: true,
  anlas: { fixed: 100, purchased: 25, total: 125 },
  usage: { percent: 82, isNegative: false, timeUntilNextPercent: 3600 },
  expiresAt: 1793059200,
};
const audit = {
  baseURL, tutorialId: 'providers', catalogStepCount: tutorial.steps.length,
  catalogScreenshotCount: tutorial.steps.length, viewportScreenshotCount: 0,
  fixture: {
    scope: 'POST /api/providers and PUT /api/providers/novelai are fulfilled by browser route fixtures; fixture values use .invalid and FAKE-only keys.',
    providerId: fakeProvider.id, modelId: fakeProvider.models[0],
    apiKey: '[redacted fake value]', novelAiKey: '[redacted fake value]',
    novelAiAccount: 'fixture only: Opus, active, 125 Anlas',
  },
  externalRequestsBlocked: true, nonFixtureWritesBlocked: true,
  scenarios: [], requests: [], blockedExternal: [], browserErrors: [],
};

async function installNetworkGuards(context, state, scenario) {
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(baseURL).origin) {
      audit.blockedExternal.push({ viewport: scenario, method: request.method(), origin: url.origin, path: url.pathname });
      return route.abort('blockedbyclient');
    }
    const method = request.method();
    const pathname = url.pathname;
    const record = { viewport: scenario, method, path: pathname };
    audit.requests.push(record);
    if (method === 'POST' && pathname === '/api/providers') {
      const body = request.postDataJSON();
      assert.equal(body.name, fakeProvider.name);
      assert.equal(body.baseUrl, fakeProvider.baseUrl);
      assert.deepEqual(body.models, fakeProvider.models);
      assert.equal(body.apiKey, 'FAKE-LOCAL-IMAGE-KEY-20261027');
      state.providerSaved = true;
      state.providerWrites += 1;
      record.outcome = 'fixture';
      record.fields = Object.keys(body).sort();
      return route.fulfill({ json: { item: fakeProvider } });
    }
    if (method === 'PUT' && pathname === '/api/providers/novelai') {
      const body = request.postDataJSON();
      assert.equal(body.key, 'FAKE-LOCAL-NOVELAI-KEY-20261027');
      state.novelAiSaved = true;
      state.novelAiWrites += 1;
      record.outcome = 'fixture';
      record.fields = Object.keys(body).sort();
      return route.fulfill({ json: { account: fakeNovelAiAccount } });
    }
    if (method !== 'GET') {
      record.outcome = 'blocked';
      return route.fulfill({ status: 409, json: { message: 'Providers audit blocks every non-fixture write.' } });
    }
    if (pathname === '/api/providers') return route.fulfill({ json: { items: state.providerSaved ? [fakeProvider] : [] } });
    if (pathname === '/api/providers/novelai') return route.fulfill({ json: { account: state.novelAiSaved ? fakeNovelAiAccount : null, keySaved: state.novelAiSaved } });
    return route.fallback();
  });
}

async function start(page) {
  await page.goto(`${baseURL}/profile#profile-tutorials`);
  const notice = page.getByRole('button', { name: '我知道了', exact: true });
  for (let count = 0; count < 8 && await notice.isVisible().catch(() => false); count++) await notice.click();
  await page.locator('[data-tutorial-id="providers"]').getByRole('button', { name: '导入自己的 API 或 NAI Key：手把手教程', exact: true }).click();
  await page.waitForFunction(() => location.pathname === '/settings' && location.hash === '#custom-providers');
  await page.locator('.feature-tutorial-panel h2').getByText(tutorial.steps[0].title, { exact: true }).waitFor();
}

async function verifySpotlight(page, index) {
  await page.waitForFunction(() => {
    const target = document.querySelector('[data-feature-tutorial-target="true"]');
    const spotlight = document.querySelector('.feature-tutorial-spotlight');
    if (!target || !spotlight) return false;
    const box = target.getBoundingClientRect();
    const rect = { top: parseFloat(spotlight.style.top), left: parseFloat(spotlight.style.left), width: parseFloat(spotlight.style.width), height: parseFloat(spotlight.style.height) };
    return rect.width > 0 && rect.height > 0 && rect.left <= box.right && rect.left + rect.width >= box.left && rect.top <= box.bottom && rect.top + rect.height >= box.top;
  });
  const target = page.locator('[data-feature-tutorial-target="true"]');
  assert.equal(await target.count(), 1, `Step ${index + 1}: exactly one real element must be highlighted`);
  assert(await target.isVisible(), `Step ${index + 1}: highlighted target must be visible`);
  const box = await target.boundingBox();
  assert(box && box.width > 0 && box.height > 0, `Step ${index + 1}: target must have visible bounds`);
  assert(await target.evaluate(element => getComputedStyle(element).outlineStyle === 'solid'), `Step ${index + 1}: highlighted element must show tutorial outline`);
  const spotlight = await page.locator('.feature-tutorial-spotlight').evaluate(element => ({
    top: parseFloat(element.style.top), left: parseFloat(element.style.left), width: parseFloat(element.style.width), height: parseFloat(element.style.height),
  }));
  assert(spotlight.width > 0 && spotlight.height > 0, `Step ${index + 1}: spotlight must have visible bounds`);
  assert(spotlight.left <= box.x + box.width && spotlight.left + spotlight.width >= box.x && spotlight.top <= box.y + box.height && spotlight.top + spotlight.height >= box.y,
    `Step ${index + 1}: spotlight must overlap the real target`);
  const emphasized = await page.locator('.feature-tutorial-body .tutorial-keyword').allTextContents();
  assert(emphasized.length > 0, `Step ${index + 1}: instructions must emphasize keywords`);
  for (const word of tutorial.steps[index].keywords) assert((await page.locator('.feature-tutorial-body').innerText()).includes(word), `Step ${index + 1}: expected keyword ${word}`);
  const panel = await page.locator('.feature-tutorial-panel').boundingBox();
  assert(panel && (box.x + box.width <= panel.x || box.x >= panel.x + panel.width || box.y + box.height <= panel.y || box.y >= panel.y + panel.height),
    `Step ${index + 1}: tutorial panel must not cover its target`);
  return {
    step: index + 1, title: tutorial.steps[index].title, emphasized,
    target: await target.evaluate(element => ({ tag: element.tagName.toLowerCase(), id: element.id, text: (element.innerText || '').trim().slice(0, 150), className: typeof element.className === 'string' ? element.className : '' })),
    bounds: box, spotlight,
  };
}

async function screenshot(page, viewport, index) {
  await page.evaluate(() => document.fonts.ready);
  const mobilePrefix = viewport === 'mobile' ? 'mobile-' : '';
  const filename = `${mobilePrefix}step-${String(index + 1).padStart(2, '0')}.png`;
  const file = path.join(output, filename);
  await page.screenshot({ path: file, animations: 'disabled' });
  const meta = await sharp(file).metadata();
  assert(meta.width >= (viewport === 'mobile' ? 360 : 1200) && meta.height >= 700, `${filename} must be a full real UI capture`);
  const response = await page.request.get(`${baseURL}/tutorials/providers/${filename}`);
  assert.equal(response.status(), 200, `${filename} must be served by the local app`);
  assert.equal(response.headers()['content-type']?.split(';')[0], 'image/png');
  audit.viewportScreenshotCount += 1;
  return { src: `/tutorials/providers/${filename}`, width: meta.width, height: meta.height };
}

async function advance(page, index) {
  const button = page.locator('.feature-tutorial-panel footer').getByRole('button', { name: /下一步/ });
  await button.click();
  await page.locator('.feature-tutorial-panel h2').getByText(tutorial.steps[index].title, { exact: true }).waitFor();
  await page.waitForTimeout(500);
}

async function runViewport(browser, viewport, size, complete) {
  const { context, page } = await setup(browser, { theme: 'paper', workspaceLayout: 'lfn' }, size);
  const state = { providerSaved: false, novelAiSaved: false, providerWrites: 0, novelAiWrites: 0 };
  await installNetworkGuards(context, state, viewport);
  page.setDefaultTimeout(18000);
  page.setDefaultNavigationTimeout(90000);
  const result = { viewport, steps: [], completionReturnedToCenter: false, exitReturnedToCenter: false, fixtureWrites: [] };
  page.on('pageerror', error => audit.browserErrors.push(`${viewport}: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error' && /hydration|hydrated|didn't match/i.test(message.text())) audit.browserErrors.push(`${viewport}: ${message.text()}`); });
  try {
    await start(page);
    result.steps.push({ ...await verifySpotlight(page, 0), screenshot: await screenshot(page, viewport, 0) });
    await advance(page, 1);
    result.steps.push(await verifySpotlight(page, 1));

    const sourceForm = page.locator('#custom-providers form');
    await sourceForm.getByLabel('名称', { exact: true }).fill(fakeProvider.name);
    await sourceForm.getByLabel('API 地址', { exact: true }).fill(fakeProvider.baseUrl);
    await sourceForm.getByLabel('API key', { exact: true }).fill('FAKE-LOCAL-IMAGE-KEY-20261027');
    await sourceForm.locator('textarea').fill(fakeProvider.models.join('\n'));
    const protocol = sourceForm.getByRole('button', { name: '图像接口协议', exact: true });
    await protocol.click();
    await page.getByRole('option', { name: /GPT Images/ }).click();
    await screenshot(page, viewport, 1);
    await page.locator('.feature-tutorial-panel').getByLabel('收起说明，继续操作', { exact: true }).click();
    await sourceForm.getByRole('button', { name: '保存接口', exact: true }).click();
    await page.getByRole('status').getByText(`已保存「${fakeProvider.name}」。可在生图工作台的模型菜单中选择。`, { exact: true }).waitFor();

    const account = page.locator('#novelai-account');
    await account.scrollIntoViewIfNeeded();
    const keyInput = account.getByLabel('NovelAI 官方 key', { exact: true });
    await keyInput.fill('FAKE-LOCAL-NOVELAI-KEY-20261027');
    await account.getByRole('button', { name: '验证并导入', exact: true }).click();
    await account.getByRole('status').getByText('NovelAI key 已验证并保存；现在可以在生图工作台选择 NovelAI 官方模型。', { exact: true }).waitFor();
    await account.getByText('Opus', { exact: true }).waitFor();
    await page.locator('.feature-tutorial-panel').getByRole('button', { name: '展开教程说明', exact: true }).click();
    result.fixtureWrites = [
      { method: 'POST', path: '/api/providers', fakeOnly: true },
      { method: 'PUT', path: '/api/providers/novelai', fakeOnly: true },
    ];

    await advance(page, 2);
    await page.evaluate(() => window.scrollBy({ top: -120, behavior: 'instant' }));
    await page.waitForTimeout(250);
    result.steps.push({ ...await verifySpotlight(page, 2), screenshot: await screenshot(page, viewport, 2) });
    assert(await page.locator('#custom-providers').innerText().then(text => text.includes(fakeProvider.name)), 'Saved fixture provider is displayed');
    assert(await account.innerText().then(text => /已连接 NovelAI 官方账号|Key 已保存/.test(text)), 'NovelAI fixture status is displayed');

    await advance(page, 3);
    await page.waitForURL('**/image');
    await page.waitForFunction(() => document.querySelector('[aria-label="模型来源"]') !== null);
    if (viewport === 'mobile') {
      const source = page.getByLabel('模型来源', { exact: true });
      if (!await source.isVisible().catch(() => false)) {
        await page.getByRole('button', { name: '打开生成参数', exact: true }).click();
        await page.getByRole('dialog', { name: '生成参数', exact: true }).waitFor();
      }
    }
    const liveSource = page.getByLabel('模型来源', { exact: true });
    await liveSource.click();
    await page.getByRole('option', { name: fakeProvider.name, exact: true }).click();
    await page.getByLabel('模型', { exact: true }).click();
    await page.getByRole('option', { name: fakeProvider.models[0], exact: true }).click();
    const currentModel = page.getByLabel('模型', { exact: true });
    assert((await currentModel.innerText()).includes(fakeProvider.models[0]), 'The fixture model is selected in the actual image workspace');
    result.steps.push({ ...await verifySpotlight(page, 3), screenshot: await screenshot(page, viewport, 3) });

    assert.equal(state.providerWrites, 1, 'One provider creation write was handled by the browser fixture');
    assert.equal(state.novelAiWrites, 1, 'One NovelAI import write was handled by the browser fixture');
    assert.equal(audit.blockedExternal.length, 0, 'No request may leave localhost');
    const localWrites = audit.requests.filter(request => request.viewport === viewport && request.method !== 'GET');
    assert.deepEqual(localWrites.map(request => `${request.method} ${request.path}`).sort(), ['POST /api/providers', 'PUT /api/providers/novelai'].sort(), 'Only the two fake fixture writes are allowed');

    if (complete) {
      await page.locator('.feature-tutorial-panel').getByRole('button', { name: '完成教程，返回教程中心', exact: true }).click();
      await page.waitForURL('**/profile#profile-tutorials');
      await page.locator('#tutorial-center-content').waitFor();
      result.completionReturnedToCenter = true;
    } else {
      await page.locator('.feature-tutorial-panel').getByRole('button', { name: '退出教程，返回个人资料的教程中心', exact: true }).click();
      await page.waitForURL('**/profile#profile-tutorials');
      await page.locator('#tutorial-center-content').waitFor();
      result.exitReturnedToCenter = true;
    }
    audit.scenarios.push(result);
  } catch (error) {
    const file = path.join(output, `${viewport}-failure.png`);
    await page.screenshot({ path: file, animations: 'disabled' }).catch(() => {});
    result.failure = error.stack || error.message;
    audit.scenarios.push(result);
    throw error;
  } finally {
    await context.close();
  }
}

async function verifyArticle(browser) {
  const { context, page } = await setup(browser, { theme: 'paper', workspaceLayout: 'lfn' }, { width: 1440, height: 1000 });
  await installNetworkGuards(context, { providerSaved: false, novelAiSaved: false, providerWrites: 0, novelAiWrites: 0 }, 'article');
  try {
    await page.goto(`${baseURL}/profile#profile-tutorials`);
    await page.locator('[data-tutorial-id="providers"]').getByRole('button', { name: '导入自己的 API 或 NAI Key：图文教程', exact: true }).click();
    await page.locator('#tutorial-article-title').getByText(tutorial.title, { exact: true }).waitFor();
    const images = page.locator('.tutorial-article [data-tutorial-shot]');
    assert.equal(await images.count(), tutorial.steps.length, 'Article screenshot count matches catalog steps');
    for (let index = 0; index < tutorial.steps.length; index += 1) {
      const image = images.nth(index);
      await image.scrollIntoViewIfNeeded();
      await page.waitForFunction(element => element.complete && element.naturalWidth >= 1200 && element.naturalHeight >= 800, await image.elementHandle(), { timeout: 20000 });
    }
    audit.articleImages = await images.evaluateAll(list => list.map(image => ({ src: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight, alt: image.alt })));
    assert(audit.articleImages.every(image => image.width >= 1200 && image.height >= 800), 'Every article screenshot loads as a full-size local capture');
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.LFN_UI_BROWSER_CHANNEL || 'msedge' });
  try {
    await runViewport(browser, 'desktop', { width: 1440, height: 1000 }, true);
    await runViewport(browser, 'mobile', { width: 390, height: 844 }, false);
    await verifyArticle(browser);
    assert.equal(audit.viewportScreenshotCount, tutorial.steps.length * 2, 'Desktop and mobile screenshots cover every catalog step');
    assert.equal(audit.blockedExternal.length, 0, 'No external requests were attempted');
    assert.equal(audit.requests.filter(request => request.method !== 'GET' && request.outcome !== 'fixture').length, 0, 'No non-fixture writes were attempted');
    assert.equal(audit.browserErrors.length, 0, audit.browserErrors.join('\n'));
    audit.screenshotFiles = fs.readdirSync(output).filter(name => /^(mobile-)?step-\d+\.png$/.test(name)).sort();
    assert.equal(audit.screenshotFiles.length, tutorial.steps.length * 2);
    audit.completed = true;
    fs.writeFileSync(path.join(output, 'audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
    console.log(JSON.stringify({ tutorial: 'providers', catalogSteps: tutorial.steps.length, desktopAndMobileScreenshots: audit.viewportScreenshotCount, articleImagesLoaded: audit.articleImages.length, completionReturnedToCenter: audit.scenarios.find(item => item.viewport === 'desktop')?.completionReturnedToCenter, exitReturnedToCenter: audit.scenarios.find(item => item.viewport === 'mobile')?.exitReturnedToCenter, fixtureWrites: audit.requests.filter(request => request.outcome === 'fixture').length, blockedExternalRequests: audit.blockedExternal.length, browserErrors: audit.browserErrors.length }));
  } catch (error) {
    audit.failure = error.stack || error.message;
    audit.screenshotFiles = fs.readdirSync(output).filter(name => /^(mobile-)?step-\d+\.png$/.test(name)).sort();
    fs.writeFileSync(path.join(output, 'audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
    throw error;
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
