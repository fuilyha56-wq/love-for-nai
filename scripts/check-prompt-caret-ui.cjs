/* Click the visible highlighted character, then delete it. All APIs are mocked. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const output = '.tmp/prompt-caret';
fs.mkdirSync(output, { recursive: true });

async function check(browser, width, theme, workspaceLayout) {
  const { context, page } = await setup(browser, { theme, workspaceLayout }, { width, height: 884 });
  try {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${baseURL}/image`);
    if (width < 840) await page.locator('.mobile-studio-prompt-toggle').click();
    const inputs = page.locator('.replica-raw-textarea:visible');
    await inputs.first().waitFor();
    for (const input of await inputs.all()) {
      await input.fill('abcdefghijk123456');
      const metrics = await input.evaluate(element => {
        const mirror = element.closest('.replica-text-editor').querySelector('.replica-syntax-highlight');
        const properties = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'lineHeight', 'letterSpacing', 'padding', 'whiteSpace', 'overflowWrap', 'tabSize'];
        return properties.map(property => [property, getComputedStyle(element)[property], getComputedStyle(mirror)[property]]);
      });
      for (const [property, inputValue, mirrorValue] of metrics) assert.equal(inputValue, mirrorValue, `Visible text and caret share ${property}`);
      // Font mismatch previously placed the caret at k when clicking visible 3.
      const point = await input.evaluate(element => {
        const pre = element.closest('.replica-text-editor').querySelector('pre');
        const range = document.createRange(); range.setStart(pre.firstChild, 13); range.setEnd(pre.firstChild, 14);
        const rect = range.getBoundingClientRect(); return { x: rect.right - 0.2, y: rect.y + rect.height / 2 };
      });
      if (width < 840) await page.touchscreen.tap(point.x, point.y);
      else await page.mouse.click(point.x, point.y);
      assert.equal(await input.evaluate(element => element.selectionStart), 14, 'Caret follows the visible 3');
      await page.keyboard.press('Backspace');
      assert.equal(await input.inputValue(), 'abcdefghijk12456', 'Backspace removes 3 rather than k');
      assert.equal(await input.evaluate(element => element.selectionStart), 13);
      await input.evaluate(element => { element.focus(); element.setSelectionRange(11, 13); });
      await page.keyboard.press('Backspace');
      assert.equal(await input.inputValue(), 'abcdefghijk456', 'Selection deletion respects its range');
      await page.keyboard.insertText('中文🙂');
      assert.equal(await input.inputValue(), 'abcdefghijk中文🙂456', 'Insertion stays at the caret');
      await input.fill(Array.from({ length: 35 }, (_, i) => `line_${i}, {artist:test}, 1.2::tag::`).join('\n'));
      await input.evaluate(element => { element.scrollTop = 250; element.dispatchEvent(new Event('scroll', { bubbles: true })); });
      const scroll = await input.evaluate(element => [element.scrollTop, element.closest('.replica-text-editor').querySelector('pre').scrollTop]);
      assert.equal(scroll[0], scroll[1], 'Highlight follows textarea scrolling');
    }
    await page.screenshot({ path: `${output}/${width}-${theme}-${workspaceLayout}.png` });
    assert.deepEqual(errors, []);
  } finally { await context.close(); }
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = [];
  try {
    for (const [width, theme, layout] of [[390, 'light', 'lfn'], [390, 'nai', 'lfn'], [620, 'light', 'lfn'], [1254, 'nai', 'lfn'], [1254, 'light', 'nlw']]) {
      try { await check(browser, width, theme, layout); results.push({ width, theme, layout, passed: true }); }
      catch (error) { results.push({ width, theme, layout, passed: false, error: error.stack }); }
      console.log(JSON.stringify(results.at(-1)));
    }
    const { context, page } = await setup(browser, { theme: 'light', workspaceLayout: 'lfn' }, { width: 1254, height: 884 });
    try {
      await page.goto(`${baseURL}/image`);
      await page.waitForFunction(() => localStorage.getItem('lfn-image-studio-form-v1'));
      for (const label of ['描述画面', '排除内容']) {
        const input = page.getByLabel(label, { exact: true }); await input.fill('abcdefghijk123456');
        await input.evaluate(element => { element.focus(); element.setSelectionRange(14, 14); });
        await page.keyboard.press('Backspace'); assert.equal(await input.inputValue(), 'abcdefghijk12456');
      }
      results.push({ width: 1254, theme: 'light', layout: 'lfn', passed: true });
    } catch (error) { results.push({ width: 1254, theme: 'light', layout: 'lfn', passed: false, error: error.stack }); }
    finally { await context.close(); }
    console.log(JSON.stringify(results.at(-1)));
  } finally { await browser.close(); }
  fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
  if (results.some(result => !result.passed)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
