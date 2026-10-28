/* eslint-disable @typescript-eslint/no-require-imports -- Standalone local browser verification. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const output = '.tmp/launcher-ui/responsive-comments';
fs.mkdirSync(output, { recursive: true });
const results = [];
async function check(name, action) {
  try { await action(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false, error: error.message }); console.log(`FAIL ${name}: ${error.message}`); }
}
async function fits(locator) { assert(await locator.evaluate(el => el.scrollWidth <= el.clientWidth + 1), `${await locator.getAttribute('class')}: horizontal overflow`); }
async function fullViewport(page, locator, height) {
  await locator.evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished)); });
  const box = await locator.boundingBox();
  const size = page.viewportSize();
  assert(box && Math.abs(box.x) < 1 && Math.abs(box.y) < 1 && Math.abs(box.width - size.width) < 1 && Math.abs(box.height - (height || size.height)) < 1, `Full viewport expected: ${JSON.stringify(box)}`);
}
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    for (const width of [320, 390, 600, 808, 839, 840, 1023]) await check(`workspaces-${width}`, async () => {
      const { context, page } = await setup(browser, { theme: 'paper', workspaceLayout: 'lfn' }, { width, height: 884 });
      try {
        await page.goto(`${baseURL}/image`);
        const bar = page.locator('.mobile-studio-workbar');
        await bar.waitFor({ state: 'visible' });
        await fits(bar);
        const actions = await bar.locator('.mobile-studio-workbar-actions > *').evaluateAll(elements => elements.map(el => ({ label: el.getAttribute('aria-label'), x: el.getBoundingClientRect().x, width: el.getBoundingClientRect().width })));
        assert.deepEqual(actions.map(action => action.label), ['打开生成参数', '打开标签助手', '打开历史记录', '查看消息']);
        assert(actions.every((action, index) => action.width >= 44 && (!index || action.x >= actions[index - 1].x + 43)));
        await page.getByRole('button', { name: '打开生成参数', exact: true }).click();
        const params = page.getByRole('dialog', { name: '生成参数', exact: true });
        await params.evaluate(async el => { await Promise.all(el.getAnimations().map(animation => animation.finished)); });
        await fullViewport(page, params);
        await page.screenshot({ path: `${output}/parameters-${width}.png`, animations: 'disabled' });
        await fits(params.locator('.mobile-studio-sheet-content'));
        await params.getByRole('navigation', { name: '工作面板' }).getByRole('button', { name: '助手', exact: true }).click();
        const assistant = page.getByRole('dialog', { name: '标签助手', exact: true });
        await fullViewport(page, assistant);
        await page.screenshot({ path: `${output}/assistant-${width}.png`, animations: 'disabled' });
        await assistant.getByRole('navigation', { name: '工作面板' }).getByRole('button', { name: '提示词', exact: true }).click();
        const prompt = page.getByRole('dialog', { name: '提示词区域', exact: true });
        await fullViewport(page, prompt);
        await fits(prompt.locator('.mobile-studio-prompt-content'));
        await prompt.locator('textarea:visible').first().fill('1girl, white hair, crimson eyes, intricate kimono, soft window light');
        for (const selector of ['.replica-prompt-toolbar', '.replica-prompt-footer', '.replica-character-heading']) await fits(prompt.locator(selector));
        const buttons = await prompt.locator('.replica-prompt-tools button, .replica-character-shortcuts > *').evaluateAll(elements => elements.map(el => ({ width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
        assert(buttons.every(box => box.width >= 43 && box.height >= 43), `44px controls: ${JSON.stringify(buttons)}`);
        await prompt.getByRole('button', { name: '♀ 女', exact: true }).click();
        await prompt.getByLabel('角色 1 提示词', { exact: true }).fill('long character description with silver hair and a patterned blue dress');
        await page.screenshot({ path: `${output}/prompt-${width}.png` });
        await prompt.getByRole('button', { name: '生成参数 ·', exact: false }).click();
        await params.waitFor();
        await params.getByRole('button', { name: '关闭生成参数', exact: true }).click();
        await prompt.waitFor();
        assert((await prompt.locator('textarea:visible').first().inputValue()).replaceAll('_', ' ').includes('white hair'), 'Prompt survives parameter round trip');
        await page.evaluate(() => { Object.defineProperty(visualViewport, 'height', { configurable: true, value: 400 }); visualViewport.dispatchEvent(new Event('resize')); });
        await page.waitForFunction(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lfn-viewport-height')) === 400);
        await fullViewport(page, prompt, 400);
        await fits(prompt.locator('.mobile-studio-prompt-content'));
        const done = await prompt.getByRole('button', { name: '完成', exact: true }).boundingBox();
        assert(done.y + done.height <= 401, 'Done remains above keyboard');
        await page.screenshot({ path: `${output}/keyboard-${width}.png` });
        await prompt.getByRole('button', { name: '完成', exact: true }).click();
        await page.evaluate(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize')); });
        await page.getByRole('button', { name: '生成模式', exact: true }).click();
        const modes = await page.getByRole('option').allTextContents();
        assert(modes.includes('文生图') && modes.includes('图生图') && modes.includes('局部重绘') && modes.includes('放大') && modes.includes('标签建议'));
        await page.screenshot({ path: `${output}/modes-${width}.png` });
        await page.keyboard.press('Escape');
        for (const mode of modes) {
          await page.getByRole('button', { name: '生成模式', exact: true }).click();
          await page.getByRole('option', { name: mode, exact: true }).click();
          assert.equal((await page.getByRole('button', { name: '生成模式', exact: true }).innerText()).trim(), mode.trim());
        }
        await page.getByRole('link', { name: '查看消息', exact: true }).click();
        await page.waitForURL('**/notifications');
        await page.getByRole('button', { name: '更多页面', exact: true }).click();
        const more = page.getByRole('dialog', { name: '更多页面', exact: true });
        assert.equal(await more.locator('.launcher-destination-group').count(), 4);
        assert.equal(await more.getByRole('link').count(), 15);
        await fits(more);
        for (const group of await more.locator('.launcher-destination-group').all()) await fits(group);
        await page.screenshot({ path: `${output}/more-${width}.png` });
      } finally { await context.close(); }
    });
  } finally { await browser.close(); }
  fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
  process.exitCode = results.some(result => !result.passed) ? 1 : 0;
})();
