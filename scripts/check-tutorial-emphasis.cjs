/* eslint-disable @typescript-eslint/no-require-imports -- Local browser regression for tutorial focus. */
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const sharp = require('sharp');
process.env.LFN_UI_BASE_URL ||= 'http://127.0.0.1:3000';
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve('.tmp/browser-check/node_modules/playwright-core');
require('@next/env').loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
process.env.LFN_UI_TEST_SESSION_SECRET ||= process.env.LFN_SESSION_SECRET || 'lfn-development-secret-change-me';
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const output = path.resolve('.tmp/feature-tutorials/emphasis');
fs.mkdirSync(output, { recursive: true });
const results = [];

(async () => {
  const image = await sharp({ create: { width: 384, height: 512, channels: 4, background: '#87a9bb' } }).png().toBuffer();
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    // This direct mid-step restore covers the reported desktop editor-entry
    // bug. Mobile flows are covered end-to-end by the feature acceptance runs.
    for (const [width, workspaceLayout, theme] of [[1149, 'lfn', 'paper'], [1440, 'nai', 'nai'], [1440, 'nlw', 'paper']]) {
      for (const tutorialId of ['inpaint', 'outpaint', 'tiled-upscale']) {
        const { context, page, requests } = await setup(browser, { theme, workspaceLayout }, { width, height: width < 1024 ? 844 : 884 });
        const errors = [];
        page.setDefaultTimeout(16000);
        page.setDefaultNavigationTimeout(90000);
        page.on('pageerror', error => errors.push(error.message));
        await context.route('**/api/models', route => route.fulfill({ json: { items: ['nai-v3', 'nai-v3-inpaint', 'nai-v5-full', 'nai-v5-inpaint'].map(id => ({ id, kind: '图像模型' })) } }));
        // Restore the exact step from the reported bug, then perform a real file upload.
        await context.addInitScript(id => sessionStorage.setItem('lfn-feature-tutorial-session-v1', JSON.stringify({ tutorialId: id, stepIndex: 1 })), tutorialId);
        try {
          // Start with a genuinely empty source field. `reuse=1` preloads
          // history state and makes the pre-upload expectation meaningless.
          await page.goto(`${baseURL}/image?operation=inpainting&model=nai-v3`);
          await page.locator('.feature-tutorial-panel h2').waitFor();
          await page.waitForTimeout(1400);
          if (width < 1024 && await page.getByRole('button', { name: '完成', exact: true }).count()) await page.getByRole('button', { name: '完成', exact: true }).click();
          assert(await page.locator('.feature-tutorial-body .tutorial-keyword').count() > 0, 'Key controls must be emphasized in tutorial text');
          await page.getByRole('button', { name: '收起说明，继续操作', exact: true }).first().click();
          // The restored step is specifically the source-image step; choose
          // model and operation only on desktop, where their controls remain
          // outside the collapsed mobile tutorial dock. Mobile's prior step
          // was already validated by the feature acceptance flows.
          if (width >= 1024) {
            const modelControl = page.getByRole('button', { name: '模型', exact: true }).filter({ visible: true }).first();
            if (await modelControl.count()) {
              await modelControl.click();
              const modelOption = page.getByRole('option').filter({ hasText: /nai-v3$/i }).first();
              if (await modelOption.count()) await modelOption.click();
              else await page.keyboard.press('Escape');
            }
            const modeControl = page.getByRole('button', { name: /图像操作|生成模式$|点击选择生成模式/ }).filter({ visible: true }).first();
            if (await modeControl.count()) {
              await modeControl.click();
              const inpaintOption = page.getByRole('option').filter({ hasText: /局部重绘/ }).first();
              if (await inpaintOption.count()) await inpaintOption.click();
              else await page.getByRole('dialog', { name: '选择生成模式', exact: true }).getByRole('button').filter({ hasText: /局部重绘/ }).first().click();
            } else {
              const modeSelect = page.getByRole('combobox', { name: /生成模式|模式/ }).filter({ visible: true }).first();
              if (await modeSelect.count()) await modeSelect.selectOption('inpainting');
            }
          }
          assert.equal(await page.locator('[data-feature-tutorial-target][data-tutorial-editor]').count(), 0, 'An editor is not the upload target before a source exists');
          const uploadButton = page.locator('[data-tutorial="inpaint-source"]').filter({ visible: true }).first();
          const mobileUpload = page.locator('.mobile-reference-tools').getByRole('button', { name: '上传图片', exact: true });
          let uploadTarget = uploadButton;
          if (!(await uploadTarget.count()) && width < 1024) uploadTarget = mobileUpload;
          if (!(await uploadTarget.count())) uploadTarget = page.locator('.upload-field-stack label').filter({ visible: true }).first();
          assert(await uploadTarget.count(), 'A visible image upload control must exist after choosing an editing model and mode');
          const fileChooserEvent = page.waitForEvent('filechooser');
          await uploadTarget.click();
          const chooser = await fileChooserEvent;
          await chooser.setFiles({ name: 'tutorial-entry-regression.png', mimeType: 'image/png', buffer: image });
          const expectedModes = tutorialId === 'inpaint' ? ['inpaint'] : width < 1024 ? ['canvas', 'inpaint'] : ['canvas'];
          await page.waitForFunction(modes => modes.includes(document.querySelector('[data-feature-tutorial-target="true"]')?.getAttribute('data-tutorial-editor')), expectedModes);
          const entry = page.locator('[data-feature-tutorial-target="true"]');
          const highlightedMode = await entry.getAttribute('data-tutorial-editor');
          assert(expectedModes.includes(highlightedMode), `Wrong editor entry mode: ${highlightedMode}`);
          if (tutorialId !== 'inpaint' && highlightedMode === 'inpaint') {
            const instructions = await page.locator('.feature-tutorial-body').innerText();
            assert(/顶部/.test(instructions) && /无限画布|分块超分/.test(instructions), 'Mobile repaint entry must explain switching editor mode');
          }
          assert.equal(await entry.evaluate(element => getComputedStyle(element).outlineStyle), 'solid', 'The actual editor button must have a visible outline even with instructions collapsed');
          await page.getByRole('button', { name: '展开教程说明', exact: true }).click();
          await page.locator('.feature-tutorial-target-label').waitFor();
          const label = await page.locator('.feature-tutorial-target-label').innerText();
          assert(/独立重绘编辑器|绘制.*蒙版|无限画布|图像编辑器|绘制草图/.test(label), `Wrong next-action label: ${label}`);
          const targetBox = await entry.boundingBox();
          const spotlight = await page.locator('.feature-tutorial-spotlight').boundingBox();
          assert(targetBox && spotlight && Math.abs(spotlight.x - Math.max(4, targetBox.x - 4)) < 2 && Math.abs(spotlight.y - Math.max(4, targetBox.y - 4)) < 2, 'The spotlight must match the editor button, not the references section');
          assert(targetBox.y >= 0 && targetBox.y + targetBox.height <= page.viewportSize().height, 'The editor entry must be scrolled into view');
          await page.screenshot({ path: path.join(output, `${tutorialId}-${width}-${workspaceLayout}.png`), animations: 'disabled' });
          await page.locator('.tutorial-step-action').click();
          await page.waitForURL('**/image/editor?**');
          await page.locator('.editor-stage canvas').first().waitFor();
          await page.locator('.feature-tutorial-panel footer').getByRole('button', { name: /下一步|已进入编辑器，继续/ }).click();
          await page.waitForFunction(() => JSON.parse(sessionStorage.getItem('lfn-feature-tutorial-session-v1')).stepIndex === 2);
          await page.getByRole('button', { name: '退出教程，返回个人资料的教程中心', exact: true }).click();
          await page.waitForURL('**/profile#profile-tutorials');
          assert.equal(requests.filter(request => request.method !== 'GET').length, 0, 'Tutorial entry must not generate or submit any paid task');
          assert.equal(errors.length, 0, errors.join('\n'));
          results.push({ width, workspaceLayout, tutorialId, passed: true });
        } catch (error) {
          await page.screenshot({ path: path.join(output, `failure-${tutorialId}-${width}-${workspaceLayout}.png`), animations: 'disabled' }).catch(() => {});
          fs.writeFileSync(path.join(output, `failure-${tutorialId}-${width}-${workspaceLayout}.txt`), await page.locator('body').innerText());
          results.push({ width, workspaceLayout, tutorialId, passed: false, error: error.message, errors });
          console.error(`FAIL ${tutorialId}/${width}/${workspaceLayout}: ${error.message}`);
        } finally { await context.close(); }
      }
    }
  } finally { await browser.close(); fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(results, null, 2)); }
  console.log(JSON.stringify({ passed: results.filter(result => result.passed).length, failed: results.filter(result => !result.passed).length }));
  if (results.some(result => !result.passed)) process.exitCode = 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
