/* eslint-disable @typescript-eslint/no-require-imports -- Local guided editing acceptance. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const sharp = require('sharp');
process.env.LFN_UI_BASE_URL ||= 'http://127.0.0.1:3000';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
process.env.LFN_UI_TEST_SESSION_SECRET ||= process.env.LFN_SESSION_SECRET || 'lfn-development-secret-change-me';
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const output = path.resolve('.tmp/feature-tutorials');
fs.mkdirSync(output, { recursive: true });

const sourceSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="384" height="512"><rect width="384" height="512" fill="#d4e8f5"/><circle cx="300" cy="90" r="40" fill="#ffe5a0"/><path d="M0 512V340L120 170L230 340L300 260L384 380V512Z" fill="#75a68b"/><path d="M0 512V410L160 290L300 440L384 380V512Z" fill="#42756c"/></svg>';
const results = [];
(async () => {
  const source = await sharp(Buffer.from(sourceSvg)).png().toBuffer();
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    for (const width of [1440, 390]) {
      const { page, context, requests } = await setup(browser, { theme: 'paper', workspaceLayout: 'lfn' }, { width, height: width < 1024 ? 844 : 1000 });
      page.setDefaultTimeout(20000);
      page.setDefaultNavigationTimeout(90000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const paid = [];
      // Exercise real browser editing and compositing; substitute only paid upstream calls.
      await context.route('**/api/images/operate', async route => {
        const body = route.request().postDataJSON();
        paid.push({ operation: body.operation, width: body.width, height: body.height });
        const image = await sharp(source).resize(body.width || 384, body.height || 512, { fit: 'fill' }).png().toBuffer();
        await route.fulfill({ json: { images: [`data:image/png;base64,${image.toString('base64')}`], historyIds: [], payment: 'aff' } });
      });
      // A legacy model avoids a development Strict Mode policy bootstrap delay.
      await context.route('**/api/models', route => route.fulfill({ json: { items: ['nai-v3', 'nai-v3-inpaint', 'nai-v5-full', 'nai-v5-inpaint'].map(id => ({ id, kind: '图像模型' })) } }));
      try {
        await page.goto(`${baseURL}/profile#profile-tutorials`);
        await page.locator('[data-tutorial-id="inpaint"]').getByRole('button', { name: /手把手教程$/ }).click();
        await page.waitForURL('**/image');
        await page.locator('.feature-tutorial-panel h2').getByText('选择局部重绘模式', { exact: true }).waitFor();
        await page.waitForTimeout(1500);
        const mode = page.getByRole('button', { name: /图像操作|生成模式$|点击选择生成模式/ }).filter({ visible: true }).first();
        await page.getByRole('button', { name: '收起说明，继续操作', exact: true }).first().click();
        // On mobile, the automatically opened parameter pane contains the mode control.
        const modelSelect = page.getByRole('button', { name: '模型', exact: true }).filter({ visible: true }).first();
        if (await modelSelect.count()) {
          await modelSelect.click();
          const model = page.getByRole('option').filter({ hasText: /nai-v3$|V3.*动漫|V3.*Anime/i }).first();
          if (await model.count()) await model.click();
          else await page.keyboard.press('Escape');
        }
        if (await mode.count()) {
          await mode.click();
          const option = page.getByRole('option').filter({ hasText: /局部重绘/ }).first();
          if (await option.count()) await option.click();
          else await page.getByRole('dialog', { name: '选择生成模式', exact: true }).getByRole('button').filter({ hasText: /局部重绘/ }).first().click();
        } else {
          const select = page.getByRole('combobox', { name: /生成模式|模式/ }).filter({ visible: true }).first();
          await select.selectOption('inpainting');
        }
        await page.getByRole('button', { name: '展开教程说明', exact: true }).click();
        await page.locator('.feature-tutorial-panel footer').getByRole('button', { name: /下一步/ }).click();
        await page.locator('.feature-tutorial-panel h2').getByText('准备编辑图片', { exact: true }).waitFor();
        await page.waitForTimeout(1300);
        // The tutorial explicitly keeps the user on the source step until the editor is entered.
        await page.locator('.feature-tutorial-panel footer').getByRole('button', { name: /下一步/ }).click();
        await page.locator('.feature-tutorial-panel [role="alert"]').waitFor();
        assert.equal(new URL(page.url()).pathname, '/image');
        await page.getByRole('button', { name: '收起说明，继续操作', exact: true }).first().click();
        const uploadButton = page.getByRole('button', { name: /上传重绘源图片|上传图片|上传源图片/ }).filter({ visible: true }).first();
        let chooser;
        if (await uploadButton.count()) {
          const event = page.waitForEvent('filechooser');
          await uploadButton.click(); chooser = await event;
        } else {
          const uploadLabel = page.locator('label').filter({ hasText: /源图片|源图像/ }).filter({ visible: true }).first();
          const event = page.waitForEvent('filechooser');
          await uploadLabel.click(); chooser = await event;
        }
        await chooser.setFiles({ name: 'tutorial-practice.png', mimeType: 'image/png', buffer: source });
        const openEditor = page.getByRole('button', { name: /绘制蒙版与精确重绘|绘制重绘蒙版|独立重绘编辑器/ }).filter({ visible: true }).first();
        await openEditor.waitFor();
        await page.waitForFunction(() => document.querySelector('[data-feature-tutorial-target="true"]')?.getAttribute('data-tutorial-editor') === 'inpaint');
        await openEditor.click();
        await page.waitForURL('**/image/editor?**');
        await page.locator('.editor-stage canvas').first().waitFor();
        await page.getByRole('button', { name: '展开教程说明', exact: true }).click();
        await page.locator('.feature-tutorial-panel footer').getByRole('button', { name: /下一步/ }).click();
        await page.locator('.feature-tutorial-panel h2').getByText('涂出需要修改的区域', { exact: true }).waitFor();
        const draft = new URL(page.url()).searchParams.get('draftId');
        assert(draft, 'Loaded source must have a draft ID');
        await page.waitForTimeout(1300);
        await page.screenshot({ path: path.join(output, `editing-mask-${width}.png`), animations: 'disabled' });
        await page.getByRole('button', { name: '收起说明，继续操作', exact: true }).first().click();
        await page.getByRole('button', { name: '绘制', exact: true }).filter({ visible: true }).first().click();
        if (width < 1024) await page.getByRole('button', { name: '收起编辑面板', exact: true }).click();
        const stage = await page.locator('.editor-stage').boundingBox();
        await page.mouse.move(stage.x + stage.width * .45, stage.y + stage.height * .42);
        await page.mouse.down();
        await page.mouse.move(stage.x + stage.width * .55, stage.y + stage.height * .49, { steps: 10 });
        await page.mouse.up();
        await page.getByRole('button', { name: '展开教程说明', exact: true }).click();
        await page.locator('.feature-tutorial-panel footer').getByRole('button', { name: /下一步/ }).click();
        await page.waitForTimeout(1300);
        assert.equal(new URL(page.url()).searchParams.get('draftId'), draft, 'Advancing preserves the source draft');
        await page.locator('.feature-tutorial-panel footer').getByRole('button', { name: /下一步/ }).click();
        await page.getByRole('button', { name: '收起说明，继续操作', exact: true }).first().click();
        await page.locator('.editor-actions').getByRole('button', { name: '生成并预览', exact: true }).click();
        await page.locator('.editor-actions').getByRole('button', { name: '应用到工作台', exact: true }).waitFor();
        assert.equal(paid.length, 1, 'Generation only occurs after the user clicks the editor action');
        assert.equal(paid[0].operation, 'inpainting');
        await page.screenshot({ path: path.join(output, `editing-preview-${width}.png`), animations: 'disabled' });
        await page.getByRole('button', { name: '展开教程说明', exact: true }).click();
        await page.locator('.feature-tutorial-panel footer').getByRole('button', { name: /下一步/ }).click();
        await page.getByRole('button', { name: '收起说明，继续操作', exact: true }).first().click();
        await page.locator('.editor-actions').getByRole('button', { name: '应用到工作台', exact: true }).click();
        await page.waitForURL('**/image?**');
        await page.getByRole('button', { name: '展开教程说明', exact: true }).click();
        await page.getByRole('button', { name: '完成教程，返回教程中心', exact: true }).click();
        await page.waitForURL('**/profile#profile-tutorials');
        await page.locator('[data-tutorial-id="inpaint"] .tutorial-completed').waitFor();
        assert.equal(errors.length, 0, errors.join('\n'));
        results.push({ width, scenario: 'upload-mask-preview-apply-complete-return', paidCalls: paid.length, passed: true });
      } catch (error) {
        await page.screenshot({ path: path.join(output, `editing-failure-${width}.png`), animations: 'disabled' }).catch(() => {});
        fs.writeFileSync(path.join(output, `editing-failure-${width}.txt`), await page.locator('body').innerText());
        results.push({ width, passed: false, error: error.stack || error.message, requests: requests.map(item => item.path), errors });
        console.error(`FAIL editing ${width}: ${error.message}`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(output, 'editing-results.json'), JSON.stringify(results, null, 2)); }
  console.log(JSON.stringify(results.map(result => ({ width: result.width, passed: result.passed, scenario: result.scenario, paidCalls: result.paidCalls, error: result.error }))));
  if (results.some(result => !result.passed)) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
