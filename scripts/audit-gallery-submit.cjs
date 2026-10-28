/* Local-only browser audit for the gallery submission tutorial. */
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

const output = path.resolve('public/tutorials/gallery-submit');
fs.mkdirSync(output, { recursive: true });
const catalog = loadTutorialCatalog();
const tutorial = catalog.featureTutorials.find(item => item.id === 'gallery-submit');
assert(tutorial, 'Gallery submission tutorial exists in the current catalog');
assert.equal(tutorial.steps.length, 4, 'Gallery submission tutorial has four catalog steps');
assert(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Audit only permits localhost');
assert(process.env.LFN_UI_TEST_SESSION_SECRET, 'Fixture-only session secret must be configured');

const fixtureId = 'gallery-submit-tutorial-local-fixture';
const title = '本机投稿审计作品';
const authorName = '本机示例作者';
const tagText = 'blue hair, seaside, local fixture';
const imageBytes = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="900" viewBox="0 0 720 900"><defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#f6d6bb"/><stop offset=".53" stop-color="#edaa91"/><stop offset=".54" stop-color="#50839b"/><stop offset="1" stop-color="#174e68"/></linearGradient></defs><rect width="720" height="900" fill="url(#sky)"/><circle cx="520" cy="250" r="76" fill="#fff0bd"/><path d="M0 610Q180 550 340 640T720 590V900H0Z" fill="#255b70"/><path d="M0 728Q160 660 360 740T720 700" fill="none" stroke="#9fc8c4" stroke-width="14"/><text x="360" y="850" text-anchor="middle" font-family="sans-serif" font-size="30" fill="white">LOCAL FIXTURE</text></svg>');
const fixturePath = path.join(output, 'source-fixture.png');
const audit = {
  tutorial: 'gallery-submit', catalogStepCount: tutorial.steps.length,
  fixture: { id: fixtureId, file: 'source-fixture.png', title, source: 'local Playwright upload' },
  devices: [], screenshots: [], blockedExternalRequests: [], fixtureWrites: [], unexpectedWrites: [],
  fixtureReads: [],
};

async function installFixtures(context, imagePng) {
  const origin = new URL(baseURL).origin;
  const submission = { id: fixtureId, title, authorName, status: 'pending', submittedAt: '2026-10-27T00:00:00.000Z', imageUrl: `/api/gallery/${fixtureId}/image`, thumbnailUrl: `/api/gallery/${fixtureId}/image?variant=thumbnail` };
  await context.route('**/api/me', async route => {
    audit.fixtureReads.push({ method: route.request().method(), path: '/api/me' });
    return route.fulfill({ json: { authenticated: true, user: { id: 7777777, username: 'gallery-submit-ui-test', displayName: '本机投稿审计', display_name: '本机投稿审计', balance: 100, group: 'default' } } });
  });
  await context.route('**/api/gallery/mine', async route => {
    audit.fixtureReads.push({ method: route.request().method(), path: '/api/gallery/mine' });
    return route.fulfill({ json: { items: [submission] } });
  });
  await context.route(`**/api/gallery/${fixtureId}/image*`, async route => {
    audit.fixtureReads.push({ method: route.request().method(), path: `/api/gallery/${fixtureId}/image` });
    return route.fulfill({ contentType: 'image/png', body: imagePng });
  });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      audit.blockedExternalRequests.push({ origin: url.origin, path: url.pathname });
      return route.abort('blockedbyclient');
    }
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      if (request.method() === 'POST' && url.pathname === '/api/gallery') {
        const body = request.postDataBuffer() || Buffer.alloc(0);
        assert(body.includes(Buffer.from(title)), 'Fixture write contains the local title');
        assert(body.includes(Buffer.from(authorName)), 'Fixture write contains the local author name');
        assert(body.includes(Buffer.from('source-fixture.png')), 'Fixture write contains the selected local file');
        audit.fixtureWrites.push({ method: request.method(), path: url.pathname, title, filename: 'source-fixture.png', response: 'intercepted local fixture only' });
        return route.fulfill({ status: 201, json: { success: true, message: '本机 fixture 已拦截，未向服务端投稿。', item: { id: fixtureId, title, status: 'pending' } } });
      }
      const record = { method: request.method(), path: url.pathname };
      audit.unexpectedWrites.push(record);
      return route.fulfill({ status: 409, json: { message: 'Gallery submission tutorial audit blocks every non-fixture write.' } });
    }
    return route.fallback();
  });
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

