/* Local-only browser audit for the history feature tutorial. */
/* eslint-disable @typescript-eslint/no-require-imports -- standalone local UI audit */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

process.env.LFN_UI_BASE_URL ||= 'http://127.0.0.1:3000';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
process.env.LFN_UI_TEST_SESSION_SECRET ||= 'lfn-local-tutorial-ui-test-secret-only-20261026';

const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const { loadTutorialCatalog } = require('./tutorial-test-support.cjs');
const output = path.resolve('public/tutorials/history');
fs.mkdirSync(output, { recursive: true });
const catalog = loadTutorialCatalog();
const tutorial = catalog.featureTutorials.find(item => item.id === 'history');
assert(tutorial, 'History tutorial exists in the current catalog');
assert.equal(tutorial.steps.length, 4, 'History tutorial has four catalog steps');
assert(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Audit only permits localhost');
assert(process.env.LFN_UI_TEST_SESSION_SECRET, 'Fixture-only session secret must be configured');

const fixtureId = 'history-tutorial-local-fixture';
const fixture = {
  id: fixtureId,
  createdAt: '2026-10-25T09:30:00.000Z',
  imageUrl: `/api/history/${fixtureId}/image`,
  thumbnailUrl: `/api/history/${fixtureId}/image?variant=thumbnail`,
  parameters: {
    prompt: '1girl, blue hair, white dress, garden, sunlight',
    negative_prompt: 'blurry, low quality',
    model: 'nai-v5-full',
    width: 832,
    height: 1216,
    steps: 28,
    scale: 5,
    seed: 123456789,
    sampler: 'k_euler_ancestral',
    operation: 'generate',
  },
};
const allowedTargets = [
  ['.history-grid .history-image-button'],
  ['.image-download-menu summary[aria-label="下载图片"]', '.launcher-history-download', '.history-detail-download'],
  ['.history-grid .history-import-group a', '.history-grid .history-card button[aria-label*="历史图片操作"]', '.history-detail-download'],
  ['[data-tutorial="prompt"] textarea', '[data-layout-module="prompt"] textarea', '.mobile-studio-prompt-content textarea'],
];
const audit = { tutorial: 'history', catalogStepCount: tutorial.steps.length, fixtureId, devices: [], screenshots: [], blockedExternalRequests: [], unexpectedWrites: [] };

async function blockExternalAndWrites(context, requests) {
  const allowedOrigin = new URL(baseURL).origin;
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== allowedOrigin) {
      audit.blockedExternalRequests.push(url.origin);
      return route.abort('blockedbyclient');
    }
    if (url.pathname.startsWith('/api/') && request.method() !== 'GET' && request.method() !== 'HEAD') {
      const record = { method: request.method(), path: url.pathname };
      audit.unexpectedWrites.push(record);
      requests.push(record);
      return route.fulfill({ status: 409, json: { message: 'Local history tutorial audit blocks every write request.' } });
    }
    return route.fallback();
  });
  await context.route('**/api/history**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== 'GET') {
      const record = { method: request.method(), path: url.pathname };
      audit.unexpectedWrites.push(record);
      return route.fulfill({ status: 409, json: { message: 'Local history tutorial audit blocks every write request.' } });
    }
    if (url.pathname === '/api/history') return route.fulfill({ json: { items: [fixture] } });
    if (url.pathname === `/api/history/${fixtureId}`) return route.fulfill({ json: fixture });
    if (url.pathname === `/api/history/${fixtureId}/image`) return route.fulfill({ contentType: 'image/png', body: imagePng });
    return route.fulfill({ status: 404, json: { message: 'Unknown history fixture' } });
  });
}

async function screenshot(page, name) {
  const filename = path.join(output, name);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(180);
  await page.screenshot({ path: filename, animations: 'disabled' });
  const metadata = await sharp(filename).metadata();
  assert(metadata.width >= 375 && metadata.height >= 600, `Full application screenshot captured: ${name}`);
  audit.screenshots.push({ file: name, width: metadata.width, height: metadata.height });
}

async function center(page) {
  await page.goto(`${baseURL}/profile#profile-tutorials`);
  const noticeClose = page.getByRole('button', { name: '我知道了', exact: true });
  for (let i = 0; i < 6 && await noticeClose.isVisible().catch(() => false); i += 1) await noticeClose.click();
  await page.locator('#tutorial-center-content').waitFor();
}

