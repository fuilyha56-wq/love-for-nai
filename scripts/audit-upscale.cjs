/* Local-only UI audit. The shared setup helper provides the fake session and
 * image-operation fixture; this runner additionally blocks every non-local URL. */
/* eslint-disable @typescript-eslint/no-require-imports -- standalone audit runner */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium, baseURL, setup } = require('./check-mobile-ui.cjs');

assert(['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname), 'Use localhost only');
assert(process.env.LFN_UI_TEST_SESSION_SECRET, 'Set the fixture-only LFN_UI_TEST_SESSION_SECRET');

const publicDir = path.resolve('public/tutorials/upscale');
const tempDir = path.resolve('.tmp/audit-upscale');
const failureDir = path.join(tempDir, 'failures');
const fixturePNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=', 'base64');
const stepTargets = [
  ['.studio-model-controls .popup-select-trigger[aria-label="模型"]', '.replica-model-controls [aria-label="模型"]', '.mobile-studio-workspace-dialog [aria-label="模型"]'],
  ['[data-tutorial="source"]', '.mobile-studio-reference-panel'],
  ['[aria-label="超分模型"]'],
  ['button[data-studio-generate]'],
  ['.workspace-result-download summary', '.replica-media .replica-download-menu summary', '.mobile-studio-preview-section .image-download-menu summary'],
];

async function blockExternalRequests(context, audit) {
  const allowedOrigin = new URL(baseURL).origin;
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.origin !== allowedOrigin) {
      audit.blockedExternal.push(url.href);
      return route.abort('blockedbyclient');
    }
    return route.fallback();
  });
}

async function findTarget(page, selectors) {
  return page.evaluate((allowed) => {
    const marked = [...document.querySelectorAll('[data-feature-tutorial-target="true"]')];
    if (marked.length !== 1) return { error: `expected one highlighted target, found ${marked.length}` };
    const element = marked[0];
    const rect = element.getBoundingClientRect();
    return {
      matches: allowed.some(selector => element.matches(selector)),
      tag: element.tagName.toLowerCase(),
      text: (element.innerText || element.getAttribute('aria-label') || '').trim().slice(0, 180),
      bounds: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      visible: rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.left < innerWidth,
      emphasizedTerms: document.querySelectorAll('.feature-tutorial-body mark.tutorial-keyword').length,
    };
  }, selectors);
}

async function openGuide(page) {
  await page.goto(`${baseURL}/profile#profile-tutorials`);
  const card = page.locator('[data-tutorial-id="upscale"]');
  await card.waitFor({ state: 'visible' });
  await card.getByRole('button', { name: '普通超分与 V5 超分：手把手教程', exact: true }).click();
  await page.locator('[data-testid="feature-tutorial"]').waitFor({ state: 'visible' });
  await page.waitForURL(/\/image(?:\?|$)/);
}

async function screenshot(page, filepath) {
  await page.waitForTimeout(250);
  fs.mkdirSync(path.dirname(filepath), { recursive: true });
  await page.screenshot({ path: filepath, animations: 'disabled' });
}

async function moveNext(page, index) {
  await page.locator('.feature-tutorial-panel footer button').last().click();
  await page.getByRole('progressbar', { name: '教程进度' }).waitFor();
  await page.waitForFunction(expected => document.querySelector('.feature-tutorial-panel header')?.innerText.includes(expected), `${index + 2}/${stepTargets.length}`);
}

