/* Local UI audit for the tag-library tutorial. All browser and API traffic is local. */
/* eslint-disable @typescript-eslint/no-require-imports -- standalone local audit runner */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
process.env.LFN_UI_BASE_URL ||= 'http://localhost:3010';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
process.env.LFN_UI_TEST_SESSION_SECRET ||= process.env.LFN_SESSION_SECRET || 'lfn-tag-library-local-audit-only-20261027';
const { chromium, baseURL, setup } = require('./check-mobile-ui.cjs');
assert(['localhost', '127.0.0.1'].includes(new URL(baseURL).hostname), 'Use the shared localhost dev server');
const output = path.resolve('public/tutorials/tag-library');
fs.mkdirSync(output, { recursive: true });
const catalog = require('./tutorial-test-support.cjs').loadTutorialCatalog();
const tutorial = catalog.featureTutorials.find(item => item.id === 'tag-library');
assert(tutorial, 'tag-library must exist in the tutorial catalog');
const catalogScreenshots = tutorial.steps.filter(step => step.screenshot?.src.startsWith('/tutorials/tag-library/step-')).length;
assert.equal(catalogScreenshots, tutorial.steps.length, 'Each catalog step must reference exactly one desktop screenshot');
const audit = {
  baseURL, tutorialId: tutorial.id, catalogStepCount: tutorial.steps.length,
  catalogScreenshotCount: catalogScreenshots, viewportScreenshotCount: 0,
  fixture: 'read-only-local-tag-catalog plus local API fixtures from check-mobile-ui.cjs', externalRequestsBlocked: true,
  nonFixtureWritesBlocked: true, scenarios: [], requests: [], blockedExternal: [], browserErrors: [],
};

async function installNetworkGuards(context) {
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(baseURL).origin) {
      audit.blockedExternal.push({ method: request.method(), origin: url.origin, path: url.pathname });
      return route.abort('blockedbyclient');
    }
    if (url.pathname === '/api/tags' && request.method() === 'GET') return route.continue();
    if (request.method() !== 'GET') {
      audit.requests.push({ method: request.method(), path: url.pathname, outcome: 'blocked' });
      return route.fulfill({ status: 409, json: { message: 'Tag-library audit blocks every non-GET request.' } });
    }
    return route.fallback();
  });
}

async function startTutorial(page) {
  await page.goto(`${baseURL}/profile#profile-tutorials`);
  await page.locator('[data-tutorial-id="tag-library"]').waitFor({ state: 'visible' });
  await page.locator('[data-tutorial-id="tag-library"]').getByRole('button', { name: '标签词库与检索：手把手教程', exact: true }).click();
  await page.waitForURL('**/tags');
  await page.locator('.feature-tutorial-panel h2').getByText(tutorial.steps[0].title, { exact: true }).waitFor();
}

