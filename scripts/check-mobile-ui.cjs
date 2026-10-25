/* Run against a local dev server. Install Playwright or set LFN_PLAYWRIGHT_MODULE. */
/* eslint-disable @typescript-eslint/no-require-imports -- This standalone Node runner loads an optional local Playwright installation. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require(process.env.LFN_PLAYWRIGHT_MODULE || 'playwright');
const baseURL = process.env.LFN_UI_BASE_URL || 'http://127.0.0.1:3000';
assert(['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname), 'Use a local test server');
const output = path.resolve('.tmp/mobile-ui');
fs.mkdirSync(output, { recursive: true });
const results = [];
const errors = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=', 'base64');
const fixture = { id: 'mobile-ui-fixture', createdAt: '2026-10-23T00:00:00Z', imageUrl: '/api/history/mobile-ui-fixture/image', parameters: { prompt: 'mobile layout fixture', negative_prompt: '', model: 'nai-v5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', operation: 'generate' } };

function testCookie(secret) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = { userId: 7777777, username: 'mobile-ui-test', displayName: '布局测试', upstreamCookie: '', authenticatedAt: Date.now(), expiresAt: Date.now() + 3600000, epoch: 1, userEpoch: 1 };
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(p => p.toString('base64url')).join('.');
}

async function setup(browser, preferences = {}, size = { width: 390, height: 844 }) {
  const context = await browser.newContext({ viewport: size, isMobile: size.width < 1024, hasTouch: size.width < 1024, deviceScaleFactor: 1 });
  if (process.env.LFN_UI_TEST_SESSION_SECRET) await context.addCookies([{ name: 'lfn_session', value: testCookie(process.env.LFN_UI_TEST_SESSION_SECRET), url: baseURL }]);
  await context.addInitScript(prefs => {
    localStorage.setItem('lfn-onboarding-v1', 'done');
    localStorage.setItem('lfn-guide-launcher-visible', 'false');
    localStorage.setItem('lfn-mobile-onboarding-v1', 'done');
    localStorage.setItem('lfn-mobile-guide-launcher-visible', 'false');
    if (!localStorage.getItem('lfn-ui-preferences-v1')) localStorage.setItem('lfn-ui-preferences-v1', JSON.stringify({ version: 1, ...prefs }));
    if (!localStorage.getItem('lfn-mobile-ui-preferences-v1')) localStorage.setItem('lfn-mobile-ui-preferences-v1', JSON.stringify({ version: 1, ...prefs }));
  }, preferences);
  const requests = [];
  let failDelete = false;
  await context.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    requests.push({ path: url.pathname, method: request.method(), body: request.method() === 'POST' ? request.postDataJSON() : undefined });
    if (url.pathname.endsWith('/image')) return route.fulfill({ contentType: 'image/png', body: png });
    if (request.method() === 'DELETE' && url.pathname === '/api/history') return route.fulfill({ status: failDelete ? 500 : 200, json: { success: !failDelete } });
    if (request.method() === 'POST' && url.pathname === '/api/images/operate') return route.fulfill({ json: { images: [`data:image/png;base64,${png.toString('base64')}`], historyIds: [], payment: 'aff' } });
    if (request.method() !== 'GET') return route.fulfill({ status: 409, json: { message: 'UI test: external writes and paid operations are blocked' } });
    const data = {
      '/api/history': { items: [fixture] },
      '/api/announcements': { items: [] },
      '/api/public/image-policy': { enableV5Models: true, enableV45Models: true },
      '/api/models': { items: ['nai-v5-full', 'nai-v5-full-medium', 'nai-v5-inpaint', 'nai-v4.5-full'].map(id => ({ id, kind: '图像模型' })) },
      '/api/me': { authenticated: true, user: { id: 7777777, username: 'mobile-ui-test', displayName: '布局测试', display_name: '布局测试', balance: 100, group: 'default' } },
      '/api/wallet': { newApi: { balance: 100, used: 0, group: 'default' }, aff: { enabled: true, balance: 100, packageBalance: 0, totalBalance: 100, packageRateLimitRemaining: 10 } },
      '/api/admin': { admin: false },
      '/api/aff/ledger': { transactions: [] },
      '/api/aff/referral': { enabled: false, invitedCount: 0, registrationReward: 0 },
      '/api/assistant/models': { items: [] },
      '/api/providers': { items: [] },
      '/api/providers/novelai': { account: null },
      '/api/stories': { items: [] },
      '/api/stories/models': { items: [] },
      '/api/gallery': { items: [] },
      '/api/gallery/mine': { items: [] },
      '/api/notifications': { items: [], unreadCount: 0 },
      '/api/public/catalog': { models: [{ id: 'nai-v5-full', kind: 'image', name: 'V5 完整版', summary: 'NovelAI 图像生成模型', capabilities: ['文生图', '局部重绘', '多角色'], pricing: null }, { id: 'nai-chat', kind: 'chat', name: 'NAI Chat', summary: '提示词整理与创作对话', capabilities: ['提示词助手', '标签整理'], pricing: null }], asOf: '2026-10-23T00:00:00Z', stale: false, source: 'snapshot', currency: 'USD', conversion: '测试目录' },
    }[url.pathname] || { items: [] };
    return route.fulfill({ json: data });
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`${page.url()}: ${error.stack || error.message}`));
  page.on('console', message => { if (message.type() === 'error' && /hydration|hydrated|didn't match/i.test(message.text())) errors.push(message.text()); });
  return { context, page, requests, failDelete: value => { failDelete = value; } };
}

async function shot(page, name) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(output, `${name}.png`), animations: 'disabled' });
}

async function fit(page, label) {
  const geometry = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth }));
  assert(geometry.scrollWidth <= geometry.width + 1, `${label}: horizontal page overflow ${JSON.stringify(geometry)}`);
}

async function run(name, action) {
  if (process.env.LFN_UI_SCENARIO && !name.includes(process.env.LFN_UI_SCENARIO)) return;
  try { await action(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch(error) { results.push({ name, passed: false, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); }
}

module.exports = { setup, chromium, baseURL };

if (require.main === module) (async () => {
  const browser = await chromium.launch({ headless: true, channel: process.env.LFN_UI_BROWSER_CHANNEL || 'msedge' });
  try {
    for (const theme of ['paper', 'dusk', 'night', 'nai']) for (const workspaceLayout of ['lfn', 'nlw', 'custom']) {
      await run(`studio-${theme}-${workspaceLayout}`, async () => {
        const { context, page } = await setup(browser, { theme, workspaceLayout });
        try {
          await page.goto(`${baseURL}/image`);
          const mobile = page.locator('.mobile-studio-launcher');
          await mobile.waitFor({ state: 'visible' });
          for (const size of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 600, height: 900 }, { width: 808, height: 884 }, { width: 839, height: 884 }, { width: 840, height: 1180 }, { width: 844, height: 390 }]) {
            await page.setViewportSize(size);
            await page.waitForTimeout(150);
            await fit(page, `${theme}/${workspaceLayout}/${size.width}`);
            if (size.width < 840) {
              const nav = await page.getByRole('navigation', { name: '移动工作台导航', exact: true }).boundingBox();
              assert(nav && nav.y >= 0 && nav.y + nav.height <= size.height + 1, 'Bottom navigation must fit the viewport');
              assert.equal(await page.locator('.mobile-studio-bottom-nav > :is(a,button)').count(), 5, 'All five mobile branches remain reachable');
              const preview = await mobile.locator('.mobile-studio-preview-section').boundingBox();
              assert(preview && preview.width > 100 && preview.height >= 100, 'Preview must remain usable');
            } else {
              assert.equal(await page.locator('.launcher-shell').count(), 0, 'The phone shell never mounts on desktop');
              const studio = page.locator('[data-studio-layout]');
              assert.equal(await studio.getAttribute('data-workspace-layout'), theme === 'nai' && workspaceLayout !== 'custom' ? null : workspaceLayout, 'Desktop keeps its original selected layout');
            }
            if (size.width === 390 || size.width === 844) await shot(page, `${theme}-${workspaceLayout}-${size.width}`);
          }
          await page.setViewportSize({ width: 390, height: 844 });
          await page.getByRole('button', { name: '打开生成参数', exact: true }).click();
          const parameters = page.getByRole('dialog', { name: '生成参数', exact: true });
          await parameters.waitFor();
          assert(await parameters.getByLabel('模型', { exact: true }).isVisible(), 'Model control is reachable');
          assert((await parameters.getByLabel('模型', { exact: true }).innerText()).includes('nai-v5-full'), 'Model catalog loads after a fresh mount');
          assert(await parameters.locator('.mobile-studio-sheet-content').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Parameter content fits horizontally');
          await shot(page, `${theme}-${workspaceLayout}-parameters`);
          await page.keyboard.press('Escape');
          assert(await page.getByRole('button', { name: '打开生成参数', exact: true }).evaluate(el => el === document.activeElement), 'Focus returns to the parameter button');
          await page.locator('.mobile-studio-prompt-section .mobile-studio-prompt-toggle').click();
          const prompt = page.getByRole('dialog', { name: '提示词区域', exact: true });
          await prompt.waitFor();
          assert(await prompt.locator('textarea:visible').first().isVisible(), 'The actual prompt input remains visible, not only the modal chrome');
          await page.setViewportSize({ width: 390, height: 400 });
          await page.waitForFunction(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lfn-viewport-height')) <= 401);
          const bounds = await prompt.boundingBox();
          assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 401, 'Prompt fits a reduced keyboard viewport');
          assert(await prompt.getByRole('button', { name: '完成', exact: true }).isVisible());
          await shot(page, `${theme}-${workspaceLayout}-keyboard`);
          await prompt.getByRole('button', { name: '完成', exact: true }).click();
          for (const width of [1024, 1180, 1600]) { await page.setViewportSize({ width, height: 1000 }); await page.waitForTimeout(150); await fit(page, `desktop/${theme}/${workspaceLayout}/${width}`); }
        } finally { await context.close(); }
      });
    }

    await run('source-removal-and-inpaint-mode', async () => {
      const { context, page } = await setup(browser);
      try {
        await page.goto(`${baseURL}/image`);
        await page.getByRole('button', { name: '生成模式', exact: true }).click();
        await page.getByRole('option', { name: '局部重绘', exact: true }).click();
        await page.locator('.mobile-studio-reference-panel input[type=file]').setInputFiles({ name: 'mobile-fixture.png', mimeType: 'image/png', buffer: png });
        await page.getByRole('button', { name: '移除参考图片', exact: true }).waitFor();
        assert.equal(await page.locator('.mobile-studio-mode-selector').getAttribute('data-current-operation'), 'inpainting');
        await shot(page, 'source-inpaint');
        await page.getByRole('button', { name: '移除参考图片', exact: true }).click();
        assert.equal(await page.getByRole('button', { name: '移除参考图片', exact: true }).count(), 0);
        await page.reload();
        await page.locator('.mobile-studio-launcher').waitFor({ state: 'visible' });
        assert.equal(await page.getByRole('button', { name: '移除参考图片', exact: true }).count(), 0);
      } finally { await context.close(); }
    });

    await run('parameter-state-and-local-only-generation-request', async () => {
      const { context, page, requests } = await setup(browser);
      try {
        await page.goto(`${baseURL}/image`);
        await page.getByRole('button', { name: '打开生成参数', exact: true }).click();
        const parameters = page.getByRole('dialog', { name: '生成参数', exact: true });
        const steps = parameters.getByLabel('步数', { exact: true });
        await steps.fill('24');
        await steps.press('Tab');
        await page.keyboard.press('Escape');
        await page.locator('.mobile-studio-prompt-section .mobile-studio-prompt-toggle').click();
        const prompt = page.getByRole('dialog', { name: '提示词区域', exact: true });
        await prompt.locator('textarea:visible').first().fill('a test landscape with mountains');
        await prompt.getByRole('button', { name: '完成', exact: true }).click();
        await page.getByRole('button', { name: '更多', exact: true }).click();
        await page.getByRole('button', { name: '生成', exact: true }).click();
        const summary = await page.locator('.mobile-studio-prompt-section').innerText();
        assert(summary.replaceAll('_', ' ').includes('a test landscape with mountains'), `Edited prompt survives navigation: ${summary}`);
        await page.getByRole('button', { name: '历史', exact: true }).click();
        await page.locator('.mobile-studio-history-mode .popup-select-trigger').click();
        await page.getByRole('option', { name: '仅保存本机', exact: true }).click();
        await page.getByRole('button', { name: '生成', exact: true }).click();
        await page.locator('.mobile-studio-footer button[data-studio-generate]').click();
        try { await page.waitForFunction(() => document.querySelector('.mobile-studio-preview-section img'), undefined, { timeout: 10000 }); }
        catch (error) { await shot(page, 'generation-request-failure'); throw new Error(`${error.message}; UI: ${(await page.locator('body').innerText()).slice(-1800)}; Requests: ${JSON.stringify(requests)}`); }
        const request = requests.find(r => r.path === '/api/images/operate' && r.method === 'POST');
        assert(request, 'Generation reaches the intercepted API');
        assert.equal(request.body._lfnSkipServerHistory, true);
        assert.equal(request.body.steps, 24);
        assert(request.body.prompt.replaceAll('_', ' ').includes('a test landscape with mountains'), 'Edited prompt reaches generation after model formatting');
        await shot(page, 'generated-local-fixture');
      } finally { await context.close(); }
    });

    await run('history-preview-clear-delete-error-and-local-mode', async () => {
      const { context, page, requests, failDelete } = await setup(browser);
      try {
        await page.goto(`${baseURL}/image`);
        await page.getByRole('button', { name: '历史', exact: true }).click();
        await page.getByRole('button', { name: '查看第 1 张历史图像', exact: true }).click();
        await page.keyboard.press('Escape');
        await page.getByRole('button', { name: '生成', exact: true }).click();
        await page.getByRole('button', { name: '清空工作区', exact: true }).click();
        assert.equal(await page.locator('.mobile-studio-preview-section img').count(), 0);
        await page.getByRole('button', { name: '历史', exact: true }).click();
        assert(await page.getByRole('button', { name: '查看第 1 张历史图像', exact: true }).isVisible(), 'Clearing workspace preserves history');
        failDelete(true);
        await page.getByRole('button', { name: '删除第 1 张历史图像', exact: true }).click();
        await page.getByRole('dialog').getByRole('button', { name: '确认', exact: true }).click();
        await page.getByText('删除失败，历史记录已保留，请稍后重试。', { exact: true }).waitFor();
        assert(await page.getByRole('button', { name: '查看第 1 张历史图像', exact: true }).isVisible());
        await shot(page, 'history-delete-error');
        await page.locator('.mobile-studio-history-mode .popup-select-trigger').click();
        await page.getByRole('option', { name: '仅保存本机', exact: true }).click();
        const count = requests.filter(r => r.path === '/api/history' && r.method === 'GET').length;
        await page.getByRole('button', { name: '刷新历史', exact: true }).click();
        await page.waitForTimeout(300);
        assert.equal(requests.filter(r => r.path === '/api/history' && r.method === 'GET').length, count, 'Local mode does not fetch account history');
      } finally { await context.close(); }
    });

    await run('appearance-settings-and-navigation-menus', async () => {
      const { context, page } = await setup(browser);
      try {
        await page.goto(`${baseURL}/settings`);
        await page.getByRole('navigation', { name: '设置分类', exact: true }).getByRole('link', { name: '外观与界面', exact: true }).click();
        await page.getByRole('button', { name: /夜间.*低亮度/s }).click();
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lfn-mobile-ui-preferences-v1')).theme), 'night', 'Phone theme is persisted separately');
        await page.getByRole('button', { name: /薄荷/ }).click();
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lfn-mobile-ui-preferences-v1')).theme), 'night', 'Changing accent preserves the chosen phone theme');
        await page.getByRole('button', { name: /减少动效.*降低动态反馈/s }).click();
        assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lfn-mobile-ui-preferences-v1')).theme), 'night', 'Changing motion preserves the chosen phone theme');
        await page.goto(`${baseURL}/image`);
        await page.locator('.mobile-studio-launcher').waitFor({ state: 'visible' });
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'night');
        assert.equal(await page.locator('html').getAttribute('data-theme'), 'night');
        assert.equal(await page.locator('html').getAttribute('data-motion'), 'reduced');
        assert.equal(await page.locator('html').evaluate(el => el.style.getPropertyValue('--rose')), '#2d7567');
        await page.goto(`${baseURL}/notifications`);
        await page.getByRole('heading', { name: '消息', exact: true }).waitFor();
        assert.equal(await page.getByRole('heading', { name: '消息', exact: true }).count(), 1);
        await page.getByRole('navigation', { name: '移动应用导航', exact: true }).getByRole('button', { name: '更多页面', exact: true }).click();
        const more = page.getByRole('dialog', { name: '更多页面', exact: true });
        await more.waitFor();
        const bounds = await more.boundingBox();
        assert(bounds && bounds.y >= 0 && bounds.y + bounds.height <= 845);
        await shot(page, 'workspace-navigation');
        await more.getByRole('link', { name: '模型目录', exact: true }).scrollIntoViewIfNeeded();
        assert(await more.getByRole('link', { name: '模型目录', exact: true }).isVisible());
        await page.keyboard.press('Escape');
      } finally { await context.close(); }
    });

    for (const route of ['/settings', '/settings#profile', '/settings#models', '/settings#prompts', '/image/setting/layout', '/gallery', '/history', '/image/editor/history', '/profile', '/usage', '/studio', '/stories', '/announcements', '/notifications', '/verify', '/tags', '/pricing', '/models', '/docs', '/sign-in']) {
      await run(`page-${route}`, async () => {
        const { context, page } = await setup(browser);
        try {
          await page.goto(`${baseURL}${route}`);
          await page.waitForTimeout(500);
          if (route === '/models') assert(await page.getByRole('textbox', { name: '搜索模型名称或用途', exact: true }).evaluate(el => parseFloat(getComputedStyle(el).paddingLeft) >= 36), 'Search text clears its icon');
          for (const size of [{ width: 320, height: 640 }, { width: 390, height: 844 }, { width: 844, height: 390 }]) {
            await page.setViewportSize(size);
            await fit(page, `${route}/${size.width}`);
            if (size.width === 390) await shot(page, `page-${route.replace(/[^a-z0-9]/gi, '-')}`);
          }
        } finally { await context.close(); }
      });
    }

    await run('editor-draft-tools-parameters-history-canvas', async () => {
      const { context, page } = await setup(browser);
      try {
        await page.goto(`${baseURL}/image/editor`);
        await page.evaluate(async () => {
          const db = await new Promise((resolve, reject) => {
            const request = indexedDB.open('lfn-image-editor-v1', 1);
            request.onupgradeneeded = () => request.result.createObjectStore('drafts', { keyPath: 'id' });
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
          const now = Date.now();
          const draft = { id: 'mobile-ui-test', version: 1, mode: 'canvas', document: { version: 1, image: { width: 64, height: 64, data: new Uint8ClampedArray(64 * 64 * 4).fill(220) }, worldRect: { x: 0, y: 0, width: 64, height: 64 }, prompt: 'layout fixture', generation: { model: 'nai-v5-full', width: 832, height: 1216 }, revision: 0 }, createdAt: now, updatedAt: now };
          await new Promise((resolve, reject) => { const tx = db.transaction('drafts', 'readwrite'); tx.objectStore('drafts').put(draft); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
          db.close();
        });
        await page.goto(`${baseURL}/image/editor?draftId=mobile-ui-test&mode=canvas`);
        await page.locator('.editor-stage canvas').first().waitFor({ state: 'visible' });
        assert(await page.locator('.editor-topbar').evaluate(el => el.scrollWidth <= el.clientWidth + 1), 'Editor header actions fit horizontally');
        for (const name of ['工具', '生成', '历史', '画布']) {
          await page.locator('.editor-mobile-tabs').getByRole('button', { name, exact: true }).click();
          await shot(page, `editor-${name}`);
          await fit(page, `editor/${name}`);
        }
        await page.setViewportSize({ width: 808, height: 390 });
        await page.waitForTimeout(200);
        const bounds = await page.locator('.image-editor-page').boundingBox();
        assert(bounds && bounds.height <= 391, 'Editor fits short landscape');
        await shot(page, 'editor-landscape');
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
  const reportName = process.env.LFN_UI_SCENARIO ? `report-${process.env.LFN_UI_SCENARIO.replace(/[^a-z0-9]/gi, '-')}.json` : 'report.json';
  fs.writeFileSync(path.join(output, reportName), JSON.stringify({ results, errors }, null, 2));
  console.log(`${results.filter(r => r.passed).length}/${results.length} scenarios passed; ${errors.length} browser errors. Evidence: ${output}`);
  if (errors.length) console.log(errors.slice(0, 3).join('\n'));
  if (results.some(r => !r.passed) || errors.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
