/* Browser regression for the persistent phone workspace; all API writes are intercepted. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const output = '.tmp/mobile-workspace';
fs.mkdirSync(output, { recursive: true });

async function switchPane(page, name) {
  await page.getByRole('navigation', { name: '工作面板', exact: true }).getByRole('button', { name, exact: true }).click();
}
async function geometry(page) {
  const result = await page.locator('.mobile-studio-workspace-dialog').evaluate(dialog => {
    const body = dialog.querySelector('[data-workspace-pane]:not([hidden])');
    const box = dialog.getBoundingClientRect();
    return { x: box.x, y: box.y, width: box.width, height: box.height, viewportWidth: innerWidth, viewportHeight: innerHeight,
      scrollWidth: body.scrollWidth, clientWidth: body.clientWidth, padding: getComputedStyle(body).padding,
      footerHeight: dialog.querySelector('.mobile-studio-prompt-actions').getBoundingClientRect().height,
      animation: getComputedStyle(dialog).animationName };
  });
  assert.equal(result.x, 0); assert.equal(result.y, 0);
  assert.equal(result.width, result.viewportWidth); assert.equal(result.height, result.viewportHeight);
  assert(result.scrollWidth <= result.clientWidth + 1, JSON.stringify(result));
  assert(result.footerHeight >= 60); assert.equal(result.animation, 'none');
  return result;
}

(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const rows = [];
  try {
    const cases = [[320,'paper'],[390,'paper'],[620,'paper'],[808,'paper'],[839,'paper'],[390,'night']];
    if (process.env.LFN_UI_TEST_SESSION_SECRET) cases.push([620,'paper',true],[390,'night',true]);
    for (const [width, theme, signedIn = false] of cases) {
      if (process.env.LFN_WORKSPACE_SIGNED_ONLY && !signedIn) continue;
      const { context, page } = await setup(browser, { theme, ...(theme === 'night' ? { accentPreset: 'mint' } : {}) }, { width, height: 884 });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      page.setDefaultNavigationTimeout(90000);
      try {
        if (signedIn) {
          await context.route('**/api/assistant/models', route => route.fulfill({ json: { models: ['workspace-chat-model', 'workspace-vision-model'] } }));
        }
        await page.goto(baseURL + '/image');
        await page.locator('.mobile-studio-prompt-toggle').first().click();
        const dialog = page.locator('.mobile-studio-workspace-dialog');
        const prompt = dialog.locator('[data-workspace-pane="prompt"]');
        const parameters = dialog.locator('[data-workspace-pane="parameters"]');
        const assistant = dialog.locator('[data-workspace-pane="assistant"]');
        await prompt.locator('textarea').first().fill('masterpiece, best quality, white hair, soft light');
        const promptGeometry = await geometry(page);
        await page.evaluate(() => { window.__workspaceDialog = document.querySelector('.mobile-studio-workspace-dialog'); window.__workspacePrompt = document.querySelector('[data-workspace-pane="prompt"] textarea'); });
        const screenshotPrefix = `${theme}-${width}${signedIn ? '-signed' : ''}`;
        if (width === 320 || width === 620 || theme === 'night') await page.screenshot({ path: `${output}/${screenshotPrefix}-prompt.png` });

        await switchPane(page, '参数');
        assert.equal((await geometry(page)).padding, promptGeometry.padding);
        if (width === 320 || width === 620 || theme === 'night') await page.screenshot({ path: `${output}/${screenshotPrefix}-parameters.png` });
        await parameters.getByRole('textbox', { name: '种子', exact: true }).fill('884620');
        const parameterScroll = await parameters.evaluate(el => { el.scrollTop = 310; return el.scrollTop; });
        await parameters.getByRole('button', { name: '高级选项', exact: true }).click();
        const scrollAfterDisclosure = await parameters.evaluate(el => el.scrollTop);
        await page.evaluate(() => { window.__workspaceParameters = document.querySelector('[data-workspace-pane="parameters"]'); });

        await switchPane(page, '助手');
        assert.equal((await geometry(page)).padding, promptGeometry.padding);
        const input = assistant.getByRole('textbox', { name: '标签助手输入', exact: true });
        await input.fill('保留白发与柔光，改善构图');
        await assistant.getByRole('button', { name: '目标 Agent', exact: true }).click();
        await assistant.getByRole('button', { name: '标签助手', exact: true }).click();
        if (signedIn) {
          await assistant.getByRole('button', { name: '智能助手模型', exact: true }).click();
          await page.getByRole('listbox', { name: '智能助手模型', exact: true }).getByRole('option', { name: 'workspace-vision-model', exact: true }).click();
          assert((await assistant.getByRole('button', { name: '智能助手模型', exact: true }).innerText()).includes('workspace-vision-model'));
          // Changing the AI model intentionally resets its inline chat editor;
          // subsequent tab navigation must retain the new editor instance.
          await page.evaluate(() => { window.__workspacePrompt = document.querySelector('[data-workspace-pane="prompt"] textarea'); });
          await assistant.evaluate(el => { el.scrollTop = 0; });
        }
        if (width === 320 || width === 620 || theme === 'night') await page.screenshot({ path: `${output}/${screenshotPrefix}-assistant.png` });
        const submitBox = await assistant.locator('button[type="submit"]').boundingBox();
        const footerBox = await dialog.locator('.mobile-studio-prompt-actions').boundingBox();
        assert(submitBox && footerBox && submitBox.y + submitBox.height <= footerBox.y, 'The initial assistant action fits above the footer');
        const assistantSurface = await input.evaluate(el => getComputedStyle(el).backgroundColor);
        const promptSurface = await prompt.locator('.replica-text-editor').evaluate(el => getComputedStyle(el).backgroundColor);
        const parameterSurface = await parameters.locator('input[aria-label="种子"]').evaluate(el => getComputedStyle(el).backgroundColor);
        assert.equal(assistantSurface, promptSurface); assert.equal(parameterSurface, promptSurface);

        await switchPane(page, '参数');
        assert.equal(await parameters.getByRole('textbox', { name: '种子', exact: true }).inputValue(), '884620');
        assert.equal(await parameters.evaluate(el => el.scrollTop), scrollAfterDisclosure);
        assert.equal(await parameters.getByRole('button', { name: '高级选项', exact: true }).getAttribute('aria-expanded'), 'true');
        await parameters.getByRole('button', { name: '采样器', exact: true }).click();
        await page.getByRole('listbox', { name: '采样器', exact: true }).waitFor();
        await page.keyboard.press('Escape');
        assert(await parameters.isVisible(), 'Escape closes the select before the workspace');
        await switchPane(page, '提示词');
        assert.equal((await prompt.locator('textarea').first().inputValue()).replaceAll('_', ' '), 'masterpiece, best quality, white hair, soft light');
        assert(await page.evaluate(() => window.__workspaceDialog === document.querySelector('.mobile-studio-workspace-dialog') && window.__workspacePrompt === document.querySelector('[data-workspace-pane="prompt"] textarea') && window.__workspaceParameters === document.querySelector('[data-workspace-pane="parameters"]')));
        await switchPane(page, '助手');
        assert.equal(await input.inputValue(), '保留白发与柔光，改善构图');
        await switchPane(page, '提示词');

        // External shortcut must work even when its previous controlled request
        // was also "assistant", after local tabs have moved back to the prompt.
        for (let repeat = 0; repeat < 2; repeat++) {
          await prompt.getByRole('button', { name: '打开提示词助手', exact: true }).click();
          await assistant.waitFor({ state: 'visible' });
          await switchPane(page, '提示词');
        }
        await switchPane(page, '参数');
        await dialog.getByRole('button', { name: '关闭生成参数', exact: true }).click();
        assert(await prompt.isVisible(), 'Back from parameters returns to the prompt');
        await dialog.getByRole('button', { name: '完成', exact: true }).click();
        assert(!(await dialog.isVisible()));
        await page.getByRole('button', { name: '打开标签助手', exact: true }).click();
        assert.equal((await input.inputValue()).replaceAll('_', ' '), 'masterpiece, best quality, white hair, soft light');
        await dialog.getByRole('button', { name: '关闭标签助手', exact: true }).click();
        assert(!(await dialog.isVisible()), 'Direct entry returns to the canvas');
        await page.getByRole('button', { name: '打开生成参数', exact: true }).click();
        await parameters.getByRole('button', { name: '参考图与更多工具', exact: true }).click();
        await dialog.getByRole('button', { name: '关闭更多工具', exact: true }).click();
        assert(await parameters.isVisible(), 'Closing secondary tools returns to the same parameter pane');
        assert(await parameters.evaluate(el => el.scrollTop > 0), `Scroll was not retained: ${parameterScroll}`);

        if (width === 390) {
          await switchPane(page, '助手');
          await page.setViewportSize({ width, height: 400 });
          await input.focus();
          await geometry(page);
          const done = await dialog.getByRole('button', { name: '完成', exact: true }).boundingBox();
          assert(done && done.y + done.height <= 400);
          await dialog.getByRole('button', { name: '完成', exact: true }).click();
        }
        assert.deepEqual(errors, []);
        rows.push({ width, theme, signedIn, passed: true }); console.log(`PASS workspace ${width} ${theme}${signedIn ? ' signed-in' : ''}`);
      } catch (error) {
        rows.push({ width, theme, signedIn, passed: false, error: error.stack, errors }); console.error(`FAIL workspace ${width} ${theme}${signedIn ? ' signed-in' : ''}: ${error.message}`);
        await page.screenshot({ path: `${output}/failed-${theme}-${width}${signedIn ? '-signed' : ''}.png` }).catch(() => {});
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
  fs.writeFileSync(`${output}/results${process.env.LFN_WORKSPACE_SIGNED_ONLY ? '-signed' : ''}.json`, JSON.stringify(rows, null, 2));
  if (rows.some(row => !row.passed)) process.exitCode = 1;
})();