async function verifySpotlight(page, index) {
  await page.waitForFunction(() => Boolean(document.querySelector('.feature-tutorial-spotlight')));
  const target = page.locator('[data-feature-tutorial-target="true"]');
  assert.equal(await target.count(), 1, `Step ${index + 1}: exactly one real element must be highlighted`);
  assert(await target.isVisible(), `Step ${index + 1}: highlighted element must be visible`);
  const box = await target.boundingBox();
  assert(box && box.width > 0 && box.height > 0, `Step ${index + 1}: target must have usable visible bounds`);
  assert(await target.evaluate(el => getComputedStyle(el).outlineStyle === 'solid'), `Step ${index + 1}: actual target must show the tutorial outline`);
  const spotlight = await page.locator('.feature-tutorial-spotlight').evaluate(el => ({
    top: parseFloat(el.style.top), left: parseFloat(el.style.left), width: parseFloat(el.style.width), height: parseFloat(el.style.height),
  }));
  assert(spotlight.width > 0 && spotlight.height > 0, `Step ${index + 1}: spotlight must have visible bounds`);
  assert(spotlight.left <= box.x + box.width && spotlight.left + spotlight.width >= box.x && spotlight.top <= box.y + box.height && spotlight.top + spotlight.height >= box.y,
    `Step ${index + 1}: spotlight must overlap the actual control or information`);
  const emphasized = await page.locator('.feature-tutorial-body .tutorial-keyword').allTextContents();
  assert(emphasized.length > 0, `Step ${index + 1}: key terms must be emphasized in the instructions`);
  const panel = await page.locator('.feature-tutorial-panel').boundingBox();
  const panelOccludesTarget = Boolean(panel && !(box.x + box.width <= panel.x || box.x >= panel.x + panel.width || box.y + box.height <= panel.y || box.y >= panel.y + panel.height));
  assert(!panelOccludesTarget, `Step ${index + 1}: the guide panel must not cover its highlighted target`);
  return {
    step: index + 1, title: tutorial.steps[index].title,
    target: await target.evaluate(el => ({ tag: el.tagName.toLowerCase(), role: el.getAttribute('role'), label: el.getAttribute('aria-label'), text: (el.innerText || el.value || '').trim().slice(0, 180), className: typeof el.className === 'string' ? el.className : '' })),
    bounds: box, spotlight, panelOccludesTarget, emphasized,
  };
}

async function screenshot(page, viewport, index) {
  await page.evaluate(() => document.fonts.ready);
  const prefix = viewport === 'mobile' ? 'mobile-' : '';
  const filename = `${prefix}step-${String(index + 1).padStart(2, '0')}.png`;
  const file = path.join(output, filename);
  await page.screenshot({ path: file, animations: 'disabled' });
  const meta = await sharp(file).metadata();
  assert(meta.width >= (viewport === 'mobile' ? 360 : 1200) && meta.height >= 700, `${filename} must be a full real UI capture`);
  const response = await page.request.get(`${baseURL}/tutorials/tag-library/${filename}`);
  assert.equal(response.status(), 200, `${filename} must be served by the local app`);
  assert.equal(response.headers()['content-type']?.split(';')[0], 'image/png');
  audit.viewportScreenshotCount += 1;
  return { src: `/tutorials/tag-library/${filename}`, width: meta.width, height: meta.height };
}

async function advance(page, nextTitle) {
  await page.locator('.feature-tutorial-panel footer').getByRole('button', { name: /下一步/ }).click();
  await page.locator('.feature-tutorial-panel h2').getByText(nextTitle, { exact: true }).waitFor();
  await page.waitForTimeout(500);
}