async function openTutorial(page) {
  await page.goto(`${baseURL}/profile#profile-tutorials`, { waitUntil: 'domcontentloaded' });
  const card = page.locator('[data-tutorial-id="gallery-submit"]');
  await card.waitFor({ state: 'visible' });
  await card.getByRole('button', { name: /投稿、标签与活动：手把手教程/ }).click();
  await page.waitForURL(/\/gallery(?:\?|$)/);
  await page.locator('.feature-tutorial-panel h2').getByText(tutorial.steps[0].title, { exact: true }).waitFor();
}

async function verifyStep(page, index, device) {
  const selectors = [
    ['.workspace-page header button'],
    ['[role="dialog"][aria-label="提交作品"] label[for]'],
    ['[role="dialog"][aria-label="提交作品"] > .lfn-adaptive-footer button:last-child', '[role="dialog"][aria-label="提交作品"] > div:last-child button:last-child'],
    ['a[href="#submissions"]'],
  ][index];
  await page.waitForFunction(expected => {
    const targets = [...document.querySelectorAll('[data-feature-tutorial-target="true"]')];
    if (targets.length !== 1 || !expected.some(selector => targets[0].matches(selector))) return false;
    const rect = targets[0].getBoundingClientRect();
    const spotlight = document.querySelector('.feature-tutorial-spotlight')?.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.left < innerWidth && rect.right > 0 && rect.top < innerHeight && rect.bottom > 0 && spotlight?.width > 0 && spotlight?.height > 0;
  }, selectors, { timeout: 20000 }).catch(async error => {
    console.error(JSON.stringify({ step: index + 1, selectors, marked: await page.locator('[data-feature-tutorial-target="true"]').evaluateAll(nodes => nodes.map(node => ({ html: node.outerHTML.slice(0, 500), rect: node.getBoundingClientRect().toJSON() }))), panel: await page.locator('.feature-tutorial-panel').innerText().catch(() => 'missing') }));
    throw error;
  });
  const state = await page.evaluate(expected => {
    const target = document.querySelector('[data-feature-tutorial-target="true"]');
    const rect = target.getBoundingClientRect();
    const spotlight = document.querySelector('.feature-tutorial-spotlight')?.getBoundingClientRect();
    return {
      matches: expected.some(selector => target.matches(selector)),
      text: (target.innerText || target.getAttribute('aria-label') || target.getAttribute('placeholder') || '').trim().slice(0, 120),
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      spotlight: spotlight ? { x: Math.round(spotlight.x), y: Math.round(spotlight.y), width: Math.round(spotlight.width), height: Math.round(spotlight.height) } : null,
      visible: rect.width > 0 && rect.height > 0 && rect.left < innerWidth && rect.right > 0 && rect.top < innerHeight && rect.bottom > 0,
      emphasized: [...document.querySelectorAll('.feature-tutorial-body .tutorial-keyword')].map(node => node.textContent.trim()).filter(Boolean),
    };
  }, selectors);
  assert(state.matches && state.visible, `${device} step ${index + 1}: spotlight points to the expected visible control: ${JSON.stringify(state)}`);
  assert(state.spotlight && state.spotlight.width > 0 && state.spotlight.height > 0, `${device} step ${index + 1}: visible spotlight`);
  assert(state.emphasized.length > 0, `${device} step ${index + 1}: tutorial keywords are highlighted`);
  if (index === 0) assert(state.text.includes('投稿'), `${device} step 1 highlights the real submission button`);
  if (index === 2) assert(state.text.includes('提交审核'), `${device} step 3 highlights the real submit button`);
  if (index === 3) assert(state.text.includes('我的投稿'), `${device} step 4 highlights the actual submission-status link`);
  return state;
}