async function runGuide(browser, viewport, keepPublicShots, shared) {
  const { context, page, requests } = await setup(browser, {}, viewport);
  await blockExternalRequests(context, shared);
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const result = { viewport, steps: [], requests, errors };
  const fixture = { name: 'upscale-local-fixture.png', mimeType: 'image/png', buffer: fixturePNG };

  try {
    await openGuide(page);
    if (viewport.width >= 1024) await page.waitForFunction(() => document.querySelector('[aria-label="模型"]')?.textContent?.includes('nai-v5-full'), undefined, { timeout: 15000 });
    for (let index = 0; index < stepTargets.length; index++) {
      if (index === 0 && viewport.width < 1024) await page.getByRole('button', { name: '打开生成参数', exact: true }).click();

      if (index === 0) {
        if (viewport.width < 1024) await page.waitForFunction(() => document.querySelector('.mobile-studio-workspace-dialog [aria-label="模型"]')?.textContent?.includes('nai-v5-full'), undefined, { timeout: 15000 });
        const model = page.locator('.studio-model-controls .popup-select-trigger[aria-label="模型"]:visible, .mobile-studio-workspace-dialog [aria-label="模型"]:visible').first();
        if (await model.count()) {
          await model.click();
          const v5 = page.getByRole('option', { name: 'nai-v5-full', exact: true }).first();
          await v5.waitFor({ state: 'visible', timeout: 8000 }).catch(async () => {
            const options = await page.getByRole('option').allInnerTexts();
            const diagnostic = await page.evaluate(async () => {
              const path = (p) => fetch(p).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }));
              const api = await Promise.all(['/api/models', '/api/public/image-policy', '/api/providers/novelai', '/api/me'].map(async p => [p, await path(p)]));
              const host = document.querySelector('.studio-model-controls') || document.querySelector('.mobile-studio-workspace-dialog');
              let fiber = host && host[Object.keys(host).find(key => key.startsWith('__reactFiber$'))];
              const components = [];
              while (fiber && components.length < 30) {
                const name = fiber.type?.name || fiber.elementType?.name;
                if (name) {
                  let hook = fiber.memoizedState;
                  const hooks = [];
                  for (let i = 0; hook && i < 100; i++, hook = hook.next) {
                    const value = hook.memoizedState;
                    let short;
                    try { short = JSON.stringify(value); } catch { short = '[complex]'; }
                    hooks.push(short?.slice(0, 140) || String(value));
                  }
                  components.push({ name, hooks });
                }
                fiber = fiber.return;
              }
              return { api, pageText: document.body.innerText.slice(0, 900), components };
            });
            throw new Error(`V5 option unavailable; visible selector options: ${options.join(', ')}; diagnostic: ${JSON.stringify(diagnostic)}`);
          });
          if (await v5.count()) await v5.click();
          else await page.keyboard.press('Escape');
        }
        await page.locator('.studio-mode-picker .studio-mode-badge:visible, .mobile-studio-mode-selector:visible').first().click();
        if (viewport.width < 1024) await page.getByRole('option', { name: '放大', exact: true }).click();
        else await page.getByRole('button', { name: /图生图/ }).last().click();
        await page.waitForFunction(expected => [...document.querySelectorAll('.studio-mode-picker .studio-mode-badge, .mobile-studio-mode-selector')].some(element => element.getAttribute('data-current-operation') === expected), viewport.width < 1024 ? 'upscale' : 'img2img');
        if (viewport.width < 1024) {
          const parameters = page.getByRole('button', { name: '打开生成参数', exact: true });
          await parameters.focus();
          await parameters.press('Enter');
        }
      }
      if (index === 1) {
        await page.locator('[data-tutorial="source"] input[type="file"], .mobile-studio-reference-panel input[type="file"]').first().setInputFiles(fixture);
        await page.getByText('upscale-local-fixture.png', { exact: true }).first().waitFor({ state: 'visible' });
      }
      if (index === 2) {
        await page.locator('.feature-tutorial-panel header button[aria-label="收起说明，继续操作"]').click();
        if (viewport.width < 1024) {
          await page.locator('.mobile-studio-bottom-nav').getByRole('button', { name: '历史', exact: true }).click();
        } else {
          const historyRail = page.getByRole('button', { name: '展开历史记录', exact: true });
          if (await historyRail.isVisible()) await historyRail.click();
          else await page.getByRole('tab', { name: '历史', exact: true }).click();
        }
        const historyItem = page.locator('.replica-history-card:visible').first();
        await historyItem.waitFor({ state: 'visible', timeout: 15000 });
        assert(requests.some(request => request.path === '/api/history' && request.method === 'GET'), 'history entry must load from the local fixture');
        await historyItem.hover();
        await historyItem.getByRole('button', { name: '第 1 张历史图像更多操作', exact: true }).click();
        await page.getByRole('menuitem', { name: '用于超分', exact: true }).click();
        if (viewport.width < 1024) {
          const parameters = page.getByRole('button', { name: '打开生成参数', exact: true });
          await parameters.focus();
          await parameters.press('Enter');
        }
        await page.getByRole('button', { name: '展开教程说明', exact: true }).click();
        const upscaleModel = page.getByLabel('超分模型', { exact: true });
        await upscaleModel.waitFor({ state: 'visible', timeout: 10000 });
        await upscaleModel.click();
        await page.getByRole('option', { name: 'V5 Full', exact: true }).click();
        assert((await page.locator('body').innerText()).includes('2 倍'), 'V5 path must show fixed 2x output');
      }
      if (index === 4) {
        await page.locator('.feature-tutorial-panel header button[aria-label="收起说明，继续操作"]').click();
        const download = page.locator('.workspace-result-download summary, .replica-media .replica-download-menu summary, .mobile-studio-preview-section .image-download-menu summary').first();
        await download.focus();
        await download.press('Enter');
        await page.getByRole('button', { name: '展开教程说明', exact: true }).click();
      }

      const target = await page.waitForFunction((allowed) => {
        const marked = [...document.querySelectorAll('[data-feature-tutorial-target="true"]')];
        if (marked.length !== 1) return false;
        const element = marked[0], rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && allowed.some(selector => element.matches(selector));
      }, stepTargets[index], { timeout: 10000 });
      assert(target, `step ${index + 1}: no expected target was highlighted`);
      const targetState = await findTarget(page, stepTargets[index]);
      assert.equal(targetState.matches, true, `step ${index + 1}: wrong DOM target ${JSON.stringify(targetState)}`);
      assert.equal(targetState.visible, true, `step ${index + 1}: target outside viewport ${JSON.stringify(targetState)}`);
      assert(targetState.emphasizedTerms > 0, `step ${index + 1}: no emphasized terms in tutorial body`);

      const filename = `step-${String(index + 1).padStart(2, '0')}.png`;
      const output = keepPublicShots ? path.join(tempDir, 'desktop', filename) : path.join(tempDir, 'mobile', filename);
      await screenshot(page, output);
      result.steps.push({ number: index + 1, target: targetState, screenshot: keepPublicShots ? `/tutorials/upscale/${filename}` : output });
      if (index === 0 && viewport.width < 1024) await page.keyboard.press('Escape');

      if (index === 3) {
        await page.locator('button[data-studio-generate]:visible').first().click();
        await page.locator('.workspace-result-download summary, .replica-media .replica-download-menu summary, .mobile-studio-preview-section .image-download-menu summary').first().waitFor({ state: 'visible', timeout: 15000 });
        assert(requests.some(request => request.path === '/api/images/operate' && request.method === 'POST'), 'generation should be handled by the local image fixture');
      }
      if (index < stepTargets.length - 1) await moveNext(page, index);
    }

    await page.locator('.feature-tutorial-panel footer button').last().click();
    await page.waitForURL(/\/profile#profile-tutorials/);
    await page.locator('.tutorial-center').waitFor({ state: 'visible' });
    await page.locator('[data-tutorial-id="upscale"]').waitFor({ state: 'visible' });
    const completion = await page.evaluate(() => JSON.parse(sessionStorage.getItem('lfn-feature-tutorial-result-v1') || 'null'));
    assert.deepEqual(completion, { tutorialId: 'upscale', completed: true }, 'completion must be recorded before returning to the center');
    result.returnedToTutorialCenter = true;
    assert.deepEqual(errors, [], `page errors: ${errors.join('\n')}`);
    return result;
  } catch (error) {
    fs.mkdirSync(failureDir, { recursive: true });
    try { result.diagnostic = await page.evaluate(() => ({ text: document.body.innerText.slice(-1200), marked: [...document.querySelectorAll('[data-feature-tutorial-target="true"]')].map(el => ({ tag: el.tagName, cls: el.className, label: el.getAttribute('aria-label'), text: (el.innerText || '').slice(0, 120), rect: (() => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })() })), modelControls: [...document.querySelectorAll('[aria-label="模型"]')].map(el => ({ tag: el.tagName, cls: el.className, text: (el.innerText || '').slice(0, 80), rect: (() => { const r = el.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })() })), images: [...document.querySelectorAll('img')].map(img => ({ src: img.src.slice(0, 100), width: img.naturalWidth, height: img.naturalHeight, rect: (() => { const r = img.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; })() })) })); } catch {}
    try { await page.screenshot({ path: path.join(failureDir, `${viewport.width}x${viewport.height}-failure.png`), fullPage: true }); } catch {}
    fs.writeFileSync(path.join(failureDir, `${viewport.width}x${viewport.height}-partial.json`), `${JSON.stringify(result, null, 2)}\n`);
    throw error;
  } finally { await context.close(); }
}