async function runViewport(browser, viewport, size) {
  const { context, page } = await setup(browser, { theme: 'paper', workspaceLayout: 'lfn' }, size);
  await installNetworkGuards(context);
  page.setDefaultTimeout(18000);
  page.setDefaultNavigationTimeout(90000);
  const result = { viewport, steps: [], requests: [], completionReturnedToCenter: false, exitReturnedToCenter: false };
  page.on('pageerror', error => audit.browserErrors.push(`${viewport}: ${error.stack || error.message}`));
  page.on('request', request => {
    const url = new URL(request.url());
    const row = { method: request.method(), path: url.pathname, ...(url.pathname === '/api/tags' && url.searchParams.has('q') ? { query: url.searchParams.get('q') } : {}) };
    audit.requests.push(row);
    result.requests.push(row);
  });
  try {
    await startTutorial(page);
    for (let index = 0; index < tutorial.steps.length; index += 1) {
      let promptForInsertion = null;
      if (index === 3) {
        promptForInsertion = page.locator('[data-tutorial="prompt"] textarea:visible, .replica-prompt textarea:visible, .mobile-studio-workspace-dialog textarea:visible').first();
        await promptForInsertion.waitFor({ state: 'visible' });
        await promptForInsertion.fill('white_hair');
        const suggestions = page.getByRole('listbox', { name: '标签联想', exact: true });
        await suggestions.waitFor({ state: 'visible', timeout: 15000 });
        await suggestions.getByRole('option').filter({ hasText: 'Danbooru' }).first().waitFor({ state: 'visible', timeout: 15000 });
        await page.waitForFunction(() => Boolean(document.querySelector('.feature-tutorial-spotlight')));
      }
      const state = await verifySpotlight(page, index);
      if (index === 0) {
        const search = page.getByRole('textbox', { name: '搜索标签数据库', exact: true });
        assert(await search.isVisible());
        await search.fill('white_hair');
      }
      if (index === 1) {
        const detail = page.locator('.workspace-page article');
        await detail.waitFor({ state: 'visible' });
        const text = await detail.innerText();
        assert(/white hair|white_hair/i.test(text), 'The actual local catalog detail must match the searched tag');
        assert(/完整介绍|来源未提供|完整提示词/.test(text), 'The actual record should display its available explanation or source details');
        result.tagRecord = { heading: await detail.locator('h1,h2').first().innerText(), visibleText: text.slice(0, 650) };
      }
      if (index === 2) {
        if (viewport === 'mobile') {
          const copy = page.getByRole('button', { name: '复制标签', exact: true });
          assert(await copy.isVisible(), 'Mobile detail page should expose its real copy control');
          result.mobileCopyControl = true;
        } else {
          assert((await page.locator('.workspace-page article header').innerText()).length > 0, 'Desktop should show the selected tag text for manual copy');
          result.desktopTagText = 'visible for manual selection';
        }
      }
      if (index === 3) {
        const suggestions = page.getByRole('listbox', { name: '标签联想', exact: true });
        const options = await suggestions.getByRole('option').allInnerTexts();
        assert(options.some(text => /white hair|white_hair/i.test(text)), `Local completion must show the searched tag: ${JSON.stringify(options)}`);
        result.promptSuggestions = options.map(text => text.trim());
      }
      const shot = await screenshot(page, viewport, index);
      result.steps.push({ ...state, screenshot: shot });
      if (index === 3) {
        await promptForInsertion.press('Enter');
        assert(/white_hair/.test(await promptForInsertion.inputValue()), 'Selecting a real suggestion must insert the tag into the prompt');
        result.promptInsertionVerified = true;
      }

      if (index === 0) {
        await page.locator('.workspace-page form button[type="submit"], .workspace-page form button').click();
        await page.waitForURL(/\/tags\?q=white_hair/);
        const resultLink = page.locator('a[href^="/tags?key="]').first();
        await resultLink.waitFor({ state: 'visible' });
        await resultLink.click();
        await page.waitForURL(/\/tags\?key=/);
      }
      if (index === 2 && viewport === 'mobile') {
        await page.getByRole('button', { name: '复制标签', exact: true }).click();
        await page.getByRole('status').getByText('已复制标签', { exact: true }).waitFor();
        result.mobileCopyActionVerified = true;
      }
      if (index < tutorial.steps.length - 1) await advance(page, tutorial.steps[index + 1].title);
    }

    const writes = result.requests.filter(request => request.method !== 'GET');
    assert.equal(writes.length, 0, 'The read-only tutorial must not make any non-GET request');
    await page.locator('.feature-tutorial-panel').getByRole('button', { name: '完成教程，返回教程中心', exact: true }).click();
    await page.waitForURL('**/profile#profile-tutorials');
    await page.locator('#tutorial-center-content').waitFor();
    result.completionReturnedToCenter = true;

    await startTutorial(page);
    await page.locator('.feature-tutorial-panel').getByRole('button', { name: '退出教程，返回个人资料的教程中心', exact: true }).click();
    await page.waitForURL('**/profile#profile-tutorials');
    await page.locator('#tutorial-center-content').waitFor();
    result.exitReturnedToCenter = true;
    audit.scenarios.push(result);
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    await runViewport(browser, 'desktop', { width: 1440, height: 1000 });
    await runViewport(browser, 'mobile', { width: 390, height: 844 });

    const { context, page } = await setup(browser, { theme: 'paper', workspaceLayout: 'lfn' }, { width: 1440, height: 1000 });
    await installNetworkGuards(context);
    try {
      await page.goto(`${baseURL}/profile#profile-tutorials`);
      await page.locator('[data-tutorial-id="tag-library"]').getByRole('button', { name: '标签词库与检索：图文教程', exact: true }).click();
      await page.locator('#tutorial-article-title').getByText(tutorial.title, { exact: true }).waitFor();
      const images = page.locator('.tutorial-article [data-tutorial-shot]');
      assert.equal(await images.count(), tutorial.steps.length, 'Article screenshot count must match catalog step count');
      for (let index = 0; index < tutorial.steps.length; index += 1) {
        const image = images.nth(index);
        await image.scrollIntoViewIfNeeded();
        await page.waitForFunction(element => element.complete && element.naturalWidth >= 1200 && element.naturalHeight >= 800, await image.elementHandle(), { timeout: 20000 });
      }
      audit.articleImages = await images.evaluateAll(list => list.map(image => ({ src: image.getAttribute('src'), width: image.naturalWidth, height: image.naturalHeight, alt: image.alt })));
      assert.equal(audit.articleImages.length, tutorial.steps.length);
      assert(audit.articleImages.every(image => image.width >= 1200 && image.height >= 800), 'Every article screenshot must be a successfully loaded local capture');
      audit.articleLoadedAllScreenshots = true;
    } finally {
      await context.close();
      await browser.close();
    }
    audit.catalogScreenshotCount = tutorial.steps.filter(step => step.screenshot?.src.startsWith('/tutorials/tag-library/step-')).length;
    audit.expectedViewportScreenshotCount = tutorial.steps.length * 2;
    audit.localCatalogReadRequests = audit.requests.filter(request => request.method === 'GET' && request.path === '/api/tags').length;
    audit.fixtureRequests = audit.requests.filter(request => request.method === 'GET' && request.path.startsWith('/api/') && request.path !== '/api/tags');
    audit.fixtureRequestCount = audit.fixtureRequests.length;
    audit.screenshotFiles = fs.readdirSync(output).filter(name => /^mobile-step-\d+\.png$|^step-\d+\.png$/.test(name)).sort();
    assert.equal(audit.catalogScreenshotCount, tutorial.steps.length);
    assert.equal(audit.viewportScreenshotCount, audit.expectedViewportScreenshotCount);
    assert.equal(audit.screenshotFiles.length, audit.expectedViewportScreenshotCount);
    assert.equal(audit.blockedExternal.length, 0, 'No browser request may leave localhost');
    assert.equal(audit.requests.filter(request => request.method !== 'GET').length, 0, 'No write request may be attempted');
    assert.equal(audit.browserErrors.length, 0, audit.browserErrors.join('\n'));
    fs.writeFileSync(path.join(output, 'audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
    console.log(JSON.stringify({ catalogSteps: tutorial.steps.length, desktopAndMobileScreenshots: audit.viewportScreenshotCount, articleImagesLoaded: audit.articleImages.length, completionAndExitReturned: audit.scenarios.every(item => item.completionReturnedToCenter && item.exitReturnedToCenter), fixtureRequests: audit.fixtureRequestCount, localCatalogReadRequests: audit.localCatalogReadRequests, nonGetRequests: audit.requests.filter(request => request.method !== 'GET').length, blockedExternalRequests: audit.blockedExternal.length }));
  } catch (error) {
    audit.failure = error.stack || error.message;
    audit.screenshotFiles = fs.readdirSync(output).filter(name => /^mobile-step-\d+\.png$|^step-\d+\.png$/.test(name)).sort();
    fs.writeFileSync(path.join(output, 'audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
    throw error;
  }
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
