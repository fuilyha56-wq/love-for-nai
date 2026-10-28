/* eslint-disable @typescript-eslint/no-require-imports */
/* Launcher-style assistant UI: isolated session, synthetic references and fully mocked model calls. */
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
process.env.LFN_UI_BASE_URL ||= 'http://127.0.0.1:3100';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const output = path.resolve('.tmp/assistant-panel-ui'); fs.mkdirSync(output, { recursive: true });
const matrix = [[390, 'lfn', 'paper'], [1023, 'lfn', 'paper'], [1191, 'lfn', 'paper'], [1440, 'lfn', 'nai'], [1366, 'nlw', 'paper'], [1440, 'custom', 'paper'], [1440, 'custom', 'nai'], [1366, 'lfn', 'glass'], [390, 'lfn', 'paper', 500]];
const results = [], errors = [];
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN3cAAAAASUVORK5CYII=', 'base64');
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const [width, workspaceLayout, theme, height = 884] of matrix.filter(([width, , , height = 884]) => !process.env.LFN_ASSISTANT_UI_CASE || process.env.LFN_ASSISTANT_UI_CASE === `${width}x${height}`)) {
      const name = `${theme}-${workspaceLayout}-${width}${height === 884 ? '' : 'x' + height}`;
      const { context, page } = await setup(browser, { theme, workspaceLayout }, { width, height });
      page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
      const requests = []; let conversation = []; let polls = 0;
      const prompt = 'cloud, blue sky, soft light, ' + 'detailed clouds, '.repeat(60);
      const suggestion = { prompt, negativePrompt: 'lowres, blurry', message: '保留画面的主体与构图，整理了天空、云层和光线描述。你可以先查看提示词，再决定是否应用。', tags: [{ name: 'cloud', displayName: '云', categoryName: '通用', postCount: 1000 }], characters: [{ prompt: 'white hair', centerX: .4, centerY: .5 }], parameters: { steps: 28, scale: 5 } };
      const usage = [{ id: 'fixture-call', requestId: 'fixture-request', inputTokens: 1200, outputTokens: 300, totalTokens: 1500, cachedInputTokens: 100, reasoningTokens: 50, quota: 5000, balanceCost: .01, billing: 'settled' }];
      await context.route('**/api/assistant/**', route => {
        const req = route.request(), url = new URL(req.url());
        if (url.pathname.endsWith('/models')) return route.fulfill({ json: { models: ['deepseek-v4-pro', 'gemini-3.8-flash'] } });
        if (url.pathname.endsWith('/usage')) return route.fulfill({ json: { jobs: {}, images: [] } });
        if (req.method() === 'POST') { requests.push(req.postDataJSON()); return route.fulfill({ json: { jobId: 'fixture-job' } }); }
        if (url.searchParams.has('job')) {
          polls++;
          const steps = [{ tool: 'search_danbooru_tags', query: 'cloud', ok: true, summary: '找到云层相关词条' }];
          if (polls === 1) return route.fulfill({ json: { status: 'running', steps, usage } });
          conversation = [{ id: 'fixture-job', request: requests[0].request, createdAt: new Date().toISOString(), ...suggestion, rejectedTags: [], unverifiedTags: [], steps, usage }];
          return route.fulfill({ json: { status: 'done', suggestion, steps, usage } });
        }
        return route.fulfill({ json: { turns: conversation, tagPool: conversation.length ? suggestion.tags : [] } });
      });
      try {
        await page.goto(baseURL + '/image');
        await page.locator(width < 1024 ? '.mobile-studio-workbar:visible' : theme === 'nai' && workspaceLayout !== 'custom' ? '[data-studio-layout="nai"]:visible' : `[data-workspace-layout="${workspaceLayout}"]:visible`).waitFor();
        if (width < 1024) await page.getByRole('button', { name: '打开标签助手', exact: true }).click();
        else if (!await page.getByRole('textbox', { name: '标签助手输入', exact: true }).isVisible()) await page.getByRole('button', { name: '展开聊天', exact: true }).click();
        const panel = page.locator('.tag-assistant-panel:visible'); await panel.waitFor();
        assert.equal(await panel.count(), 1);
        assert.equal(await panel.getAttribute('data-assistant-layout'), 'launcher');
        const input = panel.getByRole('textbox', { name: '标签助手输入', exact: true });
        await panel.getByRole('button', { name: '智能助手模型', exact: true }).filter({ hasText: 'deepseek-v4-pro' }).waitFor();
        assert.match(await input.evaluate(el => getComputedStyle(el).fontFamily), /^"?Noto Sans SC"?, sans-serif$/);
        assert.equal(await panel.locator('select').count(), 0);
        let root = await panel.boundingBox(), editor = await input.boundingBox(), composer = await panel.locator('.assistant-composer').boundingBox();
        assert(editor.y > root.y + (height > 650 ? root.height / 2 : 20), 'Composer stays below the header');
        assert(composer.y + composer.height <= root.y + root.height + 1);
        assert(composer.y + composer.height <= height);
        assert(editor.height < 130);
        await page.screenshot({ path: path.join(output, `${name}-empty.png`) });
        await panel.getByRole('button', { name: '助手设置', exact: true }).click();
        const settings = panel.getByRole('region', { name: '助手设置', exact: true });
        await settings.waitFor(); assert.match(await settings.innerText(), /10 张参考图/);
        await page.keyboard.press('Escape'); await settings.waitFor({ state: 'hidden' });
        await panel.getByRole('button', { name: '展开助手输入框', exact: true }).click();
        assert((await input.boundingBox()).height > editor.height);
        await panel.getByRole('button', { name: '收起助手输入框', exact: true }).click();
        await panel.locator('input[type=file]').setInputFiles([{ name: 'reference.png', mimeType: 'image/png', buffer: png }]);
        await panel.getByRole('button', { name: '移除参考图 1', exact: true }).waitFor();
        const attachedComposer = await panel.locator('.assistant-composer').boundingBox(), attachedRoot = await panel.boundingBox();
        assert(attachedComposer.y + attachedComposer.height <= attachedRoot.y + attachedRoot.height + 1, JSON.stringify(await panel.evaluate(el => ({ root: el.getBoundingClientRect().toJSON(), containerType: getComputedStyle(el).containerType, textarea: el.querySelector('textarea').getBoundingClientRect().toJSON(), form: el.querySelector('form').getBoundingClientRect().toJSON(), composerHeight: el.style.getPropertyValue('--assistant-composer-height') }))));
        await input.fill('请整理画面中的云和天空');
        await input.dispatchEvent('keydown', { key: 'Enter', code: 'Enter', isComposing: true });
        assert.equal(requests.length, 0, 'IME confirmation must not submit');
        await input.press('Shift+Enter'); assert.match(await input.inputValue(), /\n/);
        await input.press('Enter');
        await panel.getByRole('button', { name: '应用全部', exact: true }).waitFor({ timeout: 30000 });
        assert.equal(requests.length, 1); assert.equal(requests[0].images.length, 1); assert.equal(requests[0].reasoningEffort, 'high');
        const preview = panel.locator('.assistant-prompt-preview').filter({ hasText: '正向提示词' });
        await preview.getByRole('button', { name: '展开', exact: true }).click({ timeout: height < 650 ? 5000 : 30000 });
        assert.equal(await preview.locator('p').innerText(), prompt);
        await preview.getByRole('button', { name: '收起', exact: true }).click({ timeout: height < 650 ? 5000 : 30000 });
        for (const label of ['替换提示词', '追加标签', '替换负向词', '应用参数', '放弃建议']) assert.equal(await panel.getByRole('button', { name: label, exact: true }).count(), 1);
        const meter = panel.getByRole('region', { name: '助手上下文与消耗', exact: true });
        assert.match(await meter.innerText(), /1,200 tokens/);
        assert.match(await meter.innerText(), /0\.01 余额/);
        await meter.getByRole('button', { name: '展开用量明细', exact: true }).click();
        await meter.getByRole('button', { name: '刷新账单', exact: true }).waitFor();
        await meter.getByRole('button', { name: '收起用量明细', exact: true }).click();
        const transcript = panel.locator('.assistant-transcript');
        if (await transcript.evaluate(el => el.scrollHeight > el.clientHeight + 72)) {
          await transcript.evaluate(el => { el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); });
          const jump = panel.getByRole('button', { name: '跳到最新消息', exact: true }); await jump.waitFor();
          const jumpBox = await jump.boundingBox(), transcriptBox = await transcript.boundingBox();
          assert(jumpBox.y + jumpBox.height <= transcriptBox.y + transcriptBox.height + 1, JSON.stringify({ jumpBox, transcriptBox, composerHeight: await panel.evaluate(el => el.style.getPropertyValue('--assistant-composer-height')), root: await panel.boundingBox() }));
          await jump.click();
          assert(await transcript.evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight < 2));
        }
        composer = await panel.locator('.assistant-composer').boundingBox(); root = await panel.boundingBox();
        assert(composer.y + composer.height <= root.y + root.height + 1);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        await page.screenshot({ path: path.join(output, `${name}-reply.png`) });
        await panel.getByRole('button', { name: '应用全部', exact: true }).click();
        await input.fill('再检查一次'); await input.press('Enter');
        await page.waitForTimeout(300); assert.equal(requests.length, 2); assert.match(requests[1].currentPrompt, /cloud, blue sky/);
        results.push({ name, passed: true }); console.log('PASS ' + name);
      } catch (error) {
        if (height < 650) console.error('GEOMETRY ' + JSON.stringify(await page.locator('.tag-assistant-panel:visible').evaluate(el => ({ root: el.getBoundingClientRect().toJSON(), containerType: getComputedStyle(el).containerType, transcript: el.querySelector('.assistant-transcript').getBoundingClientRect().toJSON(), textarea: el.querySelector('textarea').getBoundingClientRect().toJSON(), form: el.querySelector('form').getBoundingClientRect().toJSON(), composerHeight: el.style.getPropertyValue('--assistant-composer-height') }))));
        results.push({ name, passed: false, error: error.stack }); await page.screenshot({ path: path.join(output, `${name}-failed.png`) }); console.error('FAIL ' + name + ': ' + error.message);
      }
      finally { await context.close(); }
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify({ results, errors }, null, 2)); }
  if (errors.length || results.some(result => !result.passed)) process.exitCode = 1;
})();
