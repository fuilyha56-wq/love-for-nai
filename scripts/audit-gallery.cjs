/* Local-only browser audit for the gallery search and import tutorial. */
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

const output = path.resolve('public/tutorials/gallery');
fs.mkdirSync(output, { recursive: true });
const catalog = loadTutorialCatalog();
const tutorial = catalog.featureTutorials.find(item => item.id === 'gallery');
assert(tutorial, 'Gallery tutorial exists in the current catalog');
assert.equal(tutorial.steps.length, 4, 'Gallery tutorial has four catalog steps');
assert(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Audit only permits localhost');
assert(process.env.LFN_UI_TEST_SESSION_SECRET, 'Fixture-only session secret must be configured');

const fixtureId = 'gallery-tutorial-local-fixture';
const promptText = '1girl, blue hair, seaside, sunset, detailed illustration';
const fixture = {
  id: fixtureId, title: '海边的蓝色旅程', ownerName: '本地示例作者', authorName: '本地示例作者', rating: 'general', source: 'local',
  tags: ['蓝天', '海洋', '夕阳'], prompt: promptText, negativePrompt: 'lowres, blurry',
  parameters: { prompt: promptText, negative_prompt: 'lowres, blurry', model: 'nai-v5-full', width: 832, height: 1216, steps: 28, scale: 5, seed: 123456789, sampler: 'k_euler_ancestral' },
  imageUrl: `/api/gallery/${fixtureId}/image`, thumbnailUrl: `/api/gallery/${fixtureId}/image?variant=thumbnail`, likes: 7, downloads: 12, uses: 3,
};
const targetSelectors = [
  ['.workspace-page input[type="search"]'],
  ['.workspace-page [role="combobox"]'],
  ['.workspace-page article button:has(svg.lucide-rotate-ccw)', '.workspace-page article button[aria-label^="作品操作："]'],
  ['[data-tutorial="prompt"] textarea', '[data-layout-module="prompt"] textarea', '.mobile-studio-prompt-content textarea'],
];
const audit = { tutorial: 'gallery', catalogStepCount: tutorial.steps.length, fixtureId, devices: [], screenshots: [], fixtureImageLoads: [], blockedExternalRequests: [], fixtureWrites: [], unexpectedWrites: [] };

function matchesGallery(url) {
  const q = (url.searchParams.get('q') || '').trim().toLocaleLowerCase();
  const tags = [...url.searchParams.getAll('tag'), ...(url.searchParams.get('tags') || '').split(',')].map(tag => tag.trim()).filter(Boolean);
  return (!q || `${fixture.title} ${fixture.authorName} ${fixture.tags.join(' ')}`.toLocaleLowerCase().includes(q)) && tags.every(tag => fixture.tags.includes(tag));
}

async function installFixtures(context, imagePng) {
  const origin = new URL(baseURL).origin;
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) {
      audit.blockedExternalRequests.push({ origin: url.origin, path: url.pathname });
      return route.abort('blockedbyclient');
    }
    if (request.method() !== 'GET' && request.method() !== 'HEAD') {
      if (request.method() === 'POST' && url.pathname === `/api/gallery/${fixtureId}/use`) {
        audit.fixtureWrites.push({ method: request.method(), path: url.pathname, response: 'local fixture only' });
        return route.fulfill({ json: { success: true, uses: fixture.uses + 1 } });
      }
      const record = { method: request.method(), path: url.pathname };
      audit.unexpectedWrites.push(record);
      return route.fulfill({ status: 409, json: { message: 'Gallery tutorial audit blocks every non-fixture write.' } });
    }
    if (url.pathname === '/api/gallery') {
      const items = matchesGallery(url) ? [fixture] : [];
      return route.fulfill({ json: { items, tags: fixture.tags, total: items.length, page: 1, pageCount: 1 } });
    }
    if (url.pathname === `/api/gallery/${fixtureId}`) return route.fulfill({ json: { item: fixture } });
    if (url.pathname === `/api/gallery/${fixtureId}/image`) {
      audit.fixtureImageLoads.push({ method: request.method(), path: url.pathname });
      return route.fulfill({ contentType: 'image/png', body: imagePng });
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
  const card = page.locator('[data-tutorial-id="gallery"]');
  await card.waitFor({ state: 'visible' });
  await card.getByRole('button', { name: /广场搜索与作品导入：手把手教程/ }).click();
  await page.waitForURL(/\/gallery(?:\?|$)/);
  await page.locator('.feature-tutorial-panel h2').getByText(tutorial.steps[0].title, { exact: true }).waitFor();
  await page.locator('a[aria-label="查看作品详情：海边的蓝色旅程"]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => [...document.querySelectorAll('img[alt="海边的蓝色旅程"]')].some(image => image.complete && image.naturalWidth > 0));
}

async function verifyStep(page, index, device) {
  const selectors = targetSelectors[index];
  await page.waitForFunction(expected => {
    const targets = [...document.querySelectorAll('[data-feature-tutorial-target="true"]')];
    if (targets.length !== 1 || !expected.some(selector => targets[0].matches(selector))) return false;
    const rect = targets[0].getBoundingClientRect();
    const spotlight = document.querySelector('.feature-tutorial-spotlight')?.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && rect.left < innerWidth && rect.right > 0 && rect.top < innerHeight && rect.bottom > 0 && spotlight?.width > 0 && spotlight?.height > 0;
  }, selectors, { timeout: 20000 }).catch(async error => {
    const diagnostic = { step: index + 1, selectors, marked: await page.locator('[data-feature-tutorial-target="true"]').evaluateAll(nodes => nodes.map(node => ({ html: node.outerHTML.slice(0, 500), rect: node.getBoundingClientRect().toJSON() }))), panel: await page.locator('.feature-tutorial-panel').innerText().catch(() => 'missing'), inputs: await page.locator('input').evaluateAll(nodes => nodes.map(node => ({ aria: node.getAttribute('aria-label'), placeholder: node.placeholder, rect: node.getBoundingClientRect().toJSON() }))) };
    throw new Error(`${error.message}\n${JSON.stringify(diagnostic)}`);
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
  return state;
}

async function next(page, title) {
  await page.locator('.feature-tutorial-panel footer').getByRole('button', { name: /下一步/ }).click();
  await page.locator('.feature-tutorial-panel h2').getByText(title, { exact: true }).waitFor();
}

async function returnToCenter(page, complete) {
  await page.locator('.feature-tutorial-panel').getByRole('button', { name: complete ? '完成教程，返回教程中心' : '退出教程，返回个人资料的教程中心', exact: true }).click();
  await page.waitForURL('**/profile#profile-tutorials');
  await page.locator('#tutorial-center-content').waitFor();
  await page.waitForFunction(() => !sessionStorage.getItem('lfn-feature-tutorial-session-v1'));
}

async function verifyTutorialArticle(page) {
  await page.getByRole('button', { name: '广场搜索与作品导入：图文教程', exact: true }).click();
  const article = page.locator('article.tutorial-article');
  await article.waitFor({ state: 'visible' });
  const images = article.locator('img[data-tutorial-shot]');
  assert.equal(await images.count(), 4, 'Gallery article has one actual screenshot per catalog step');
  const loaded = [];
  for (let index = 0; index < await images.count(); index += 1) {
    const image = images.nth(index);
    await image.scrollIntoViewIfNeeded();
    loaded.push(await image.evaluate(async element => {
      await element.decode();
      return { src: new URL(element.currentSrc || element.src).pathname, width: element.naturalWidth, height: element.naturalHeight, loaded: element.complete };
    }));
  }
  assert(loaded.every(image => image.width === 1440 && image.height === 1000 && image.loaded), `Gallery article screenshots decode at their recorded dimensions: ${JSON.stringify(loaded)}`);
  return loaded;
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
      if (index === 1) {
        const tagInput = page.getByRole('combobox', { name: '按标签筛选作品', exact: true });
        await tagInput.fill('蓝');
        await page.getByRole('option', { name: '蓝天', exact: true }).click();
        await page.locator('a[aria-label="查看作品详情：海边的蓝色旅程"]').waitFor({ state: 'visible' });
      }
      if (index === 3) {
        // Step 4 is on /image; import is performed while the preceding gallery step is still active.
      }
      const evidence = await verifyStep(page, index, device.name);
      if (index === 2) assert(device.width < 1024 ? evidence.text.startsWith(`作品操作：${fixture.title}`) : evidence.text === '导入图片到工作台', `${device.name}: step highlights its actual import entry (${evidence.text})`);
      await saveScreenshot(page, device.name, index);
      result.steps.push({ number: index + 1, title: tutorial.steps[index].title, target: evidence });
      if (index === 0) {
        const search = page.getByRole('searchbox', { name: '搜索图片广场', exact: true });
        await search.fill('海边');
        await page.waitForFunction(() => new URL(location.href).searchParams.get('q') === '海边');
        await page.locator('a[aria-label="查看作品详情：海边的蓝色旅程"]').waitFor({ state: 'visible' });
        await next(page, tutorial.steps[1].title);
      } else if (index === 1) {
        assert.equal(await page.locator('[aria-label="已选筛选条件"]').getByText('#蓝天', { exact: true }).count(), 1, `${device.name}: tag suggestion applied`);
        await next(page, tutorial.steps[2].title);
      } else if (index === 2) {
        if (device.width < 1024) {
          await page.getByRole('button', { name: `作品操作：${fixture.title}`, exact: true }).click();
          await page.getByRole('menu').getByRole('button', { name: /导入到画布/ }).click();
        } else {
          await page.getByRole('button', { name: '导入图片到工作台', exact: true }).click();
        }
        const dialog = page.getByRole('dialog', { name: '导入到画布', exact: true });
        await dialog.waitFor();
        await dialog.getByRole('link', { name: /图生图/ }).click();
        await page.waitForURL(new RegExp(`/image\\?.*galleryId=${fixtureId}.*importMode=img2img`));
        await page.waitForFunction(value => [...document.querySelectorAll('textarea')].some(element => element.value.includes(value)), promptText, { timeout: 30000 });
        await page.waitForFunction(() => document.querySelector('[data-tutorial-source-ready="true"]') || document.querySelector('.mobile-studio-reference-panel img, [data-tutorial="source"] img'));
        assert(audit.fixtureImageLoads.some(load => load.path === `/api/gallery/${fixtureId}/image`), `${device.name}: actual gallery image bytes were loaded from the local route fixture`);
        await next(page, tutorial.steps[3].title);
      } else {
        const prompt = page.locator('[data-tutorial="prompt"] textarea:visible, [data-layout-module="prompt"] textarea:visible, .mobile-studio-prompt-content textarea:visible').first();
        assert((await prompt.inputValue()).includes(promptText), `${device.name}: imported fixture prompt appears in the real prompt control`);
      }
    }
    assert.deepEqual(audit.unexpectedWrites, [], 'No non-fixture write was attempted');
    assert.deepEqual(audit.blockedExternalRequests, [], 'No external request was attempted');
    assert.equal(runtimeErrors.length, 0, `No UI runtime errors: ${runtimeErrors.join('\n')}`);
    await returnToCenter(page, device.complete);
    result.passed = true;
    result.returnedTo = `${new URL(page.url()).pathname}${new URL(page.url()).hash}`;
    result.articleImages = await verifyTutorialArticle(page);
    result.runtimeErrors = runtimeErrors;
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

(async () => {
  const imagePng = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="720" height="900" viewBox="0 0 720 900"><defs><linearGradient id="sea" x2="0" y2="1"><stop stop-color="#f8cba5"/><stop offset=".45" stop-color="#e6a890"/><stop offset=".46" stop-color="#558ba5"/><stop offset="1" stop-color="#1e566d"/></linearGradient></defs><rect width="720" height="900" fill="url(#sea)"/><circle cx="520" cy="260" r="72" fill="#fff0bc"/><path d="M0 600Q180 540 340 625T720 580V900H0Z" fill="#255c70"/><path d="M0 710Q170 650 350 730T720 685" fill="none" stroke="#9cc4c4" stroke-width="12"/><path d="M130 0V900M590 0V900" stroke="#fff" stroke-opacity=".08" stroke-width="3"/></svg>')).png().toBuffer();
  const browser = await chromium.launch({ headless: true, channel: process.env.LFN_UI_BROWSER_CHANNEL || 'msedge' });
  try {
    await runDevice(browser, { name: 'desktop', width: 1440, height: 1000, complete: true }, imagePng);
    await runDevice(browser, { name: 'mobile', width: 390, height: 844, complete: false }, imagePng);
  } finally {
    await browser.close();
    audit.screenshots.sort((a, b) => a.file.localeCompare(b.file));
    fs.writeFileSync(path.join(output, 'audit.json'), JSON.stringify(audit, null, 2));
  }
  assert(audit.devices.every(device => device.passed), 'Desktop and mobile gallery tutorial audits pass');
  assert.equal(audit.screenshots.length, tutorial.steps.length * 2, 'Every catalog step has desktop and mobile screenshots');
  console.log(JSON.stringify({ devices: audit.devices.map(({ device, passed, returnedTo }) => ({ device, passed, returnedTo })), screenshotCount: audit.screenshots.length, fixtureImageLoads: audit.fixtureImageLoads.length, fixtureWrites: audit.fixtureWrites.length, blockedExternalRequests: audit.blockedExternalRequests.length, unexpectedWrites: audit.unexpectedWrites.length }, null, 2));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
