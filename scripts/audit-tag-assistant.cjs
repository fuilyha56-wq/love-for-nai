/* Local browser audit for the tag-assistant tutorial. All assistant responses are fixtures. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadTutorialCatalog } = require('./tutorial-test-support.cjs');
process.env.LFN_UI_BASE_URL ||= 'http://localhost:3010';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const output = path.resolve('public/tutorials/tag-assistant');
fs.mkdirSync(output, { recursive: true });
const catalog = loadTutorialCatalog();
const tutorial = catalog.featureTutorials.find(item => item.id === 'tag-assistant');
assert(tutorial, 'tag-assistant must exist in the tutorial catalog');
const perStepCount = tutorial.steps.filter(step => step.screenshot?.src.startsWith('/tutorials/tag-assistant/step-')).length;
assert.equal(perStepCount, tutorial.steps.length, 'Each catalog step must have exactly one illustrated screenshot');
const runtimeErrors = [];
const audit = { tutorialId: tutorial.id, catalogStepCount: tutorial.steps.length, illustratedStepCount: perStepCount, fixture: 'local-assistant-route', externalRequestsBlocked: true, scenarios: [], requests: [] };
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=', 'base64');
const fixtureSuggestion = {
  message: '本机审计示例：人物与背景识别完成。请逐项核对后再采用。',
  prompt: '1girl, silver hair, blue eyes, garden, sunlight',
  negativePrompt: 'blurry, low quality',
  tags: [
    { name: '1girl', category: 0, categoryName: '通用', postCount: 1200000 },
    { name: 'silver_hair', category: 0, categoryName: '通用', postCount: 32000 },
    { name: 'garden', category: 0, categoryName: '通用', postCount: 18000 },
  ],
  characters: [], parameters: {}, imageModel: null, modelProtocol: null,
};

function activeTarget(page) {
  return page.locator('[data-feature-tutorial-target]').first();
}
async function verifySpotlight(page, index) {
  await page.waitForFunction(() => Boolean(document.querySelector('.feature-tutorial-spotlight')));
  const target = activeTarget(page);
  assert.equal(await target.count(), 1, `Step ${index + 1}: tutorial must mark a real target element`);
  assert(await target.isVisible(), `Step ${index + 1}: highlighted target must be visible`);
  const box = await target.boundingBox();
  assert(box && box.width > 0 && box.height > 0, `Step ${index + 1}: highlighted control must have usable bounds`);
  const panel = await page.locator('.feature-tutorial-panel').boundingBox();
  const clearOfPanel = panel && (box.x + box.width <= panel.x || box.x >= panel.x + panel.width || box.y + box.height <= panel.y || box.y >= panel.y + panel.height);
  const shot = await page.locator('.feature-tutorial-spotlight').evaluate(el => ({ top: parseFloat(el.style.top), left: parseFloat(el.style.left), width: parseFloat(el.style.width), height: parseFloat(el.style.height) }));
  assert(shot.width > 0 && shot.height > 0, `Step ${index + 1}: spotlight must cover the actual target`);
  const overlaps = shot.left <= box.x + box.width && shot.left + shot.width >= box.x && shot.top <= box.y + box.height && shot.top + shot.height >= box.y;
  assert(overlaps, `Step ${index + 1}: spotlight does not overlap its actionable target`);
  const pointer = await page.evaluate(() => {
    const element = document.querySelector('[data-feature-tutorial-target]');
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
    return { hit: hit ? `${hit.tagName.toLowerCase()}${hit.id ? `#${hit.id}` : ''}.${[...hit.classList].join('.')}` : null, reachesTarget: Boolean(hit && (hit === element || element.contains(hit))) };
  });
  assert(pointer?.reachesTarget, `Step ${index + 1}: target center must hit its real control (hit=${pointer?.hit}, target=${JSON.stringify(box)}, panel=${JSON.stringify(panel)}, markup=${await target.evaluate(el => el.outerHTML.slice(0, 500))})`);
  return { target: await target.evaluate(el => `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}.${[...el.classList].join('.')}`), bounds: box, spotlight: shot, clearOfPanel, pointer };
}
async function screenshot(page, filename) {
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: path.join(output, filename), animations: 'disabled' });
  const response = await page.request.get(`${baseURL}/tutorials/tag-assistant/${filename}`);
  assert.equal(response.status(), 200, `${filename} must load from the local app`);
  assert.equal(response.headers()['content-type']?.split(';')[0], 'image/png', `${filename} must be served as PNG`);
}
async function start(page) {
  if (page.viewportSize().width >= 1024) {
    await page.goto(`${baseURL}/image`);
    const agent = page.locator('[data-layout-module="agent"]').first();
    if (!(await agent.isVisible().catch(() => false))) {
      const open = page.getByRole('button', { name: '聊天助手', exact: true }).first();
      if (await open.count()) await open.evaluate(element => element.click());
      else await page.getByRole('button', { name: '展开聊天', exact: true }).evaluate(element => element.click());
      await agent.waitFor({ state: 'visible' });
    }
    await agent.waitFor({ state: 'visible' });
    if (!(await page.locator('.replica-dock-assistant.is-floating').isVisible().catch(() => false))) {
      await page.locator('.replica-dock-menu summary').click();
      await page.getByRole('menuitem', { name: '聊天在浮窗中打开', exact: true }).click();
      const heading = page.locator('.replica-dock-floating-heading');
      await heading.waitFor({ state: 'visible' });
      const box = await heading.boundingBox();
      assert(box, 'Desktop assistant floating window must be draggable');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(30, 100, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(200);
    }
  }
  await page.goto(`${baseURL}/profile#profile-tutorials`);
  await page.getByRole('heading', { name: '选择你想学习的功能' }).waitFor();
  await page.locator('[data-tutorial-id="tag-assistant"]').getByRole('button', { name: /：手把手教程$/ }).click();
  await page.waitForURL('**/image');
  await page.locator('.feature-tutorial-panel h2').getByText(tutorial.steps[0].title, { exact: true }).waitFor();
}
async function ensureAssistantOpen(page, mobile) {
  if (mobile) {
    const dialog = page.locator('.mobile-studio-workspace-dialog');
    if (await dialog.count() && !(await dialog.locator('[data-workspace-pane="assistant"]').isVisible().catch(() => false))) {
      const open = page.getByRole('button', { name: '打开标签助手', exact: true });
      if (await open.count()) await open.click();
    }
  } else {
    const agent = page.locator('[data-layout-module="agent"]').first();
    if (!(await agent.isVisible().catch(() => false))) {
      const button = page.getByRole('button', { name: '聊天助手', exact: true }).first();
      if (await button.count()) await button.click();
      else {
        const expand = page.getByRole('button', { name: '展开聊天', exact: true }).first();
        if (await expand.count()) await expand.click();
      }
    }
  }
  await page.waitForTimeout(350);
}
async function next(page) {
  const before = await page.locator('.feature-tutorial-panel h2').textContent();
  await page.locator('.feature-tutorial-panel footer').getByRole('button', { name: /我已了解，下一步/ }).click();
  await page.waitForFunction(previous => document.querySelector('.feature-tutorial-panel h2')?.textContent !== previous, before);
}
async function runViewport(browser, width, height, label) {
  const mobile = width < 1024;
  const requestStart = audit.requests.length;
  const { context, page, requests } = await setup(browser, { theme: 'paper', workspaceLayout: 'lfn' }, { width, height });
  const targetRecords = [];
  page.setDefaultTimeout(18000);
  page.setDefaultNavigationTimeout(90000);
  page.on('pageerror', error => runtimeErrors.push(`${label}: ${error.stack || error.message}`));
  page.on('request', request => {
    const url = new URL(request.url());
    audit.requests.push({ method: request.method(), path: url.pathname, host: url.hostname });
  });
  page.on('response', async response => {
    if (new URL(response.url()).pathname === '/api/assistant/models') {
      let body = null;
      try { body = await response.json(); } catch { /* response may not contain JSON */ }
      (audit.modelResponses ||= []).push({ status: response.status(), body });
    }
  });
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    if (!['localhost', '127.0.0.1'].includes(url.hostname)) return route.abort('blockedbyclient');
    return route.fallback();
  });
  await context.route('**/api/assistant/tags**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST' && !url.search) return route.fulfill({ status: 200, json: { jobId: 'tag-assistant-local-fixture' } });
    if (request.method() === 'GET' && url.searchParams.get('job') === 'tag-assistant-local-fixture') return route.fulfill({ status: 200, json: { status: 'done', suggestion: fixtureSuggestion, steps: [{ label: '本机 fixture', status: 'done' }] } });
    if (request.method() !== 'GET') return route.fulfill({ status: 409, json: { message: 'Only the local assistant route fixture is allowed in this audit.' } });
    return route.fallback();
  });
  await context.route('**/api/assistant/models', route => route.fulfill({ status: 200, json: { models: ['nai-chat'] } }));
  await context.route('**/api/**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'GET' && url.pathname === '/api/assistant/models') return route.fulfill({ status: 200, json: { models: ['nai-chat'] } });
    if (request.method() !== 'GET' && url.pathname !== '/api/assistant/tags') {
      return route.fulfill({ status: 409, json: { message: 'Audit blocked all non-assistant API writes.' } });
    }
    return route.fallback();
  });
  await page.route('**/api/assistant/tags**', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() === 'POST' && !url.search) return route.fulfill({ status: 200, json: { jobId: 'tag-assistant-local-fixture' } });
    if (request.method() === 'GET' && url.searchParams.get('job') === 'tag-assistant-local-fixture') return route.fulfill({ status: 200, json: { status: 'done', suggestion: fixtureSuggestion, steps: [{ label: '本机 fixture', status: 'done' }] } });
    if (request.method() !== 'GET') return route.fulfill({ status: 409, json: { message: 'Only the local assistant route fixture is allowed in this audit.' } });
    return route.fallback();
  });
  await page.route('**/api/assistant/models', route => { audit.modelFixtureIntercepts = (audit.modelFixtureIntercepts || 0) + 1; return route.fulfill({ status: 200, json: { models: ['nai-chat'] } }); });
  try {
    await start(page);
    await ensureAssistantOpen(page, mobile);
    const activeAgent = mobile
      ? page.locator('.mobile-studio-workspace-dialog [data-layout-module="agent"]').first()
      : page.locator('.replica-dock-assistant [data-layout-module="agent"]').first();
    if (!(await activeAgent.innerText()).includes('nai-chat')) {
      await activeAgent.getByRole('button', { name: '刷新', exact: true }).click();
      await activeAgent.getByText('nai-chat', { exact: false }).waitFor({ timeout: 5000 });
    }
    for (let index = 0; index < tutorial.steps.length; index += 1) {
      const expected = tutorial.steps[index];
      await page.locator('.feature-tutorial-panel h2').getByText(expected.title, { exact: true }).waitFor();
      await page.waitForTimeout(300);
      targetRecords.push({ step: index + 1, title: expected.title, ...(await verifySpotlight(page, index)) });
      if (index === 1) {
        await activeAgent.locator('input[aria-label="上传识图图片"]').setInputFiles({ name: 'tag-assistant-fixture.png', mimeType: 'image/png', buffer: png });
        await page.getByRole('textbox', { name: '标签助手输入', exact: true }).fill('识别人物服装、发色和背景标签，并按主题整理。');
        await activeAgent.locator('img[alt="待识图图片缩略图"]').waitFor();
      }
      if (index === 2) {
        await page.locator('.assistant-preview').waitFor({ state: 'detached' });
        await activeAgent.getByText('nai-chat', { exact: false }).waitFor();
        const submit = activeAgent.locator('button[type="submit"]');
        await submit.getByText('让助手处理', { exact: true }).click();
        await activeAgent.locator('.assistant-preview').waitFor({ timeout: 12000 }).catch(async error => { throw new Error(`${error.message}; assistant UI=${(await activeAgent.innerText()).slice(-1400)}; assistant requests=${JSON.stringify(audit.requests.filter(item => item.path.startsWith('/api/assistant/')))} `); });
        assert((await activeAgent.locator('.assistant-preview').innerText()).includes('silver_hair'));
      }
      const stepName = `step-${String(index + 1).padStart(2, '0')}.png`;
      await screenshot(page, `${label === 'desktop' ? '' : 'mobile-'}${stepName}`);
      if (index < tutorial.steps.length - 1) {
        await next(page);
        if (index === 0) await ensureAssistantOpen(page, mobile);
      }
      if (index === 3) {
        await activeAgent.getByRole('button', { name: '追加标签', exact: true }).click();
        if (mobile) {
          const prompts = await page.locator('textarea').evaluateAll(elements => elements.map(element => element.value));
          assert(prompts.some(value => value.includes('silver_hair')), `Fixture tags must be added to the mobile workbench prompt: ${JSON.stringify(prompts)}`);
        } else {
          const prompt = page.locator('[data-tutorial="prompt"] textarea, .replica-prompt textarea, [data-layout-module="prompt"] textarea').filter({ visible: true }).first();
          assert((await prompt.inputValue()).includes('silver_hair'), 'Fixture tags must be added to the actual prompt input');
        }
      }
    }
    const scenarioRequests = audit.requests.slice(requestStart);
    assert.equal(scenarioRequests.filter(request => request.method !== 'GET' && request.path !== '/api/assistant/tags').length, 0, 'No non-assistant API write may be attempted');
    assert.equal(scenarioRequests.filter(request => request.method === 'POST' && request.path === '/api/assistant/tags').length, 1, 'Exactly one assistant request must use the local fixture');
    await page.locator('.feature-tutorial-panel').getByRole('button', { name: '完成教程，返回教程中心', exact: true }).click();
    await page.waitForURL('**/profile#profile-tutorials');
    await page.locator('#tutorial-center-content').waitFor();
    audit.scenarios.push({ viewport: label, flow: 'complete-return', passed: true, targets: targetRecords });

    await start(page);
    await ensureAssistantOpen(page, mobile);
    await next(page);
    await page.locator('.feature-tutorial-panel').getByRole('button', { name: '退出教程，返回个人资料的教程中心', exact: true }).click();
    await page.waitForURL('**/profile#profile-tutorials');
    await page.locator('#tutorial-center-content').waitFor();
    audit.scenarios.push({ viewport: label, flow: 'midway-exit-return', passed: true });
  } finally {
    await context.close();
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    await runViewport(browser, 1440, 1000, 'desktop');
    await runViewport(browser, 390, 844, 'mobile');
  } finally {
    await browser.close();
    audit.runtimeErrors = runtimeErrors;
    audit.fixtureRequests = audit.requests.filter(request => request.path === '/api/assistant/tags');
    audit.screenshotFiles = fs.readdirSync(output).filter(name => name.endsWith('.png')).sort();
    fs.writeFileSync(path.join(output, 'audit.json'), `${JSON.stringify(audit, null, 2)}\n`);
  }
  assert.equal(runtimeErrors.length, 0, runtimeErrors.join('\n'));
  console.log(JSON.stringify({ stepCount: tutorial.steps.length, illustrationCount: perStepCount, scenarios: audit.scenarios.map(item => `${item.viewport}:${item.flow}`), screenshotCount: audit.screenshotFiles.length, fixtureCalls: audit.fixtureRequests.filter(item => item.method === 'POST').length }));
})().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
