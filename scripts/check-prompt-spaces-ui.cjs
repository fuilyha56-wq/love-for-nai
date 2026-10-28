/* Regression coverage for Aaalice formatting, completion and persistence. All APIs are mocked. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const output = process.env.LFN_PROMPT_TEST_OUTPUT || '.tmp/prompt-spaces-aaalice';
fs.mkdirSync(output, { recursive: true });

async function check(browser, width, theme, workspaceLayout) {
  const { context, page } = await setup(browser, { theme, workspaceLayout }, { width, height: 900 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.setDefaultTimeout(20000);
  let offline = false;
  await context.addInitScript(() => {
    localStorage.setItem('lfn-user-library', JSON.stringify([{ name: 'my_character', content: 'white hair, blue eyes, red eyes', createdAt: '2026-10-25T00:00:00Z' }]));
    for (const variant of ['nai', 'nlw']) localStorage.setItem('lfn-replica-prompt-' + variant, JSON.stringify({ version: 1, settings: { autoFormat: true, autocomplete: true, cooccurrence: true } }));
  });
  await context.route('**/data/random-wordlists.json', route => route.fulfill({ json: { generators: [{ groups: [{ entries: [['blue eyes'], ['green eyes'], ['soft light']] }] }] } }));
  const snippet = '1.2::artist:some_name::, white hair\ntext:hello_world';
  await context.route('**/api/tags?**', route => {
    if (offline) return route.fulfill({ status: 503, json: { tags: [] } });
    const query = new URL(route.request().url()).searchParams.get('q');
    const hit = query === 'curated'
      ? { name: 'curated_entry', displayName: 'curated entry', insertion: snippet, source: 'quicktagcloud' }
      : { name: query.startsWith('soft') ? 'soft_light' : 'blue_eyes', displayName: query.startsWith('soft') ? 'soft light' : 'blue eyes', source: 'danbooru' };
    return route.fulfill({ json: { tags: [hit] } });
  });
  try {
    await page.goto(`${baseURL}/image`, { timeout: 120000 });
    await page.waitForFunction(() => localStorage.getItem('lfn-image-studio-form-v1'));
    if (width < 840) await page.locator('.mobile-studio-prompt-toggle').click();
    const replica = width < 840 || theme === 'nai' || workspaceLayout === 'nlw';
    if (replica) await page.locator('.replica-raw-textarea:visible').first().waitFor();
    async function field(negative = false) {
      if (replica) {
        await page.getByRole('tablist', { name: '提示词类型', exact: true }).getByRole('tab').nth(negative ? 1 : 0).click();
        return page.locator('.replica-raw-textarea:visible').first();
      }
      return page.getByRole('textbox', { name: negative ? '排除内容' : '描述画面', exact: true });
    }
    const source = 'white hair，{ blue eyes }\n<my character>, existing_tag, ^_^';
    const expected = 'white_hair, { blue_eyes }\n<my character>, existing_tag, ^_^';
    let input = await field();
    await input.fill(source); await input.blur();
    assert.equal(await input.inputValue(), expected, 'Blur converts tag spaces and protects Aaalice syntax boundaries');
    input = await field(true);
    await input.fill('bad hands，low quality'); await input.blur();
    assert.equal(await input.inputValue(), 'bad_hands, low_quality', 'Negative prompts use the same Aaalice conversion');
    await page.waitForFunction(expected => {
      const saved = JSON.parse(localStorage.getItem('lfn-image-studio-form-v1') || 'null');
      return saved?.prompt === expected && saved?.negative === 'bad_hands, low_quality';
    }, expected);
    await page.reload();
    if (width < 840) await page.locator('.mobile-studio-prompt-toggle').click();
    input = await field();
    await page.waitForFunction(expected => [...document.querySelectorAll('textarea')].some(element => element.value === expected), expected);
    assert.equal(await input.inputValue(), expected, 'Saved prompts preserve the formatted result after reload');
    input = await field(true);
    assert.equal(await input.inputValue(), 'bad_hands, low_quality', 'Saved negative prompts preserve the formatted result after reload');
    input = await field();
    async function setAutoFormat(enabled) {
      await page.getByRole('button', { name: '提示词设置', exact: true }).first().click();
      await page.getByRole('checkbox', { name: /自动格式化/ }).setChecked(enabled);
      await page.getByRole('button', { name: '提示词设置', exact: true }).first().click();
    }
    await setAutoFormat(false);
    await input.fill('white hair, <my character>'); await input.blur();
    assert.equal(await input.inputValue(), 'white hair, <my character>', 'Disabling autoformat preserves typed spaces');
    await setAutoFormat(true);
    await input.fill('blue e');
    await page.getByRole('option').filter({ hasText: 'blue eyes' }).first().click();
    assert.equal(await input.inputValue(), 'blue_eyes', 'Click completion keeps canonical tags as in Aaalice');
    await input.fill('soft l');
    await page.getByRole('option').filter({ hasText: 'soft light' }).first().waitFor();
    await input.press('Enter');
    assert.equal(await input.inputValue(), 'soft_light', 'Keyboard completion keeps canonical tags');
    offline = true;
    await input.fill('green e');
    await page.getByRole('option').filter({ hasText: 'green eyes' }).first().click();
    assert.equal(await input.inputValue(), 'green_eyes', 'Offline wordlist keeps canonical tags');
    offline = false;
    await input.fill('curated');
    await page.getByRole('option').filter({ hasText: 'curated entry' }).first().click();
    await input.blur();
    assert.equal(await input.inputValue(), snippet.replace('white hair', 'white_hair'), 'Authored snippets use the same blur formatter');
    await input.fill('white hair');
    await input.press('Control+Shift+Space');
    await page.getByRole('option').filter({ hasText: 'blue eyes' }).first().click();
    assert.equal(await input.inputValue(), 'white hair, blue_eyes', 'Text cooccurrence keeps canonical tags');
    await input.fill('white hair'); await input.blur();
    await page.getByRole('button', { name: replica ? '标签模式' : 'Tag', exact: true }).first().click();
    const editor = page.locator('.tag-chip-editor:visible').first();
    const add = editor.getByRole('textbox', { name: '添加标签', exact: true });
    await add.fill('soft l');
    await editor.getByRole('option').filter({ hasText: 'soft light' }).first().click();
    assert((await editor.locator('.tag-chip-text').allTextContents()).includes('soft_light'), 'Tag mode mouse completion keeps canonical tags');
    await add.fill('blue e');
    await editor.getByRole('option').filter({ hasText: 'blue eyes' }).first().waitFor();
    await add.press('Enter');
    assert((await editor.locator('.tag-chip-text').allTextContents()).includes('blue_eyes'), 'Tag mode keyboard completion keeps canonical tags');
    await editor.getByRole('button').filter({ has: page.locator('.tag-chip-text', { hasText: /^white_hair$/ }) }).click();
    await editor.locator('.tag-chip-related').getByRole('button', { name: /red eyes/ }).click();
    assert((await editor.locator('.tag-chip-text').allTextContents()).includes('red_eyes'), 'Tag mode cooccurrence keeps canonical tags');
    assert.deepEqual(errors, [], 'No browser runtime errors');
    await page.screenshot({ path: `${output}/${width}-${theme}-${workspaceLayout}.png` });
  } catch (error) {
    await page.screenshot({ path: `${output}/${width}-${theme}-${workspaceLayout}-failure.png` }).catch(() => {});
    throw error;
  } finally { await context.close(); }
}

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = [];
  try {
    for (const width of [1254, 390]) for (const [theme, layout] of [['paper', 'lfn'], ['nai', 'lfn'], ['paper', 'nlw']]) {
      if (process.env.LFN_PROMPT_TEST_CASE && process.env.LFN_PROMPT_TEST_CASE !== `${width}-${theme}-${layout}`) continue;
      try { await check(browser, width, theme, layout); results.push({ width, theme, layout, passed: true }); }
      catch (error) { results.push({ width, theme, layout, passed: false, error: error.stack }); }
      console.log(JSON.stringify(results.at(-1)));
    }
  } finally { await browser.close(); }
  fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
  if (results.some(result => !result.passed)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
