/* Local-only browser audit for the Storyteller tutorial. */
/* eslint-disable @typescript-eslint/no-require-imports -- standalone local browser audit */
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

process.env.LFN_UI_BASE_URL ||= 'http://localhost:3010';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
process.env.LFN_UI_TEST_SESSION_SECRET ||= 'lfn-local-tutorial-ui-test-secret-only-20261026';
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const { chromium, baseURL } = require('./check-mobile-ui.cjs');
assert(['127.0.0.1', 'localhost'].includes(new URL(baseURL).hostname), 'Use a local-only base URL');
const publicDir = path.resolve('public/tutorials/stories');
const stepCount = 4;
const selectors = [
  ['.story-dashboard .launcher-story-actions button', '.story-empty-state', '.story-mode-grid .story-mode-card:first-child', '.story-create-form'],
  ['.story-prose-editor', '.story-settings-drawer.is-open [aria-label="故事 AI 模型"]', '[role="dialog"][aria-label="故事设置"] [aria-label="故事 AI 模型"]'],
  ['.story-generation-dock .story-instruction-row input', '.story-generation-mode', '[aria-label="故事生成方式"]', '.story-send-button'],
  ['.story-editor-actions [aria-label="管理故事分支"]', '.story-branch-popover', '[role="dialog"][aria-label="故事分支"]'],
];
const titles = ['创建 Storyteller 故事', '准备正文并选择模型', '续写当前剧情', '创建分支并比较剧情'];

function testCookie(secret) {
  const key = crypto.createHash('sha256').update(secret).digest();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = { userId: 7777766, username: 'stories-tutorial-audit', displayName: '本地审计', upstreamCookie: '', authenticatedAt: Date.now(), expiresAt: Date.now() + 3600000, epoch: 1, userEpoch: 1 };
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(data)), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(part => part.toString('base64url')).join('.');
}

function makeStory(overrides = {}) {
  const now = '2026-10-27T00:00:00.000Z';
  const branch = { id: 'branch-main', parentId: null, name: '主线', content: '', createdAt: now, updatedAt: now };
  return { id: 'story-local-fixture', title: '雾港来信', model: 'sol', genre: '奇幻 · 成长', synopsis: '', lorebook: '', specializedPrompt: true, activeBranchId: branch.id, branches: [branch], createdAt: now, updatedAt: now, ...overrides };
}

async function setup(browser, viewport, audit) {
  const context = await browser.newContext({ viewport, isMobile: viewport.width < 1024, hasTouch: viewport.width < 1024, deviceScaleFactor: 1 });
  await context.addCookies([{ name: 'lfn_session', value: testCookie(process.env.LFN_UI_TEST_SESSION_SECRET), url: baseURL }]);
  await context.addInitScript(() => {
    localStorage.setItem('lfn-onboarding-v1', 'done');
    localStorage.setItem('lfn-guide-launcher-visible', 'false');
    localStorage.setItem('lfn-mobile-onboarding-v1', 'done');
    localStorage.setItem('lfn-mobile-guide-launcher-visible', 'false');
    localStorage.setItem('lfn-ui-preferences-v1', JSON.stringify({ version: 1, theme: 'paper', workspaceLayout: 'lfn' }));
    localStorage.setItem('lfn-mobile-ui-preferences-v1', JSON.stringify({ version: 1, theme: 'paper', workspaceLayout: 'lfn' }));
  });
  let story = null;
  let branchNumber = 1;
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== new URL(baseURL).origin) {
      audit.externalRequests.push({ url: url.href, method: request.method() });
      return route.abort('blockedbyclient');
    }
    if (!url.pathname.startsWith('/api/')) return route.fallback();
    const method = request.method();
    const body = ['POST', 'PUT', 'PATCH'].includes(method) ? request.postDataJSON() || {} : {};
    const respond = (json, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(json) });
    if (method !== 'GET' && method !== 'HEAD') {
      const entry = { path: url.pathname, method, body };
      audit.apiWrites.push(entry);
      if (url.pathname === '/api/stories' && method === 'POST') {
        story = makeStory({ title: body.title || '新故事', genre: body.genre || '' });
        audit.fixtureCalls.push({ kind: 'create-story', storyId: story.id });
        return respond({ story }, 201);
      }
      const storyId = url.pathname.match(/^\/api\/stories\/([^/]+)$/)?.[1];
      if (storyId === 'story-local-fixture' && method === 'PUT' && story) {
        if (body.branch) story.branches = story.branches.map(item => item.id === body.branch.id ? { ...item, ...body.branch } : item);
        story = { ...story, ...Object.fromEntries(Object.entries(body).filter(([key]) => key !== 'branch')) };
        return respond({ story });
      }
      if (url.pathname === '/api/stories/story-local-fixture/branches' && method === 'POST' && story) {
        const source = story.branches.find(item => item.id === body.sourceBranchId) || story.branches[0];
        const branch = { ...source, id: `branch-alt-${branchNumber}`, parentId: source.id, name: `分支 ${branchNumber++}` };
        story = { ...story, activeBranchId: branch.id, branches: [...story.branches, branch] };
        audit.fixtureCalls.push({ kind: 'create-branch', from: source.id, branchId: branch.id });
        return respond({ story }, 201);
      }
      if (url.pathname === '/api/stories/story-local-fixture/generate' && method === 'POST' && story) {
        const generated = '门外传来熟悉的三声敲击。';
        story = { ...story, activeBranchId: body.branchId, branches: story.branches.map(item => item.id === body.branchId ? { ...item, content: `${body.content}${generated}` } : item) };
        audit.fixtureCalls.push({ kind: 'generate-text', mode: body.mode, model: story.model });
        return respond({ story, generated, content: story.branches.find(item => item.id === body.branchId).content });
      }
      audit.unexpectedWrites.push(entry);
      return respond({ message: 'Stories tutorial audit blocked this write.' }, 409);
    }
    const data = {
      '/api/me': { authenticated: true, user: { id: 7777766, username: 'stories-tutorial-audit', displayName: '本地审计', display_name: '本地审计', group: 'default' } },
      '/api/announcements': { items: [] },
      '/api/wallet': { newApi: { balance: 0 }, aff: { enabled: false } },
      '/api/aff/ledger': { transactions: [] },
      '/api/aff/referral': { enabled: false, link: null, invitedCount: 0, registrationReward: 0 },
      '/api/redeem/history': { items: [] },
      '/api/stories': { items: story ? [story] : [] },
      '/api/stories/models': { items: [{ id: 'sol', label: 'Sol', source: '本地模型 fixture' }, { id: 'luna', label: 'Luna', source: '本地模型 fixture' }] },
      '/api/admin': { admin: false },
    }[url.pathname] || { items: [] };
    return respond(data);
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(90000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.stack || error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  return { context, page, errors, getStory: () => story };
}