async function next(page, titleText) {
  await page.locator('.feature-tutorial-panel footer').getByRole('button', { name: /下一步|继续/ }).click({ force: true });
  await page.locator('.feature-tutorial-panel h2').getByText(titleText, { exact: true }).waitFor();
}

async function returnToCenter(page, complete) {
  await page.locator('.feature-tutorial-panel').getByRole('button', { name: complete ? '完成教程，返回教程中心' : '退出教程，返回个人资料的教程中心', exact: true }).click();
  await page.waitForURL('**/profile#profile-tutorials');
  await page.locator('#tutorial-center-content').waitFor();
  await page.waitForFunction(() => !sessionStorage.getItem('lfn-feature-tutorial-session-v1'));
}

async function prepareSubmission(page) {
  const dialog = page.getByRole('dialog', { name: '提交作品', exact: true });
  await dialog.waitFor();
  await dialog.getByLabel('标题', { exact: true }).fill(title);
  await dialog.getByLabel('作者 / 画师', { exact: false }).fill(authorName);
  await dialog.getByLabel('选择投稿图片', { exact: true }).setInputFiles(fixturePath);
  await dialog.getByLabel('公开标签', { exact: false }).fill(tagText);
  await dialog.getByText('已选择 1 张图片 · 重新选择', { exact: true }).waitFor();
  return dialog;
}

async function runDevice(browser, device, imagePng) {
  const { context, page } = await setup(browser, { theme: 'paper', workspaceLayout: 'lfn' }, { width: device.width, height: device.height });
  await installFixtures(context, imagePng);
  page.setDefaultTimeout(20000);
  const result = { device: device.name, viewport: { width: device.width, height: device.height }, steps: [], returnedTo: null, completion: device.complete ? 'complete' : 'exit' };
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.stack || error.message));
  try {
    await openTutorial(page);
    for (let index = 0; index < tutorial.steps.length; index += 1) {
      if (index === 1) await prepareSubmission(page);
      if (index === 3) {
        await page.waitForURL(/\/studio(?:\?|$)/);
        await page.getByRole('heading', { name: /我的投稿/ }).waitFor();
        await page.getByText(title, { exact: true }).waitFor();
        await page.locator('#submissions').getByText('待审核', { exact: true }).waitFor();
      }
      const evidence = await verifyStep(page, index, device.name);
      await saveScreenshot(page, device.name, index);
      result.steps.push({ number: index + 1, title: tutorial.steps[index].title, target: evidence });
      if (index === 3) {
        const articleImage = page.locator('#submissions img').first();
        await articleImage.scrollIntoViewIfNeeded();
        await page.waitForFunction(() => {
          const image = document.querySelector('#submissions img');
          const source = image?.currentSrc || image?.src || '';
          return Boolean(image?.complete && image.naturalWidth > 1 && source.startsWith('blob:'));
        });
        result.articleImage = await articleImage.evaluate(image => ({ loaded: image.complete && image.naturalWidth > 1, naturalWidth: image.naturalWidth, src: image.currentSrc || image.src }));
        assert(result.articleImage.loaded, `${device.name}: local article image is loaded in the submission row`);
      }
      if (index === 0) {
        await page.locator('[data-feature-tutorial-target="true"]').click();
        await page.getByRole('dialog', { name: '提交作品', exact: true }).waitFor();
        await next(page, tutorial.steps[1].title);
      } else if (index === 1) {
        const preview = page.locator('[role="dialog"][aria-label="提交作品"]');
        assert.equal(await preview.getByLabel('标题', { exact: true }).inputValue(), title, `${device.name}: title remains in the form`);
        assert.equal(await preview.getByLabel('作者 / 画师', { exact: false }).inputValue(), authorName, `${device.name}: attribution remains in the form`);
        assert(await preview.getByText('source-fixture.png', { exact: true }).isVisible(), `${device.name}: selected local file remains visible in the form`);
        await next(page, tutorial.steps[2].title);
      } else if (index === 2) {
        const dialog = page.getByRole('dialog', { name: '提交作品', exact: true });
        assert(await dialog.getByText('公开提示词与生成参数', { exact: true }).isVisible(), `${device.name}: publication visibility controls are visible before posting`);
        await dialog.getByRole('button', { name: '提交审核', exact: true }).click();
        await page.getByText('图片已提交审核，审核通过后会发布到图片广场。', { exact: true }).waitFor();
        assert.equal(audit.fixtureWrites.filter(write => write.title === title).length, device.name === 'desktop' ? 1 : 2, `${device.name}: only its local fixture submit is intercepted`);
        await next(page, tutorial.steps[3].title);
      }
    }
    assert.deepEqual(audit.unexpectedWrites, [], 'No non-fixture write was attempted');
    assert.deepEqual(audit.blockedExternalRequests, [], 'No external request was attempted');
    assert.equal(runtimeErrors.length, 0, `No UI runtime errors: ${runtimeErrors.join('\n')}`);
    await returnToCenter(page, device.complete);
    result.passed = true;
    result.returnedTo = `${new URL(page.url()).pathname}${new URL(page.url()).hash}`;
    result.runtimeErrors = runtimeErrors;
  } catch (error) {
    result.passed = false;
    result.error = error.stack || error.message;
    await page.screenshot({ path: path.join(output, `${device.name}-failure.png`), fullPage: true }).catch(() => {});
    await page.goto(`${baseURL}/profile#profile-tutorials`).catch(() => {});
  } finally {
    audit.devices.push(result);
    await context.close();
  }
}

