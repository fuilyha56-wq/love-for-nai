/* eslint-disable @typescript-eslint/no-require-imports -- Local browser audit for the characters tutorial only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
process.env.LFN_UI_BASE_URL ||= 'http://127.0.0.1:3000';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
process.env.LFN_UI_TEST_SESSION_SECRET = 'lfn-local-tutorial-ui-test-secret-only-20261026';
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const output = path.resolve('public/tutorials/characters');
const reportDir = path.resolve('.tmp/feature-tutorials/characters');
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(reportDir, { recursive: true });

const report = { baseURL, scenarios: [], errors: [], unexpectedWrites: [], externalRequests: [], phoneHitTests: [] };
const stepFiles = Array.from({ length: 6 }, (_, index) => path.join(output, `step-${String(index + 1).padStart(2, '0')}.png`));

function nextButton(page) {
  return page.locator('.feature-tutorial-panel footer').getByRole('button', { name: /下一步/ });
}

async function collapseGuide(page) {
  const button = page.locator('.feature-tutorial-locate').getByRole('button', { name: '收起说明，继续操作', exact: true });
  if (await button.count()) await button.click();
}

async function expandGuide(page) {
  const button = page.locator('.feature-tutorial-panel button[aria-label="展开教程说明"]').first();
  if (await button.count()) await button.click();
}

async function clickVisibleControl(page, locator, label) {
  await locator.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
  await page.waitForTimeout(150);
  const hit = await locator.evaluate(element => {
    const rect = element.getBoundingClientRect();
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, hitTag: top?.tagName || null, hitClass: typeof top?.className === 'string' ? top.className : '', hitInsideControl: Boolean(top && (top === element || element.contains(top))) };
  });
  report.phoneHitTests.push({ label, ...hit });
  assert(hit.hitInsideControl, `${label}: the phone tap point reaches the real control`);
  await locator.click();
}

async function verifyTarget(page, stepIndex, device) {
  await page.waitForTimeout(500);
  const target = page.locator('[data-feature-tutorial-target="true"]');
  const spotlight = page.locator('.feature-tutorial-spotlight');
  if (await target.count() !== 1) {
    fs.writeFileSync(path.join(reportDir, `${device}-step-${stepIndex + 1}-failure.txt`), `${await page.locator('.feature-tutorial-panel').innerText()}\n\nBODY:\n${(await page.locator('body').innerText()).slice(0, 12000)}`);
    await page.screenshot({ path: path.join(reportDir, `${device}-step-${stepIndex + 1}-failure.png`), animations: 'disabled' });
  }
  assert.equal(await target.count(), 1, `${device} step ${stepIndex + 1}: one live target is marked`);
  assert(await target.isVisible(), `${device} step ${stepIndex + 1}: target is visible`);
  assert(await spotlight.isVisible(), `${device} step ${stepIndex + 1}: spotlight is visible`);
  const [targetBox, spotBox] = await Promise.all([target.boundingBox(), spotlight.boundingBox()]);
  assert(targetBox && spotBox, `${device} step ${stepIndex + 1}: target and spotlight have bounds`);
  assert(Math.abs(spotBox.x - Math.max(4, targetBox.x - 4)) < 2, `${device} step ${stepIndex + 1}: spotlight aligns horizontally`);
  assert(Math.abs(spotBox.y - Math.max(4, targetBox.y - 4)) < 2, `${device} step ${stepIndex + 1}: spotlight aligns vertically`);
  assert(targetBox.width > 0 && targetBox.height > 0, `${device} step ${stepIndex + 1}: target is not a dead-end placeholder`);
  const body = page.locator('.feature-tutorial-body');
  assert((await body.innerText()).trim().length > 0, `${device} step ${stepIndex + 1}: instruction text is present`);
  assert(await body.locator('.tutorial-keyword').count() > 0, `${device} step ${stepIndex + 1}: key terms are emphasized`);
  return {
    title: await page.locator('.feature-tutorial-panel h2').innerText(),
    target: await target.evaluate(el => ({ tag: el.tagName, role: el.getAttribute('role'), label: el.getAttribute('aria-label'), text: el.innerText.trim().slice(0, 200), className: typeof el.className === 'string' ? el.className : '' })),
    bounds: targetBox,
    emphasized: await body.locator('.tutorial-keyword').allTextContents(),
  };
}

async function saveScreenshot(page, file) {
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.screenshot({ path: file, animations: 'disabled' });
  const metadata = await sharp(file).metadata();
  assert(metadata.width >= 375 && metadata.height >= 600, `Screenshot is a full browser capture: ${file}`);
  return { file: path.basename(file), width: metadata.width, height: metadata.height };
}

async function openTutorial(page, mode) {
  await page.goto(`${baseURL}/profile#profile-tutorials`);
  const card = page.locator('[data-tutorial-id="characters"]');
  await card.waitFor();
  await card.getByRole('button', { name: mode === 'article' ? /图文教程$/ : /手把手教程$/ }).click();
}

async function chooseNaiModel(page) {
  const trigger = page.locator('[aria-label="模型"]').filter({ visible: true }).first();
  await trigger.waitFor({ state: 'visible' });
  await trigger.click();
  const option = page.getByRole('option').filter({ hasText: /nai-v5-full/i }).first();
  await option.waitFor({ state: 'visible' });
  await option.click();
  await page.waitForFunction(() => [...document.querySelectorAll('[aria-label="模型"]')].some(el => /nai-v5-full/i.test(el.textContent || '')));
}

async function prepareTwoCharacters(page) {
  const desktop = page.locator('.replica-character-section');
  const naichars = page.locator('.nai-characters');
  const visibleDesktop = desktop.filter({ visible: true });
  if (await visibleDesktop.count()) {
    const root = visibleDesktop.first();
    const title = root.getByRole('button', { name: /角色提示|角色$/ }).first();
    if (await title.getAttribute('aria-expanded') === 'false') await title.click();
    const add = root.getByRole('button', { name: '添加角色', exact: true });
    if (await root.locator('.replica-character-card').count() === 0) {
      const shortcuts = root.locator('.replica-character-shortcuts');
      if (await shortcuts.count()) {
        const first = shortcuts.getByRole('button', { name: /♀ 女/ });
        const second = shortcuts.getByRole('button', { name: /♂ 男/ });
        await clickVisibleControl(page, first, 'Add first character shortcut');
        await clickVisibleControl(page, second, 'Add second character shortcut');
      } else {
        const enable = root.getByRole('button', { name: '添加角色提示词' });
        await enable.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
        await page.waitForTimeout(200);
        const hit = await enable.evaluate(element => {
          const rect = element.getBoundingClientRect();
          const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
          return { box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, hit: top?.outerHTML.slice(0, 500) || null };
        });
        fs.writeFileSync(path.join(reportDir, 'phone-role-enable-hit-test.json'), JSON.stringify(hit, null, 2));
        await enable.click();
      }
    }
    if (await root.locator('.replica-character-card').count() < 2) {
      await add.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
      await page.waitForTimeout(200);
      const hit = await add.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return { box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, hit: top?.outerHTML.slice(0, 500) || null };
      });
      fs.writeFileSync(path.join(reportDir, 'phone-role-add-hit-test.json'), JSON.stringify(hit, null, 2));
      await add.click();
    }
    await root.getByRole('textbox', { name: '角色 1 提示词' }).fill('1girl, blue hair, white dress');
    await root.getByRole('textbox', { name: '角色 2 提示词' }).fill('1boy, brown hair, green jacket');
    return { root, promptCount: 2 };
  }
  if (!await naichars.count()) {
    fs.writeFileSync(path.join(reportDir, 'phone-character-controls.txt'), (await page.locator('body').innerText()).slice(0, 12000));
    await page.screenshot({ path: path.join(reportDir, 'phone-character-controls.png'), animations: 'disabled' });
    throw new Error('Character controls are not mounted; see local phone audit diagnostics');
  }
  const area = naichars;
  const toggle = area.getByRole('button', { name: '添加角色提示词', exact: true });
  if (await toggle.count()) await toggle.click();
  else {
    const enabled = area.getByRole('checkbox', { name: '启用', exact: true });
    if (await enabled.count() && !(await enabled.isChecked())) await enabled.check();
  }
  let prompts = area.locator('textarea[placeholder^="该角色的提示词"]').filter({ visible: true });
  if (await prompts.count() < 2) {
    const add = area.getByRole('button', { name: /添加角色/ });
    if (!await add.count()) {
      fs.writeFileSync(path.join(reportDir, 'character-controls.txt'), `${await area.innerText()}\nHTML:\n${(await area.evaluate(el => el.outerHTML)).slice(0, 12000)}`);
      await page.screenshot({ path: path.join(reportDir, 'character-controls.png'), animations: 'disabled' });
      throw new Error('Character prompt panel has no add-character button; see local audit diagnostics');
    }
    await add.click();
  }
  prompts = area.locator('textarea[placeholder^="该角色的提示词"]').filter({ visible: true });
  await prompts.nth(0).fill('1girl, blue hair, white dress');
  await prompts.nth(1).fill('1boy, brown hair, green jacket');
  return { root: area, promptCount: 2 };
}

async function configureManualPositions(page, root) {
  if (await root.locator('.replica-character-auto').count()) {
    const auto = root.locator('.replica-character-auto input[type="checkbox"]');
    if (await auto.isChecked()) await auto.uncheck();
  } else {
    const toggle = root.locator('label').filter({ hasText: '关闭滑块定位' }).locator('input[type="checkbox"]');
    assert.equal(await toggle.count(), 1, 'Manual position toggle is visible');
    if (await toggle.isChecked()) await toggle.uncheck();
  }
  const x1 = page.getByRole('slider', { name: '角色 1 水平位置' });
  const y1 = page.getByRole('slider', { name: '角色 1 垂直位置' });
  const x2 = page.getByRole('slider', { name: '角色 2 水平位置' });
  const y2 = page.getByRole('slider', { name: '角色 2 垂直位置' });
  await x1.fill('0.3'); await y1.fill('0.45'); await x2.fill('0.7'); await y2.fill('0.55');
  assert.deepEqual(await Promise.all([x1.inputValue(), y1.inputValue(), x2.inputValue(), y2.inputValue()]), ['0.3', '0.45', '0.7', '0.55']);
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    // Validate the illustrated article on reruns after the first genuine browser captures exist.
    if (stepFiles.every(fs.existsSync)) {
      const { context, page } = await setup(browser, { theme: 'paper', workspaceLayout: 'lfn' }, { width: 1440, height: 1000 });
      page.on('pageerror', error => report.errors.push(error.stack || error.message));
      await openTutorial(page, 'article');
      await page.locator('#tutorial-article-title').getByText('多角色与角色位置', { exact: true }).waitFor();
      const shots = page.locator('.tutorial-article [data-tutorial-shot]');
      assert.equal(await shots.count(), 6, 'Illustrated article includes a screenshot for every step');
      const images = [];
      for (let index = 0; index < 6; index++) {
        await shots.nth(index).scrollIntoViewIfNeeded();
        await page.waitForFunction(i => { const img = document.querySelectorAll('.tutorial-article [data-tutorial-shot]')[i]; return Boolean(img?.complete && img.naturalWidth > 0); }, index);
        images.push(await shots.nth(index).evaluate(img => ({ src: img.getAttribute('src'), width: img.naturalWidth, height: img.naturalHeight, alt: img.getAttribute('alt') })));
      }
      assert(images.every(item => item.width === 1440 && item.height === 1000 && item.src.startsWith('/tutorials/characters/step-')));
      assert(await page.locator('.tutorial-article-step .tutorial-keyword').count() > 0, 'Article emphasizes important terms');
      report.article = { screenshots: images };
      await context.close();
    } else report.article = { screenshots: [], capturePending: true };

    // Desktop guided run: exercise two character prompts and coordinates entirely in browser state.
    {
      const { context, page, requests } = await setup(browser, { theme: 'paper', workspaceLayout: 'lfn' }, { width: 1440, height: 1000 });
      const errors = [];
      page.on('pageerror', error => { errors.push(error.stack || error.message); report.errors.push(error.stack || error.message); });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { report.externalRequests.push(url.origin); return route.abort(); }
        return route.fallback();
      });
      await context.route('**/api/models', route => route.fulfill({ json: { items: ['nai-v5-full', 'nai-v5-full-medium', 'nai-v4.5-full'].map(id => ({ id, kind: '图像模型' })) } }));
      await openTutorial(page, 'guide');
      await page.waitForURL('**/image');
      await page.locator('.feature-tutorial-panel h2').getByText('选择支持角色提示词的模型', { exact: true }).waitFor();
      const steps = [];
      for (let index = 0; index < 6; index++) {
        steps.push(await verifyTarget(page, index, 'desktop'));
        if (index === 0) {
          await chooseNaiModel(page);
          await saveScreenshot(page, stepFiles[index]);
          await nextButton(page).click();
        } else if (index === 1) {
          await saveScreenshot(page, stepFiles[index]);
          const prompt = page.locator('.replica-prompt textarea, [data-tutorial="prompt"] textarea').filter({ visible: true }).first();
          await prompt.fill('two friends talking in a garden, afternoon light, medium shot');
          await nextButton(page).click();
        } else if (index === 2) {
          const { root } = await prepareTwoCharacters(page);
          await saveScreenshot(page, stepFiles[index]);
          await nextButton(page).click();
          await configureManualPositions(page, root);
        } else if (index === 3) {
          await saveScreenshot(page, stepFiles[index]);
          await nextButton(page).click();
        } else if (index === 4) {
          await saveScreenshot(page, stepFiles[index]);
          await nextButton(page).click();
        } else {
          await saveScreenshot(page, stepFiles[index]);
          assert.equal(await page.locator('.feature-tutorial-exit').innerText().then(s => s.trim()), '退出教程，返回个人资料的教程中心');
          await page.getByRole('button', { name: '完成教程，返回教程中心', exact: true }).click();
          await page.waitForURL('**/profile#profile-tutorials');
          assert(await page.locator('[data-tutorial-id="characters"] .tutorial-completed').isVisible(), 'Completion returns to tutorial center and marks this tutorial complete');
        }
      }
      assert.equal(errors.length, 0, errors.join('\n'));
      assert.equal(report.externalRequests.length, 0, 'No non-local request was made');
      assert.equal(requests.filter(r => r.method !== 'GET').length, 0, 'No API write or generation operation was sent');
      report.scenarios.push({ device: 'desktop', steps, writes: 0, completedAndReturned: true, errors });
      await context.close();
    }

    // Phone guided run and early exit; position controls are operated on the phone layout.
    {
      const { context, page, requests } = await setup(browser, { theme: 'paper', workspaceLayout: 'nai' }, { width: 390, height: 844 });
      const errors = [];
      page.on('pageerror', error => { errors.push(error.stack || error.message); report.errors.push(error.stack || error.message); });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { report.externalRequests.push(url.origin); return route.abort(); }
        return route.fallback();
      });
      await context.route('**/api/models', route => route.fulfill({ json: { items: ['nai-v5-full', 'nai-v5-full-medium', 'nai-v4.5-full'].map(id => ({ id, kind: '图像模型' })) } }));
      await openTutorial(page, 'guide');
      await page.waitForURL('**/image');
      const steps = [];
      for (let index = 0; index < 4; index++) {
        steps.push(await verifyTarget(page, index, 'phone'));
        if (index === 0) {
          await chooseNaiModel(page);
          await nextButton(page).click();
        }
        else if (index === 1) {
          const prompt = page.locator('.mobile-studio-prompt-content textarea:visible').first();
          await prompt.fill('two friends talking in a garden, afternoon light, medium shot');
          await nextButton(page).click();
        } else if (index === 2) {
          await collapseGuide(page);
          const { root } = await prepareTwoCharacters(page);
          await expandGuide(page);
          await nextButton(page).click();
          await collapseGuide(page);
          await configureManualPositions(page, root);
          await expandGuide(page);
        } else if (index === 3) {
          assert.equal(await page.locator('.feature-tutorial-exit').innerText().then(s => s.trim()), '退出教程，返回个人资料的教程中心');
          // Use the detailed exit control as a separate early-exit behavior check.
          await page.getByRole('button', { name: /退出教程，返回个人资料的教程中心/ }).click();
          await page.waitForURL('**/profile#profile-tutorials');
          assert(await page.locator('[data-tutorial-id="characters"]').isVisible());
        }
      }
      assert.equal(errors.length, 0, errors.join('\n'));
      assert.equal(report.externalRequests.length, 0, 'No non-local request was made');
      assert.equal(requests.filter(r => r.method !== 'GET').length, 0, 'No API write or generation operation was sent');
      report.scenarios.push({ device: 'phone', steps, writes: 0, earlyExitReturned: true, errors });
      await context.close();
    }

    assert.equal(report.errors.length, 0, 'No runtime page errors occurred');
    assert.equal(report.externalRequests.length, 0, 'All external origins remained blocked');
    report.screenshots = [];
    for (const file of stepFiles) {
      const image = await sharp(file).metadata();
      report.screenshots.push({ file: `/tutorials/characters/${path.basename(file)}`, width: image.width, height: image.height });
    }
    fs.writeFileSync(path.join(reportDir, 'audit.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ article: report.article.screenshots.length, articleCapturePending: Boolean(report.article.capturePending), scenarios: report.scenarios.map(s => ({ device: s.device, steps: s.steps.length, writes: s.writes, returned: s.completedAndReturned || s.earlyExitReturned })), errors: report.errors.length, externalRequests: report.externalRequests.length }));
  } catch (error) {
    fs.writeFileSync(path.join(reportDir, 'failure.txt'), error.stack || error.message);
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
