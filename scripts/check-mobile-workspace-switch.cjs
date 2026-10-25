/* Measure local click-to-paint with 120 prompt tags. Timing is diagnostic;
   dialog identity is the regression assertion. All API writes are intercepted. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const { context, page } = await setup(browser, {}, { width: 620, height: 884 });
  page.setDefaultNavigationTimeout(90000);
  try {
    await page.goto(baseURL + '/image');
    await page.locator('.mobile-studio-prompt-toggle').first().click();
    await page.getByRole('dialog', { name: '提示词区域', exact: true }).locator('textarea').first()
      .fill(Array.from({ length: 120 }, (_, i) => `tag_${i}`).join(', '));
    await page.waitForTimeout(250);
    const rows = [];
    for (const target of ['参数', '助手', '提示词', '参数', '助手', '提示词']) {
      rows.push(await page.evaluate(async target => {
        const visibleDialog = () => [...document.querySelectorAll('[role=dialog][aria-modal=true]')].find(el => el.getClientRects().length);
        const before = visibleDialog(); const start = performance.now();
        [...before.querySelectorAll('.mobile-studio-workspace-switch button')].find(el => el.textContent.trim() === target).click();
        await new Promise((resolve, reject) => {
          function frame() {
            const next = visibleDialog();
            if (next?.querySelector('.mobile-studio-workspace-switch [aria-current=page]')?.textContent.trim() === target && Number(getComputedStyle(next).opacity) > .99) { requestAnimationFrame(resolve); return; }
            if (performance.now() - start > 5000) { reject(new Error('Workspace did not switch')); return; }
            requestAnimationFrame(frame);
          }
          requestAnimationFrame(frame);
        });
        return { target, paintMs: Math.round(performance.now() - start), sameDialog: before === visibleDialog() };
      }, target));
    }
    assert(rows.every(row => row.sameDialog), 'Workspace navigation must retain the dialog');
    const result = { rows, meanMs: Math.round(rows.reduce((sum, row) => sum + row.paintMs, 0) / rows.length) };
    fs.mkdirSync('.tmp/mobile-workspace', { recursive: true });
    fs.writeFileSync('.tmp/mobile-workspace/switch-performance.json', JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally { await context.close(); await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