async function auditArticle(browser, shared) {
  const { context, page } = await setup(browser, {}, { width: 1440, height: 1000 });
  await blockExternalRequests(context, shared);
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  try {
    await page.goto(`${baseURL}/profile#profile-tutorials`);
    const card = page.locator('[data-tutorial-id="upscale"]');
    await card.getByRole('button', { name: '普通超分与 V5 超分：图文教程', exact: true }).click();
    const articleSteps = page.locator('.tutorial-article-step');
    assert.equal(await articleSteps.count(), stepTargets.length, 'article must show every overridden step');
    const screenshotImages = page.locator('img[data-tutorial-shot]');
    assert.equal(await screenshotImages.count(), stepTargets.length, 'every article step must have a screenshot');
    for (const image of await screenshotImages.all()) await image.evaluate(el => el.decode());
    const keywordCounts = await articleSteps.locator('mark.tutorial-keyword').evaluateAll(elements => elements.length);
    assert(keywordCounts >= stepTargets.length, 'article terminology should be visibly emphasized');
    assert.deepEqual(errors, [], `article page errors: ${errors.join('\n')}`);
    return { steps: await articleSteps.count(), screenshotsLoaded: await screenshotImages.count(), emphasizedTerms: keywordCounts };
  } catch (error) {
    fs.mkdirSync(failureDir, { recursive: true });
    try { await page.screenshot({ path: path.join(failureDir, 'article-failure.png'), fullPage: true }); } catch {}
    throw error;
  } finally { await context.close(); }
}

