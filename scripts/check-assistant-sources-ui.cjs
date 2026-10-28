/* eslint-disable @typescript-eslint/no-require-imports -- Local isolated browser regression. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const output = path.resolve('.tmp/assistant-sources-ui'); fs.mkdirSync(output, { recursive: true });
const matrix = [[390, 'lfn', 'paper'], [1191, 'lfn', 'paper'], [1440, 'nai', 'nai'], [1366, 'nlw', 'paper'], [1440, 'custom', 'paper']];
const results = [], errors = [];
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [width, workspaceLayout, theme] of matrix) {
      const { context, page } = await setup(browser, { theme, workspaceLayout }, { width, height: 884 });
      const name = `${workspaceLayout}-${width}`, sent = []; let removed = false;
      page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
      await context.route('**/api/assistant/**', route => {
        const req = route.request(), url = new URL(req.url());
        if (url.pathname.endsWith('/models')) return route.fulfill({ json: { models: ['deepseek-v4-pro'], sources: [
          { id: 'newapi', name: 'NewAPI', models: [{ id: 'deepseek-v4-pro', groups: ['vip', 'gemini'] }] },
          ...removed ? [] : [{ id: 'fixture-custom', name: '自定义文本源', models: [{ id: 'deepseek-v4-pro', groups: [] }, { id: 'custom-chat', groups: [] }] }, { id: 'fixture-second', name: '第二模型源', models: [{ id: 'vision-chat', groups: [] }] }],
        ] } });
        if (url.pathname.endsWith('/usage')) return route.fulfill({ json: { jobs: {}, images: [] } });
        if (req.method() === 'POST') { sent.push(req.postDataJSON()); return route.fulfill({ json: { jobId: 'source-fixture' } }); }
        if (url.searchParams.has('job')) return route.fulfill({ json: { status: 'done', steps: [], usage: [], suggestion: { prompt: 'blue sky', negativePrompt: '', tags: [], parameters: {}, message: '完成' } } });
        return route.fulfill({ json: { turns: [], tagPool: [] } });
      });
      async function open() {
        const ready = page.waitForResponse(response => new URL(response.url()).pathname === '/api/assistant/models');
        await page.goto(baseURL + '/image');
        await ready;
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.locator(width < 1024 ? '.mobile-studio-workbar:visible' : theme === 'nai' && workspaceLayout !== 'custom' ? '[data-studio-layout="nai"]:visible' : `[data-workspace-layout="${workspaceLayout}"]:visible`).waitFor();
        if (width < 1024) {
          await page.locator('.mobile-studio-workbar:visible').waitFor();
          if (!await page.getByRole('textbox', { name: '标签助手输入', exact: true }).isVisible()) await page.getByRole('button', { name: '打开标签助手', exact: true }).click();
        }
        else if (!await page.getByRole('textbox', { name: '标签助手输入', exact: true }).isVisible()) await page.getByRole('button', { name: '展开聊天', exact: true }).click();
        await page.locator('.tag-assistant-panel:visible').getByRole('button', { name: '智能助手模型', exact: true }).waitFor();
      }
      try {
        await open();
        let panel = page.locator('.tag-assistant-panel:visible');
        const group = panel.getByRole('button', { name: '助手 NewAPI 分组', exact: true });
        await group.filter({ hasText: 'vip' }).waitFor();
        await panel.getByRole('button', { name: '智能助手模型', exact: true }).click();
        assert.match(await page.getByRole('listbox', { name: '智能助手模型', exact: true }).innerText(), /分组：vip \/ gemini/);
        await page.keyboard.press('Escape');
        await group.click(); await page.getByRole('option').filter({ hasText: /^gemini$/ }).click();
        let input = panel.getByRole('textbox', { name: '标签助手输入', exact: true });
        await input.fill('使用所选分组'); await input.press('Enter');
        await panel.getByRole('button', { name: '应用全部', exact: true }).waitFor();
        assert.equal(sent[0].assistantProviderId, 'newapi'); assert.equal(sent[0].assistantGroup, 'gemini');
        await panel.getByRole('button', { name: '自定义模型', exact: true }).click();
        assert.equal(await group.count(), 0);
        await panel.getByRole('button', { name: '助手自定义模型源', exact: true }).filter({ hasText: '自定义文本源' }).waitFor();
        await input.fill('使用我的模型源'); await input.press('Enter');
        await panel.getByRole('button', { name: '应用全部', exact: true }).waitFor();
        assert.equal(sent[1].assistantProviderId, 'fixture-custom'); assert.equal(sent[1].model, 'deepseek-v4-pro');
        assert.equal(sent[1].assistantGroup, undefined);
        await panel.getByRole('button', { name: '助手自定义模型源', exact: true }).click();
        await page.getByRole('option').filter({ hasText: /^第二模型源$/ }).click();
        await panel.getByRole('button', { name: '智能助手模型', exact: true }).filter({ hasText: 'vision-chat' }).waitFor();
        await open(); panel = page.locator('.tag-assistant-panel:visible');
        await panel.getByRole('button', { name: '助手自定义模型源', exact: true }).filter({ hasText: '第二模型源' }).waitFor();
        assert.match(await panel.getByRole('button', { name: '智能助手模型', exact: true }).innerText(), /vision-chat/);
        assert.equal(await panel.locator('select').count(), 0);
        assert.match(await panel.getByRole('button', { name: '自定义模型', exact: true }).evaluate(el => getComputedStyle(el).fontFamily), /Noto Sans SC/);
        const box = await panel.boundingBox(), form = await panel.locator('form').boundingBox();
        assert(form.y + form.height <= box.y + box.height + 1); assert(form.y + form.height <= 884);
        await page.screenshot({ path: path.join(output, `${name}.png`) });
        removed = true;
        await panel.getByRole('button', { name: '助手设置', exact: true }).click();
        await panel.getByRole('button', { name: '刷新模型列表', exact: true }).click();
        await panel.getByRole('button', { name: '关闭助手设置', exact: true }).click();
        await panel.getByRole('status').filter({ hasText: '原模型源已移除' }).waitFor();
        assert.equal(sent.length, 2);
        await panel.getByRole('button', { name: 'NewAPI', exact: true }).click();
        await panel.getByRole('button', { name: '助手 NewAPI 分组', exact: true }).waitFor();
        results.push({ name, groups: true, customRouting: true, persistence: true, removedSource: true, font: true });
      } catch (error) { await page.screenshot({ path: path.join(output, `${name}-failure.png`) }); console.error(name, await page.locator('.tag-assistant-panel:visible').count()); throw error; }
      finally { await context.close(); }
    }
    assert.deepEqual(errors, []);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({ results, errors }, null, 2));
    console.log(JSON.stringify({ results, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