async function openTutorial(page) {
  await page.goto(`${baseURL}/profile#profile-tutorials`, { waitUntil: 'domcontentloaded' });
  const card = page.locator('[data-tutorial-id="stories"]');
  await card.waitFor({ state: 'visible' });
  await card.getByRole('button', { name: '故事创作、续写与分支：手把手教程', exact: true }).click();
  await page.locator('[data-testid="feature-tutorial"]').waitFor({ state: 'visible' });
  await page.waitForURL(/\/stories(?:\?|$)/);
}

async function verifyTarget(page, index, device) {
  await page.locator('.feature-tutorial-panel h2').getByText(titles[index], { exact: true }).waitFor();
  await page.waitForFunction(expected => {
    const marked = [...document.querySelectorAll('[data-feature-tutorial-target="true"]')];
    return marked.length === 1 && expected.some(selector => marked[0].matches(selector)) && marked[0].getBoundingClientRect().width > 0;
  }, selectors[index]);
  const target = page.locator('[data-feature-tutorial-target="true"]');
  const state = await target.evaluate((element, expected) => {
    const rect = element.getBoundingClientRect();
    const spotlight = document.querySelector('.feature-tutorial-spotlight')?.getBoundingClientRect();
    const center = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return {
      matched: expected.some(selector => element.matches(selector)),
      text: (element.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').trim().slice(0, 120),
      box: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      spotlightAligned: Boolean(spotlight && Math.abs(spotlight.x - Math.max(4, rect.x - 4)) < 2 && Math.abs(spotlight.y - Math.max(4, rect.y - 4)) < 2),
      centerHit: Boolean(center && (center === element || element.contains(center))),
      keywords: [...document.querySelectorAll('.feature-tutorial-body mark.tutorial-keyword')].map(item => item.textContent),
    };
  }, selectors[index]);
  assert(state.matched && state.box.width > 0 && state.box.height > 0, `${device} step ${index + 1}: target is visible`);
  assert(state.spotlightAligned, `${device} step ${index + 1}: spotlight follows target`);
  assert(state.centerHit, `${device} step ${index + 1}: target center is clickable`);
  assert(state.keywords.length, `${device} step ${index + 1}: key words are emphasized`);
  return state;
}

async function saveShot(page, index) {
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  const file = path.join(publicDir, `step-${String(index + 1).padStart(2, '0')}.png`);
  await page.screenshot({ path: file, animations: 'disabled' });
  const metadata = await sharp(file).metadata();
  assert.equal(metadata.width, 1440);
  assert.equal(metadata.height, 1000);
  return { file: `/tutorials/stories/${path.basename(file)}`, width: metadata.width, height: metadata.height };
}

async function collapseGuide(page) {
  await page.locator('.feature-tutorial-panel header button[aria-label="收起说明，继续操作"]').click();
}

async function expandGuide(page) {
  await page.locator('.feature-tutorial-panel header button[aria-label="展开教程说明"]').click();
}

async function runFlow(browser, viewport, audit) {
  const device = viewport.width < 1024 ? 'phone' : 'desktop';
  const { context, page, errors, getStory } = await setup(browser, viewport, audit);
  const flow = { viewport, device, steps: [], errors };
  try {
    await openTutorial(page);
    for (let index = 0; index < stepCount; index += 1) {
      if (index === 1) {
        const editor = page.locator('.story-prose-editor');
        await editor.fill('雾港的钟楼在午夜停摆，守塔人收到一封没有寄件人的信。');
        await page.waitForTimeout(900);
      }
      if (index === 2) {
        await page.getByLabel('本次生成指令').fill('让信件里的线索指向旧灯塔。');
      }
      if (index === 3) await page.getByRole('button', { name: '管理故事分支', exact: true }).click();
      const target = await verifyTarget(page, index, device);
      const screenshot = device === 'desktop' ? await saveShot(page, index) : undefined;
      flow.steps.push({ number: index + 1, title: titles[index], target, screenshot });
      if (index === 0) {
        await collapseGuide(page);
        if (device === 'desktop') {
          await page.getByRole('button', { name: '新故事', exact: true }).click();
          await page.getByRole('button', { name: /Storyteller/ }).click();
          await page.getByLabel('类型', { exact: true }).fill('奇幻 · 成长');
          await page.getByLabel('标签', { exact: true }).fill('雾港, 悬疑');
          await page.getByRole('button', { name: '创建故事', exact: true }).click();
        } else {
          await page.getByRole('button', { name: '新故事' }).click();
          await page.getByLabel('故事标题').fill('雾港来信');
          await page.getByLabel('类型', { exact: true }).fill('奇幻 · 成长');
          await page.getByLabel('标签', { exact: true }).fill('雾港, 悬疑');
          await page.getByRole('button', { name: '创建故事', exact: true }).click();
        }
        await page.locator('.story-prose-editor').waitFor({ state: 'visible' });
      }
      if (index === 1) {
        if (device === 'phone') await page.getByRole('button', { name: '打开设置', exact: true }).click();
        const model = page.getByLabel('故事 AI 模型', { exact: true });
        await model.waitFor({ state: 'visible' });
        assert((await page.locator('.story-prose-editor').inputValue()).includes('雾港的钟楼'), 'opening paragraph is in the active story');
        assert(await model.isVisible(), 'story model selector is available');
        if (device === 'desktop') await page.locator('.story-settings-drawer .story-settings-close').click();
        else await page.getByRole('button', { name: '关闭故事设置', exact: true }).click();
        await page.getByRole('button', { name: '我已了解，下一步', exact: true }).click();
      }
      if (index === 2) {
        const response = page.waitForResponse(r => r.url().includes('/api/stories/story-local-fixture/generate') && r.request().method() === 'POST');
        await page.getByRole('button', { name: device === 'phone' ? '生成故事' : '发送', exact: true }).click();
        await response;
        await page.getByText('门外传来熟悉的三声敲击。', { exact: false }).waitFor();
        assert(getStory().branches[0].content.includes('门外传来熟悉的三声敲击。'), 'local fixture text was applied to story');
        await page.getByRole('button', { name: '我已了解，下一步', exact: true }).click();
      }
      if (index === 3) {
        await page.getByRole('button', { name: /从当前正文创建分支|新分支/ }).click();
        await page.getByRole('button', { name: '管理故事分支', exact: true }).click();
        await page.getByText('分支 1', { exact: true }).waitFor();
        assert.equal(getStory().branches.length, 2, 'fixture branch exists alongside the main line');
        if (device === 'phone') await page.getByRole('button', { name: '关闭故事分支', exact: true }).click();
        else await page.getByRole('button', { name: '管理故事分支', exact: true }).click();
        await page.getByRole('button', { name: '完成教程，返回教程中心', exact: true }).click();
        await page.waitForURL(/\/profile#profile-tutorials/);
        await page.locator('[data-tutorial-id="stories"] .tutorial-completed').waitFor();
        flow.completedAndReturned = true;
      }
      if (index === 0) {
        await expandGuide(page);
        await page.getByRole('button', { name: '我已了解，下一步', exact: true }).click();
      }
    }
    assert.deepEqual(errors, [], `${device} browser errors: ${errors.join('\n')}`);
    return flow;
  } catch (error) {
    flow.failure = error.stack || error.message;
    try { flow.failureUrl = page.url(); flow.failureText = (await page.locator('body').innerText()).slice(0, 3000); } catch {}
    throw Object.assign(error, { auditResult: flow });
  } finally { await context.close(); }
}

async function earlyExit(browser, audit) {
  const { context, page } = await setup(browser, { width: 1440, height: 1000 }, audit);
  try {
    await openTutorial(page);
    await page.locator('.feature-tutorial-panel footer button').last().click();
    await page.locator('.feature-tutorial-panel h2').getByText(titles[1], { exact: true }).waitFor();
    await page.locator('.feature-tutorial-exit').click();
    await page.waitForURL(/\/profile#profile-tutorials/);
    await page.locator('[data-tutorial-id="stories"]').waitFor({ state: 'visible' });
    return { midTutorial: true, returnedTo: page.url() };
  } finally { await context.close(); }
}

async function auditArticle(browser, audit) {
  const { context, page, errors } = await setup(browser, { width: 1440, height: 1000 }, audit);
  try {
    await page.goto(`${baseURL}/profile#profile-tutorials`, { waitUntil: 'domcontentloaded' });
    await page.locator('[data-tutorial-id="stories"]').getByRole('button', { name: '故事创作、续写与分支：图文教程', exact: true }).click();
    const steps = page.locator('.tutorial-article-step');
    const images = page.locator('img[data-tutorial-shot]');
    assert.equal(await steps.count(), stepCount);
    assert.equal(await images.count(), stepCount);
    for (const image of await images.all()) {
      await image.scrollIntoViewIfNeeded();
      await page.waitForFunction(element => element.complete && element.naturalWidth === 1440 && element.naturalHeight === 1000, await image.elementHandle());
      await image.evaluate(element => element.decode());
    }
    const emphasizedTerms = await steps.locator('mark.tutorial-keyword').count();
    assert(emphasizedTerms >= stepCount);
    assert.deepEqual(errors, [], `article browser errors: ${errors.join('\n')}`);
    return { stepCount: await steps.count(), screenshotCount: await images.count(), emphasizedTerms };
  } finally { await context.close(); }
}

(async () => {
  fs.mkdirSync(publicDir, { recursive: true });
  for (const file of fs.readdirSync(publicDir)) if (/^step-\d{2}\.png$/.test(file) || file === 'audit.json') fs.unlinkSync(path.join(publicDir, file));
  const audit = { auditedAt: new Date().toISOString(), baseURL, method: 'Local Microsoft Edge; fake session; in-memory route fixtures for every story write and model response; external requests blocked', externalRequests: [], apiWrites: [], unexpectedWrites: [], fixtureCalls: [], desktop: null, phone: null, article: null, earlyExit: null };
  const browser = await chromium.launch({ headless: true, channel: process.env.LFN_UI_BROWSER_CHANNEL || 'msedge' });
  try {
    audit.desktop = await runFlow(browser, { width: 1440, height: 1000 }, audit);
    console.log('PASS stories desktop create, continue, branch, completion flow');
    audit.phone = await runFlow(browser, { width: 390, height: 844 }, audit);
    console.log('PASS stories 390x844 mobile create, continue, branch, completion flow');
    audit.article = await auditArticle(browser, audit);
    console.log('PASS stories article images loaded and step text emphasized');
    audit.earlyExit = await earlyExit(browser, audit);
    console.log('PASS stories mid-tutorial exit returned to tutorial center');
    assert.equal(audit.fixtureCalls.filter(call => call.kind === 'create-story').length, 2);
    assert.equal(audit.fixtureCalls.filter(call => call.kind === 'generate-text').length, 2);
    assert.equal(audit.fixtureCalls.filter(call => call.kind === 'create-branch').length, 2);
    assert.deepEqual(audit.unexpectedWrites, [], 'no non-fixture API writes');
    assert.deepEqual(audit.externalRequests, [], 'no external requests attempted');
    audit.zeroUnexpectedApiWrites = true;
    audit.zeroExternalRequests = true;
    audit.zeroBrowserErrors = true;
    fs.writeFileSync(path.join(publicDir, 'audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
    console.log('PASS zero unexpected writes, external requests, and browser errors');
  } catch (error) {
    audit.failure = error.stack || error.message;
    if (error.auditResult) audit.failedFlow = error.auditResult;
    fs.writeFileSync(path.join(publicDir, 'audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
    throw error;
  } finally { await browser.close(); }
})().catch(error => { console.error(error.stack || error); process.exitCode = 1; });