async function start(page) {
  await page.locator('[data-tutorial-id="history"]').getByRole('button', { name: '图片历史、下载与参数复用：手把手教程', exact: true }).click();
  await page.waitForURL(/\/history(?:\?|$)/);
  await page.locator('.feature-tutorial-panel h2').getByText(tutorial.steps[0].title, { exact: true }).waitFor();
  await page.locator('.history-grid .history-image-button').waitFor({ state: 'visible' });
  await page.waitForFunction(() => [...document.querySelectorAll('.history-grid img')].some(image => image.complete && image.naturalWidth > 0));
}

async function verifyIllustratedScreenshots(page) {
  await page.locator('[data-tutorial-id="history"]').getByRole('button', { name: '图片历史、下载与参数复用：图文教程', exact: true }).click();
  const article = page.locator('.tutorial-article');
  await article.waitFor({ state: 'visible' });
  const images = article.locator('img[data-tutorial-shot]');
  assert.equal(await images.count(), tutorial.steps.length, 'Illustrated tutorial shows one screenshot for each current catalog step');
  await images.evaluateAll(nodes => nodes.forEach(image => { image.loading = 'eager'; }));
  await page.waitForFunction(() => [...document.querySelectorAll('.tutorial-article img[data-tutorial-shot]')].every(image => image.complete && image.naturalWidth > 0), null, { timeout: 20000 });
  const loaded = await images.evaluateAll(nodes => nodes.map(image => ({ src: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight })));
  assert.equal(loaded.length, tutorial.steps.length);
  await page.getByRole('button', { name: '返回教程目录', exact: true }).click();
  await page.locator('#tutorial-center-content').waitFor();
  return loaded;
}

async function verifyStep(page, index, device) {
  const expected = allowedTargets[index];
  await page.waitForFunction(selectors => {
    const marked = [...document.querySelectorAll('[data-feature-tutorial-target="true"]')];
    return marked.length === 1 && selectors.some(selector => marked[0].matches(selector));
  }, expected, { timeout: 20000 });
  const state = await page.evaluate(selectors => {
    const target = document.querySelector('[data-feature-tutorial-target="true"]');
    const rect = target.getBoundingClientRect();
    const spotlight = document.querySelector('.feature-tutorial-spotlight')?.getBoundingClientRect();
    return {
      matches: selectors.some(selector => target.matches(selector)),
      tag: target.tagName.toLowerCase(),
      label: target.getAttribute('aria-label') || target.getAttribute('title') || target.innerText?.trim().slice(0, 120),
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      spotlight: spotlight ? { x: Math.round(spotlight.x), y: Math.round(spotlight.y), width: Math.round(spotlight.width), height: Math.round(spotlight.height) } : null,
      visible: rect.width > 0 && rect.height > 0 && rect.left < innerWidth && rect.right > 0,
      emphasized: [...document.querySelectorAll('.feature-tutorial-body .tutorial-keyword')].map(node => node.textContent.trim()).filter(Boolean),
    };
  }, expected);
  assert(state.matches && state.visible, `${device} step ${index + 1}: spotlight identifies a visible real control (${JSON.stringify(state)})`);
  assert(state.spotlight && state.bounds.width > 0 && state.spotlight.width > 0, `${device} step ${index + 1}: target has a visible spotlight`);
  assert(state.emphasized.length > 0, `${device} step ${index + 1}: tutorial keywords are highlighted`);
  return state;
}

async function next(page, expectedTitle) {
  await page.locator('.feature-tutorial-panel footer').getByRole('button', { name: /下一步/ }).click();
  await page.locator('.feature-tutorial-panel h2').getByText(expectedTitle, { exact: true }).waitFor();
}

async function openDownloadMenu(page, mobile) {
  if (mobile) {
    await page.getByRole('button', { name: /历史图片操作/ }).click();
    await page.getByRole('menu', { name: /历史图片操作/ }).locator('.image-download-menu summary').click();
  } else {
    await page.locator('.history-card .image-download-menu summary').click();
  }
  await page.getByRole('menu', { name: '图片下载方式', exact: true }).waitFor();
  assert(await page.getByRole('menuitem', { name: '下载原图', exact: true }).isVisible());
  assert(await page.getByRole('menuitem', { name: '抹除 NAI 数据后下载', exact: true }).isVisible());
}

async function importFixture(page, mobile) {
  if (mobile) {
    const menuButton = page.getByRole('button', { name: /历史图片操作/ });
    if (!await page.getByRole('menu', { name: /历史图片操作/ }).count()) await menuButton.click();
    await page.getByRole('menu', { name: /历史图片操作/ }).getByRole('link', { name: '导入为图生图', exact: true }).click();
  } else {
    const importLink = page.locator('.history-import-group a[aria-label="导入为图生图"]');
    await importLink.evaluate(element => element.click());
  }
  await page.waitForURL(/\/image\?.*historyId=history-tutorial-local-fixture/);
  await page.waitForFunction(() => document.querySelector('.mobile-studio-preview-section img, .studio-canvas img, .replica-media img')?.getAttribute('src')?.length > 0 || document.querySelector('[data-tutorial-source-ready="true"]'));
}