async function runEarlyExit(browser, imagePng) {
  const { context, page } = await setup(browser, { theme: 'paper', workspaceLayout: 'lfn' }, { width: 390, height: 844 });
  await installFixtures(context, imagePng);
  try {
    await openTutorial(page);
    await verifyStep(page, 0, 'mobile early-exit');
    await returnToCenter(page, false);
    audit.earlyExit = { passed: true, returnedTo: `${new URL(page.url()).pathname}${new URL(page.url()).hash}`, afterStep: 1 };
  } finally { await context.close(); }
}

(async () => {
  fs.writeFileSync(fixturePath, await sharp(imageBytes).png().toBuffer());
  const imagePng = fs.readFileSync(fixturePath);
  const browser = await chromium.launch({ headless: true, channel: process.env.LFN_UI_BROWSER_CHANNEL || 'msedge' });
  try {
    await runDevice(browser, { name: 'desktop', width: 1440, height: 1000, complete: true }, imagePng);
    await runDevice(browser, { name: 'mobile', width: 390, height: 844, complete: false }, imagePng);
    await runEarlyExit(browser, imagePng);
  } finally {
    await browser.close();
    audit.screenshots.sort((a, b) => a.file.localeCompare(b.file));
    fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(audit, null, 2));
  }
  assert(audit.devices.every(device => device.passed), 'Desktop and mobile gallery submission tutorial audits pass');
  assert.equal(audit.screenshots.length, tutorial.steps.length * 2, 'Every catalog step has desktop and mobile screenshots');
  assert.equal(audit.fixtureWrites.length, 2, 'Both actual submit clicks were intercepted by the local fixture');
  assert(audit.earlyExit?.passed, 'Early exit returns to the tutorial center');
  console.log(JSON.stringify({ devices: audit.devices.map(({ device, passed, returnedTo, completion }) => ({ device, passed, returnedTo, completion })), earlyExit: audit.earlyExit, screenshotCount: audit.screenshots.length, fixtureWrites: audit.fixtureWrites.length, blockedExternalRequests: audit.blockedExternalRequests.length, unexpectedWrites: audit.unexpectedWrites.length }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
