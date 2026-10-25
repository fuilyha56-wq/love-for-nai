/* eslint-disable @typescript-eslint/no-require-imports -- Local browser acceptance. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const { installContentFixtures } = require('./ui-content-fixtures.cjs');
const output = path.resolve('.tmp/discovery-ui');
fs.mkdirSync(output, { recursive: true });
const results = [];
async function check(name, action) {
  try { await action(); results.push({ name, passed: true }); console.log(`PASS ${name}`); }
  catch (error) { results.push({ name, passed: false, error: error.stack }); console.error(`FAIL ${name}: ${error.message}`); }
}
async function noOverflow(page) {
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Page overflows horizontally');
  for (const menu of await page.locator('[role=listbox]:visible').all()) {
    const box = await menu.boundingBox();
    assert(box && box.x >= 0 && box.x + box.width <= page.viewportSize().width + 1, 'Menu escapes the viewport');
  }
}
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    for (const [width, theme] of [[1440, 'paper'], [1440, 'night'], [390, 'paper'], [390, 'nai'], [320, 'night'], [768, 'dusk'], [840, 'paper']]) {
      if (process.env.LFN_DISCOVERY_CASES && !new RegExp(process.env.LFN_DISCOVERY_CASES).test(`${width}-${theme}`)) continue;
      const { context, page } = await setup(browser, { theme, workspaceLayout: 'lfn' }, { width, height: 960 });
      page.setDefaultTimeout(12000);
      page.setDefaultNavigationTimeout(90000);
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      const requests = [];
      let fail = false;
      await installContentFixtures(context);
      const items = Array.from({ length: 27 }, (_, index) => ({ id: `discovery-${index}`, title: `${index % 2 ? '山间来信' : '蓝色海岸'} ${index + 1}`, authorName: 'Alice', ownerName: 'LfN 创作者', rating: index % 3 ? 'general' : 'r13', source: 'lfn', tags: index % 2 ? ['forest', 'portrait'] : ['blue', 'portrait'], parameters: {}, imageUrl: `/api/gallery/discovery-${index}/image`, likes: index * 3, downloads: index * 5, uses: index * 2 }));
      await context.route('**/api/gallery?*', route => {
        const params = new URL(route.request().url()).searchParams;
        requests.push(params);
        if (fail) return route.fulfill({ status: 503, json: { message: '测试：暂时无法读取图库' } });
        const found = items.filter(item => (!params.get('q') || `${item.title} ${item.authorName} ${item.tags}`.includes(params.get('q'))) && params.getAll('tag').every(tag => item.tags.includes(tag)) && (params.get('rating') === 'all' || item.rating === params.get('rating')));
        const sort = params.get('sort');
        if (sort !== 'newest') found.sort((a, b) => b[sort] - a[sort]);
        const pageNumber = Math.min(Number(params.get('page')), Math.max(1, Math.ceil(found.length / 24)));
        return route.fulfill({ json: { items: found.slice((pageNumber - 1) * 24, pageNumber * 24), tags: ['blue', 'forest', 'portrait'], total: found.length, page: pageNumber, pageCount: Math.max(1, Math.ceil(found.length / 24)) } });
      });
      try {
        await check(`gallery-${width}-${theme}`, async () => {
          await page.goto(`${baseURL}/gallery`);
          const panel = page.getByRole('region', { name: '图片广场搜索与筛选' });
          await panel.getByText('27', { exact: true }).waitFor();
          assert.equal(await page.locator('select,datalist,dialog').count(), 0);
          await noOverflow(page);
          await page.screenshot({ path: `${output}/gallery-${width}-${theme}.png`, animations: 'disabled' });
          await panel.screenshot({ path: `${output}/gallery-controls-${width}-${theme}.png`, animations: 'disabled' });
          const search = page.getByRole('searchbox', { name: '搜索图片广场', exact: true });
          await search.fill('蓝色');
          await panel.getByText('14', { exact: true }).waitFor();
          assert.equal(requests.at(-1).get('q'), '蓝色');
          await page.getByRole('button', { name: '清空搜索图片广场', exact: true }).click();
          await panel.getByText('27', { exact: true }).waitFor();
          const tag = page.getByRole('combobox', { name: '按标签筛选作品', exact: true });
          await tag.fill('bl');
          await tag.press('ArrowDown'); await tag.press('Enter');
          assert.equal(await tag.inputValue(), 'blue, ');
          await page.getByRole('button', { name: '移除标签：blue', exact: true }).waitFor();
          await tag.fill('blue, por');
          await page.getByRole('option', { name: 'portrait', exact: true }).click();
          assert.equal(await tag.inputValue(), 'blue, portrait, ');
          await panel.getByText('14', { exact: true }).waitFor();
          assert.deepEqual(requests.at(-1).getAll('tag'), ['blue', 'portrait']);
          const rating = page.getByRole('button', { name: '按作品分级筛选', exact: true });
          await rating.click();
          await noOverflow(page);
          await page.screenshot({ path: `${output}/gallery-menu-${width}-${theme}.png`, animations: 'disabled' });
          await page.getByRole('option', { name: '全年龄', exact: true }).click();
          assert(await rating.evaluate(element => element === document.activeElement));
          const sort = page.getByRole('button', { name: '图库排序方式', exact: true });
          await sort.focus(); await sort.press('ArrowDown');
          await page.getByRole('listbox', { name: '图库排序方式', exact: true }).press('End');
          await page.keyboard.press('Enter');
          await page.waitForFunction(() => document.querySelector('[aria-label="图库排序方式"]')?.textContent.includes('导入使用最多'));
          await page.getByRole('button', { name: '重置筛选', exact: true }).click();
          await panel.getByText('27', { exact: true }).waitFor();
          assert.equal(await tag.inputValue(), '');
          await search.fill('no-such-work');
          await page.getByRole('heading', { name: '没有找到相关作品' }).waitFor();
          await page.getByRole('button', { name: '清空筛选，查看全部作品' }).click();
          await panel.getByText('27', { exact: true }).waitFor();
          await page.getByRole('button', { name: '下一页', exact: true }).click();
          await page.waitForFunction(() => document.body.textContent.includes('2 / 2') || document.body.textContent.includes('第 2 / 2'));
          fail = true;
          await page.getByRole('button', { name: /刷新/ }).click();
          await page.getByText('测试：暂时无法读取图库', { exact: true }).waitFor();
          fail = false;
          await page.getByRole('button', { name: '重试', exact: true }).click();
          await panel.getByText('27', { exact: true }).waitFor();
          await page.getByRole('button', { name: /^(投稿|投稿作品)$/ }).click();
          const dialog = page.getByRole('dialog', { name: '提交作品', exact: true });
          await dialog.waitFor();
          await dialog.getByRole('button', { name: '年龄评级', exact: true }).click();
          await page.getByRole('listbox', { name: '年龄评级', exact: true }).press('Escape');
          assert(await dialog.isVisible(), 'First Escape only closes dropdown');
          await dialog.getByRole('switch', { name: '公开提示词与生成参数' }).click();
          assert.equal(await dialog.getByRole('switch').getAttribute('aria-checked'), 'false');
          await dialog.getByRole('button', { name: '提交审核', exact: true }).click();
          await dialog.getByRole('alert').getByText('请选择要上传的图片', { exact: true }).waitFor();
          await page.screenshot({ path: `${output}/submit-${width}-${theme}.png`, animations: 'disabled' });
          await page.keyboard.press('Escape');
          await dialog.waitFor({ state: 'hidden' });
          assert.equal(errors.length, 0, errors.join('\n'));
        });
        await check(`docs-${width}-${theme}`, async () => {
          await page.goto(`${baseURL}/docs`);
          const panel = page.getByRole('region', { name: '文档搜索与筛选' });
          await panel.getByText('8', { exact: true }).waitFor();
          assert.equal(await page.locator('select,datalist,dialog').count(), 0);
          await noOverflow(page);
          await page.screenshot({ path: `${output}/docs-${width}-${theme}.png`, animations: 'disabled' });
          await panel.screenshot({ path: `${output}/docs-controls-${width}-${theme}.png`, animations: 'disabled' });
          const category = page.getByRole('button', { name: '文档分类', exact: true });
          await category.click(); await noOverflow(page);
          await page.screenshot({ path: `${output}/docs-menu-${width}-${theme}.png`, animations: 'disabled' });
          await page.getByRole('option', { name: /^API 参考/ }).click();
          await panel.getByText('3', { exact: true }).waitFor();
          const search = page.getByRole('searchbox', { name: '搜索全部文档内容' });
          await search.fill('不存在的参数');
          await page.getByRole('heading', { name: '没有找到相关文档' }).waitFor();
          await page.getByRole('button', { name: '清空筛选，查看全部文档' }).click();
          await panel.getByText('8', { exact: true }).waitFor();
          await search.fill('832');
          await panel.getByText('1', { exact: true }).waitFor();
          await page.getByRole('button', { name: '清空搜索全部文档内容' }).click();
          await panel.getByText('8', { exact: true }).waitFor();
          await category.click(); await page.keyboard.press('Tab');
          await page.getByRole('listbox').waitFor({ state: 'hidden' });
          if (width < 840) {
            await page.getByRole('navigation', { name: '文档目录' }).getByRole('button').first().click();
            await page.getByRole('article', { name: '快速开始' }).waitFor();
            assert.equal(await panel.count(), 0, 'Reader has no redundant filter panel');
            await page.getByRole('button', { name: '返回目录' }).click();
            await panel.waitFor();
          }
          assert.equal(errors.length, 0, errors.join('\n'));
        });
      } finally { await context.close(); }
    }
  } finally { await browser.close(); fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2)); }
  if (results.some(result => !result.passed)) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