async function returnToCenter(page, completed) {
  await page.locator('.feature-tutorial-panel').getByRole('button', { name: completed ? '完成教程，返回教程中心' : '退出教程，返回个人资料的教程中心', exact: true }).click();
  await page.waitForURL('**/profile#profile-tutorials');
  await page.locator('#tutorial-center-content').waitFor();
  await page.waitForFunction(() => !sessionStorage.getItem('lfn-feature-tutorial-session-v1'));
  assert.equal(await page.locator('.feature-tutorial-panel').count(), 0);
}

async function runDevice(browser, device) {
  const { context, page } = await setup(browser, { theme: device.theme, workspaceLayout: device.layout }, { width: device.width, height: device.height });
  const writes = [];
  const runtimeErrors = [];
  const mobile = device.width < 1024;
  await blockExternalAndWrites(context, writes);
  page.setDefaultTimeout(18000);
  page.on('pageerror', error => runtimeErrors.push(error.stack || error.message));
  page.on('console', message => { if (message.type() === 'error' && /hydration|hydrated|didn't match/i.test(message.text())) runtimeErrors.push(message.text()); });
  const result = { device: device.name, viewport: { width: device.width, height: device.height }, steps: [], returnedTo: null, completion: device.complete ? 'complete' : 'exit' };
  try {
    await center(page);
    result.illustratedScreenshots = await verifyIllustratedScreenshots(page);
    await start(page);
    for (let index = 0; index < tutorial.steps.length; index += 1) {
      if (index === 1) await openDownloadMenu(page, mobile);
      if (index === 2) {
        if (mobile) {
          if (await page.getByRole('menu', { name: /历史图片操作/ }).count()) await page.keyboard.press('Escape');
        }
      }
      const evidence = await verifyStep(page, index, device.name);
      await screenshot(page, `${device.name}-step-${String(index + 1).padStart(2, '0')}.png`);
      result.steps.push({ index: index + 1, title: tutorial.steps[index].title, target: evidence });
      if (index === 0) {
        if (mobile) {
          await page.locator('.history-grid .history-image-button').click();
          await page.getByRole('dialog', { name: '历史图片预览', exact: true }).waitFor();
          await page.getByRole('button', { name: '关闭图片预览', exact: true }).click();
        } else {
          await page.locator('.history-grid .history-action[aria-label="查看完整请求参数"]').evaluate(element => element.click());
          await page.waitForURL(new RegExp(`/history/${fixtureId}`));
          await page.getByRole('heading', { name: '生成参数', exact: true }).waitFor();
          assert((await page.locator('body').innerText()).includes(fixture.parameters.prompt), 'History detail shows the fixture prompt');
          await page.locator('a[href="/history"]').first().click();
          await page.waitForURL(/\/history$/);
          await page.locator('.feature-tutorial-panel h2').getByText(tutorial.steps[0].title, { exact: true }).waitFor();
        }
        await next(page, tutorial.steps[1].title);
      } else if (index === 1) {
        const downloadEvent = page.waitForEvent('download');
        await page.getByRole('menuitem', { name: '下载原图', exact: true }).click();
        const download = await downloadEvent;
        assert.match(download.suggestedFilename(), /history-tutorial-local-fixture/);
        await page.keyboard.press('Escape');
        if (mobile) {
          if (!await page.getByRole('menu', { name: /历史图片操作/ }).count()) await page.getByRole('button', { name: /历史图片操作/ }).click();
          await page.getByRole('menu', { name: /历史图片操作/ }).getByRole('link', { name: '完整请求参数', exact: true }).click();
        } else {
          await page.locator('.history-card .history-action[aria-label="查看完整请求参数"]').evaluate(element => element.click());
        }
        await page.waitForURL(new RegExp(`/history/${fixtureId}`));
        if (mobile) {
          await page.getByRole('button', { name: '图片信息', exact: true }).click();
          const info = page.getByRole('dialog', { name: '图片信息', exact: true });
          await info.waitFor();
          assert((await info.innerText()).includes('123456789'), `${device.name}: detail exposes fixture generation settings`);
          await info.getByRole('button', { name: '关闭图片信息', exact: true }).click();
          await page.getByRole('link', { name: '返回图片历史', exact: true }).click();
        } else {
          await page.getByRole('heading', { name: '生成参数', exact: true }).waitFor();
          assert((await page.locator('body').innerText()).includes('123456789'), `${device.name}: detail exposes fixture generation settings`);
          await page.locator('a[href="/history"]').first().click();
        }
        await page.waitForURL(/\/history$/);
        await page.locator('.feature-tutorial-panel h2').getByText(tutorial.steps[1].title, { exact: true }).waitFor();
        await next(page, tutorial.steps[2].title);
      } else if (index === 2) {
        await importFixture(page, mobile);
        await next(page, tutorial.steps[3].title);
      } else {
        const prompt = page.locator('[data-tutorial="prompt"] textarea:visible, [data-layout-module="prompt"] textarea:visible, .mobile-studio-prompt-content textarea:visible').first();
        assert((await prompt.inputValue()).includes(fixture.parameters.prompt), `${device.name}: imported prompt is visible in the actual prompt control`);
        assert(await page.locator('.mobile-studio-reference-panel img:visible, [data-tutorial="source"] img:visible').count() > 0 || mobile, `${device.name}: imported image context remains available`);
      }
      if (index < tutorial.steps.length - 1) await page.waitForTimeout(80);
    }
    assert.deepEqual(audit.unexpectedWrites, [], 'No non-fixture write was attempted');
    assert.deepEqual(audit.blockedExternalRequests, [], 'No external request was attempted');
    assert.equal(runtimeErrors.length, 0, `No UI runtime errors: ${runtimeErrors.join('\n')}`);
    await returnToCenter(page, device.complete);
    result.passed = true;
    result.returnedTo = `${new URL(page.url()).pathname}${new URL(page.url()).hash}`;
    result.unexpectedWrites = writes;
    result.runtimeErrors = runtimeErrors;
    audit.devices.push(result);
  } catch (error) {
    await screenshot(page, `${device.name}-failure.png`).catch(() => {});
    result.passed = false;
    result.error = error.stack || error.message;
    result.unexpectedWrites = writes;
    result.runtimeErrors = runtimeErrors;
    audit.devices.push(result);
    // Keep the browser at the required return location even when the audit fails.
    await page.goto(`${baseURL}/profile#profile-tutorials`).catch(() => {});
    throw error;
  } finally {
    await context.close();
  }
}

let imagePng;
(async () => {
  imagePng = await sharp(Buffer.from('<svg width="720" height="960" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x2="0" y2="1"><stop stop-color="#c6e7e1"/><stop offset="1" stop-color="#f6d9c8"/></linearGradient></defs><rect width="720" height="960" fill="url(#g)"/><circle cx="360" cy="370" r="180" fill="#f4c9a4"/><path d="M180 900 Q220 560 360 560 Q520 560 550 900" fill="#d7f2ef"/><path d="M215 350 Q240 145 400 190 Q500 220 500 410 Q430 300 330 300 Q260 300 215 350" fill="#415c89"/><circle cx="300" cy="390" r="15" fill="#31313a"/><circle cx="420" cy="390" r="15" fill="#31313a"/><path d="M300 470 Q360 520 425 470" fill="none" stroke="#a24c51" stroke-width="12" stroke-linecap="round"/><path d="M70 870 Q160 700 210 780 M650 860 Q560 680 520 780" fill="none" stroke="#55886e" stroke-width="24" stroke-linecap="round"/></svg>')).png().toBuffer();
  const browser = await chromium.launch({ headless: true, channel: process.env.LFN_UI_BROWSER_CHANNEL || 'msedge' });
  try {
    for (const device of [
      { name: 'desktop', width: 1440, height: 1000, theme: 'paper', layout: 'lfn', complete: true },
      { name: 'mobile', width: 390, height: 844, theme: 'night', layout: 'lfn', complete: false },
    ]) await runDevice(browser, device);
  } finally {
    await browser.close();
    audit.screenshots.sort((a, b) => a.file.localeCompare(b.file));
    fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(audit, null, 2));
  }
  assert(audit.devices.every(device => device.passed), 'Desktop and mobile history tutorial audits pass');
  assert.equal(audit.screenshots.length, tutorial.steps.length * 2, 'Every catalog step has desktop and mobile screenshots');
  console.log(JSON.stringify({ devices: audit.devices.map(({ device, passed, returnedTo }) => ({ device, passed, returnedTo })), screenshotCount: audit.screenshots.length, blockedExternalRequests: audit.blockedExternalRequests.length, unexpectedWrites: audit.unexpectedWrites.length }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