async function earlyExit(browser, shared) {
  const { context, page } = await setup(browser, {}, { width: 1440, height: 1000 });
  await blockExternalRequests(context, shared);
  try {
    await openGuide(page);
    await page.locator('.feature-tutorial-exit').click();
    await page.waitForURL(/\/profile#profile-tutorials/);
    await page.locator('.tutorial-center').waitFor({ state: 'visible' });
    await page.locator('[data-tutorial-id="upscale"]').waitFor({ state: 'visible' });
    const completion = await page.evaluate(() => JSON.parse(sessionStorage.getItem('lfn-feature-tutorial-result-v1') || 'null'));
    assert.deepEqual(completion, { tutorialId: 'upscale', completed: false }, 'early exit must be recorded before returning to the center');
    return { returnedToTutorialCenter: true };
  } catch (error) {
    fs.mkdirSync(failureDir, { recursive: true });
    try { await page.screenshot({ path: path.join(failureDir, 'early-exit-failure.png'), fullPage: true }); } catch {}
    throw error;
  } finally { await context.close(); }
}

(async () => {
  fs.mkdirSync(tempDir, { recursive: true });
  fs.mkdirSync(failureDir, { recursive: true });
  fs.mkdirSync(publicDir, { recursive: true });
  for (const filename of fs.readdirSync(publicDir)) {
    const filepath = path.join(publicDir, filename);
    if (fs.statSync(filepath).isFile()) fs.unlinkSync(filepath);
  }
  const shared = { blockedExternal: [] };
  const browserRoot = path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright');
  const headlessFolder = fs.readdirSync(browserRoot).find(name => /^chromium_headless_shell-\d+$/.test(name));
  const executablePath = process.env.LFN_CHROME_EXECUTABLE || path.join(browserRoot, headlessFolder || '', 'chrome-headless-shell-win64', 'chrome-headless-shell.exe');
  const browser = await chromium.launch({ headless: true, executablePath, args: ['--no-sandbox', '--disable-gpu'] });
  try {
    const desktop = await runGuide(browser, { width: 1440, height: 1000 }, true, shared);
    for (let index = 1; index <= stepTargets.length; index++) {
      const filename = `step-${String(index).padStart(2, '0')}.png`;
      fs.copyFileSync(path.join(tempDir, 'desktop', filename), path.join(publicDir, filename));
    }
    const mobile = await runGuide(browser, { width: 390, height: 844 }, false, shared);
    const article = await auditArticle(browser, shared);
    const exit = await earlyExit(browser, shared);
    const superResolutionFixtureCalls = [...desktop.requests, ...mobile.requests].filter(request => request.path === '/api/images/operate' && request.method === 'POST').length;
    assert(superResolutionFixtureCalls >= 2, 'desktop and mobile V5 super-resolution requests must use the local fixture');

    const screenshots = [];
    for (let index = 1; index <= stepTargets.length; index++) {
      const filename = `step-${String(index).padStart(2, '0')}.png`;
      screenshots.push(filename);
    }
    const audit = {
      auditedAt: new Date().toISOString(),
      baseURL,
      method: 'local Chromium, fixture-only fake session, real local UI screenshots',
      externalRequestsBlocked: true,
      blockedExternalRequestCount: shared.blockedExternal.length,
      apiWrites: 'Only /api/images/operate was allowed and fulfilled with a local 1×1 PNG fixture; other writes returned 409.',
      superResolutionFixtureCalls,
      article,
      completion: desktop.returnedToTutorialCenter && mobile.returnedToTutorialCenter,
      earlyExit: exit,
      desktop: { steps: desktop.steps },
      mobile: { steps: mobile.steps.map(({ number, target }) => ({ number, target })) },
      screenshots,
    };
    fs.writeFileSync(path.join(publicDir, 'audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
    console.log(`PASS: ${stepTargets.length} steps audited on desktop and mobile; screenshots loaded; complete and exit returned to profile tutorial center.`);
  } catch (error) {
    fs.writeFileSync(path.join(failureDir, 'failure.txt'), error.stack || error.message);
    console.error(`FAIL: ${error.stack || error.message}`);
    process.exitCode = 1;
  } finally { await browser.close(); }
})();
