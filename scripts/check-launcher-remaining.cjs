/* eslint-disable @typescript-eslint/no-require-imports -- Isolated, local browser acceptance. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const { installContentFixtures } = require('./ui-content-fixtures.cjs');
const { installAdminFixtures } = require('./ui-admin-fixtures.cjs');
const output = '.tmp/launcher-ui/remaining';
fs.mkdirSync(output, { recursive: true });
const results = [];
const widths = [320, 390, 600, 808];
async function snapshots(page, name, target) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: 884 });
    await page.waitForTimeout(120);
    if (target) await page.locator(target).evaluate(el => el.scrollIntoView({ block: 'start', behavior: 'instant' }));
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name} fits ${width}`);
    await page.screenshot({ path: `${output}/${name}-${width}.png`, animations: 'disabled' });
  }
}
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  async function run(name, action, admin = false) {
    if (process.env.LFN_UI_SCENARIO && !name.includes(process.env.LFN_UI_SCENARIO)) return;
    const { context, page } = await setup(browser);
    page.setDefaultNavigationTimeout(90000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error' && /hydration|hydrated|uncontrolled|controlled input|received NaN/i.test(message.text())) errors.push(message.text()); });
    page.on('dialog', async dialog => { errors.push(`Unexpected native dialog: ${dialog.type()}`); await dialog.dismiss(); });
    await installContentFixtures(context);
    if (admin) await installAdminFixtures(context, { gallery: [], documents: [], image: Buffer.from('') });
    try { await action(page); assert.deepEqual(errors, []); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
    catch (error) { results.push({ name, passed: false, error: error.message, errors }); console.log(`FAIL ${name}: ${error.message}`); }
    finally { await context.close(); fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2)); }
  }
  try {
    await run('catalog-search-and-types', async page => {
      await page.goto(`${baseURL}/models`);
      await page.getByRole('button', { name: '聊天模型', exact: true }).click();
      assert.equal(await page.locator('article').count(), 1);
      await page.getByRole('button', { name: '图像模型', exact: true }).click();
      assert.equal(await page.locator('article').count(), 3);
      const search = page.getByRole('textbox', { name: '搜索模型名称或用途', exact: true });
      await search.fill('V4.5'); assert.equal(await page.locator('article').count(), 1);
      await search.fill('no-such-model'); await page.getByText('没有匹配的模型。', { exact: true }).waitFor();
      await search.fill(''); await page.getByRole('button', { name: '全部', exact: true }).click();
      await snapshots(page, 'catalog');
    });
    await run('calculator-model-operation-and-values', async page => {
      await page.goto(`${baseURL}/pricing`);
      const calculator = page.locator('#calculator');
      await calculator.waitFor();
      assert(await calculator.evaluate(el => el.getBoundingClientRect().top < 400), 'Calculator is the primary task');
      const before = await calculator.locator('dl').innerText();
      await calculator.getByLabel('生成张数', { exact: true }).fill('2');
      assert.notEqual(await calculator.locator('dl').innerText(), before, 'Inputs update the estimate');
      await calculator.getByRole('button', { name: '模型', exact: true }).click();
      await page.getByRole('option', { name: /V4.5 完整版/ }).click();
      await calculator.getByRole('button', { name: '操作', exact: true }).click();
      await page.getByRole('option', { name: '图生图', exact: true }).click();
      await calculator.getByLabel('宽度', { exact: true }).fill('1024');
      await calculator.getByLabel('步数', { exact: true }).fill('32');
      assert(!(await calculator.locator('dl').innerText()).includes('NaN'));
      await page.locator('.pricing-rules summary').click();
      assert(await page.locator('.pricing-rules').evaluate(el => el.open));
      await snapshots(page, 'calculator', '#calculator');
    });
    await run('prompt-library-save-reload-and-delete', async page => {
      await page.goto(`${baseURL}/settings#prompts`);
      await page.getByRole('button', { name: '添加词条', exact: true }).click();
      await page.getByPlaceholder('例如：雨夜街景', { exact: true }).fill('雨夜长街布局验收词条');
      await page.getByPlaceholder('1girl, rain, night, city lights, wet street, reflection', { exact: true }).fill('rain, night, city lights, reflections, detailed architecture');
      await snapshots(page, 'prompt-library-edit');
      await page.getByRole('button', { name: '保存词库', exact: true }).click();
      await page.reload();
      assert.equal(await page.getByPlaceholder('例如：雨夜街景', { exact: true }).inputValue(), '雨夜长街布局验收词条');
      await page.getByRole('button', { name: '删除词条 雨夜长街布局验收词条', exact: true }).click();
      await page.getByRole('button', { name: '保存词库', exact: true }).click();
      assert.equal(await page.evaluate(() => localStorage.getItem('lfn-user-library')), null);
    });
    await run('provider-and-api-key-forms', async page => {
      await page.goto(`${baseURL}/settings#models`);
      const capability = page.getByRole('button', { name: '模型能力', exact: true });
      for (const kind of ['故事', '图像 + 故事', '图像']) {
        await capability.click(); await page.getByRole('option').filter({ hasText: kind }).first().click();
        await snapshots(page, `provider-${kind === '故事' ? 'story' : kind === '图像' ? 'image' : 'both'}`);
      }
      await page.getByRole('button', { name: '创建密钥', exact: true }).click();
      await page.getByLabel('新密钥名称', { exact: true }).fill('隔离测试密钥');
      await page.getByLabel('模型限制', { exact: true }).fill('nai-v5-full, nai-v4.5-full');
      await page.getByLabel('IP 限制', { exact: true }).fill('192.0.2.1, 2001:db8::/32');
      await snapshots(page, 'api-key-form', '#api-tokens');
      await page.getByRole('button', { name: '收起表单', exact: true }).click();
      assert.equal(await page.getByLabel('新密钥名称', { exact: true }).count(), 0);
    });
    await run('layout-edit-save-apply', async page => {
      await page.goto(`${baseURL}/image/setting/layout`);
      const prompt = page.getByRole('group', { name: '选择提示词卡片', exact: true });
      await prompt.click();
      await page.getByLabel('选中卡片宽度', { exact: true }).fill('75');
      await page.getByLabel('选中卡片最小高度', { exact: true }).fill('3');
      await page.getByRole('button', { name: '上移选中卡片', exact: true }).click();
      await snapshots(page, 'layout-editor');
      await page.getByRole('button', { name: '保存并返回工作台', exact: true }).click();
      await page.waitForURL(`${baseURL}/image`);
      assert.equal(await page.locator('[data-studio-layout]').getAttribute('data-workspace-layout'), 'custom');
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('lfn-mobile-ui-preferences-v1')).workspaceLayout), 'custom');
      await page.setViewportSize({ width: 390, height: 844 });
      await page.locator('.mobile-studio-prompt-toggle').click();
      await page.getByRole('dialog', { name: '提示词区域', exact: true }).waitFor();
      assert(await page.getByRole('dialog').locator('textarea:visible').first().isVisible());
    });
    await run('risk-subpanels-and-lfn-pickers', async page => {
      await page.goto(`${baseURL}/admin?tab=risk`);
      await page.getByRole('tab', { name: '策略配置', exact: true }).click();
      for (const name of ['检测参数', '规则与计分', '风险等级', '账号例外', '账号复核', '发布与版本']) {
        await page.getByRole('tab', { name, exact: true }).click();
        await snapshots(page, `risk-${name}`, '.risk-config .risk-tabs');
        if (name === '风险等级') {
          await page.getByRole('button', { name: '风险等级显示颜色', exact: true }).click();
          await page.getByRole('dialog', { name: 'LFN 取色器', exact: true }).waitFor();
          await page.keyboard.press('Escape');
        }
      }
      assert.equal(await page.locator('select,input[type=color],input[type=datetime-local]').count(), 0);
    }, true);
    await run('aliases-and-not-found', async page => {
      for (const [from, to] of [['/', '/image'], ['/account', '/profile#profile-rewards'], ['/activities', '/studio#activities'], ['/keys', '/settings#api-tokens'], ['/prompts', '/settings#prompts'], ['/resources', '/settings#models'], ['/settings/layout', '/image/setting/layout']]) {
        await page.goto(baseURL + from); await page.waitForURL(baseURL + to);
        assert.equal(new URL(page.url()).pathname, new URL(to, baseURL).pathname);
      }
      await page.goto(`${baseURL}/layout-test-page-does-not-exist`);
      await page.getByRole('heading', { name: '这个页面还不存在', exact: true }).waitFor();
      await snapshots(page, 'not-found');
      await page.getByRole('link', { name: '返回工作台', exact: true }).click();
      await page.waitForURL(`${baseURL}/image`);
    });
  } finally { await browser.close(); }
  process.exitCode = results.some(result => !result.passed) ? 1 : 0;
})();
