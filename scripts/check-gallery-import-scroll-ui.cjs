/* Run against a local test server; all API calls are intercepted. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
assert(process.env.LFN_UI_TEST_SESSION_SECRET, 'Set the local test server session secret for authenticated generation checks');
const output = '.tmp/gallery-import-scroll';
fs.mkdirSync(output, { recursive: true });
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aC1sAAAAASUVORK5CYII=', 'base64');
function textChunk(key, value) {
  const data = Buffer.concat([Buffer.from('tEXt'), Buffer.from(key + '\0' + value)]);
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  const length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(data.length - 4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, data, checksum]);
}
const parameters = { prompt: 'gallery import fixture, blue sky', uc: 'lowres', model: 'nai-v4-curated', width: 832, height: 1216, steps: 28, scale: 5, seed: 1234567, sampler: 'k_euler_ancestral' };
const image = Buffer.concat([png.subarray(0, -12), textChunk('Software', 'NovelAI'), textChunk('Comment', JSON.stringify(parameters)), png.subarray(-12)]);
const work = { id: 'import-fixture', title: '导入测试作品', ownerName: 'LFN', rating: 'general', source: 'lfn', tags: [], parameters, prompt: parameters.prompt, negativePrompt: 'lowres', imageUrl: '/api/gallery/import-fixture/image', likes: 0 };

async function fixture(browser, width, workspaceLayout = 'lfn') {
  const test = await setup(browser, { theme: 'light', workspaceLayout }, { width, height: 884 });
  await test.context.route('**/api/models', route => route.fulfill({ json: { items: [{ id: 'nai-v4-curated', kind: '图像模型' }] } }));
  await test.context.route('**/api/gallery**', route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/image')) return route.fulfill({ body: image, contentType: 'image/png' });
    if (url.pathname.endsWith('/use')) return route.fulfill({ json: { success: true } });
    if (url.pathname.endsWith('/import-fixture')) return route.fulfill({ json: { item: work } });
    return route.fulfill({ json: { items: [work], total: 1, page: 1, pageCount: 1 } });
  });
  return test;
}

async function openImport(page, width, detail = false) {
  await page.goto(`${baseURL}/gallery${detail ? '/import-fixture' : ''}`);
  if (detail && width < 840) await page.getByRole('button', { name: '图片信息', exact: true }).click();
  if (!detail && width < 840) {
    await page.getByRole('button', { name: '作品操作：导入测试作品', exact: true }).click();
    await page.getByRole('button', { name: '导入到画布', exact: true }).click();
  } else await page.getByRole('button', { name: '导入图片到工作台', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导入到画布', exact: true });
  await dialog.waitFor();
  const bounds = await dialog.boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= 885, 'Mode choices fit the viewport');
  assert.equal(await dialog.locator('select').count(), 0, 'Use LFN choices');
  return dialog;
}

async function importMode(browser, width, mode) {
  const { context, page, requests } = await fixture(browser, width);
  try {
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    // Both entry points offer the same choice; cancellation has no navigation or use side effect.
    let dialog = await openImport(page, width, true);
    await page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
    dialog = await openImport(page, width);
    await page.screenshot({ path: `${output}/choices-${width}-${mode}.png` });
    const choice = dialog.getByRole('link', { name: mode === 'generate' ? /^文生图/ : /^图生图/ });
    assert((await choice.getAttribute('href')).includes(`importMode=${mode}`));
    await choice.click();
    await page.waitForURL('**/image?**');
    await page.getByText(mode === 'generate' ? '已载入提示词和生成参数；当前为文生图，原图仅供预览。' : /已从 工作台导入.png 导入图片与生成参数/).first().waitFor();
    if (width < 840) {
      await page.locator('.mobile-studio-prompt-toggle').click();
      const prompt = page.locator('.mobile-studio-prompt-dialog');
      assert((await prompt.locator('textarea:visible').first().inputValue()).replaceAll('_', ' ').includes('gallery import fixture'));
      await prompt.getByRole('button', { name: '完成', exact: true }).click();
    } else assert((await page.getByLabel('描述画面', { exact: true }).inputValue()).includes('gallery import fixture'));
    const responsePromise = page.waitForResponse(response => response.url().endsWith('/api/images/operate') && response.request().method() === 'POST');
    await page.locator('[data-studio-generate]:visible').first().click();
    const confirmation = page.getByRole('button', { name: '确认并生成', exact: true });
    await Promise.race([responsePromise, confirmation.waitFor().then(() => confirmation.click())]);
    await responsePromise;
    const body = requests.find(request => request.path === '/api/images/operate')?.body;
    assert.equal(body.operation, mode);
    assert(body.prompt.replaceAll('_', ' ').includes('gallery import fixture'));
    assert.equal(body.width, 832); assert.equal(body.height, 1216); assert.equal(body.seed, 1234567);
    assert.equal(Boolean(body.image), mode === 'img2img', 'Only image-to-image submits a source image');
    assert.deepEqual(errors, []);
  } catch (error) {
    await page.screenshot({ path: `${output}/failure-${width}-${mode}.png` });
    throw new Error(`${error.message}; UI: ${(await page.locator('body').innerText()).slice(-1600)}`);
  } finally { await context.close(); }
}

async function scrollWorkspace(browser) {
  const { context, page } = await fixture(browser, 1254);
  try {
    await page.goto(`${baseURL}/image`);
    const input = page.getByLabel('描述画面', { exact: true }); await input.waitFor();
    await page.evaluate(() => document.fonts.ready);
    const canvas = page.locator('.studio-canvas');
    const initial = await canvas.evaluate(element => ({ height: element.clientHeight, total: element.scrollHeight }));
    assert(initial.total <= initial.height + 2, 'Normal layout still fits without extra vertical space');
    await input.evaluate(element => { element.style.height = '1100px'; });
    await page.screenshot({ path: `${output}/resized-top.png` });
    const bounds = await canvas.boundingBox();
    await page.mouse.move(bounds.x + bounds.width - 15, bounds.y + 150);
    await page.mouse.wheel(0, 1600);
    await page.waitForFunction(() => document.querySelector('.studio-canvas')?.scrollTop > 500);
    const preview = await page.locator('.studio-preview').boundingBox();
    assert(preview.height >= 280, 'Canvas keeps usable height when prompt editor grows');
    assert(preview.y < 884 && preview.y + preview.height > bounds.y, 'Wheel reveals the preview');
    assert(await page.locator('[data-studio-generate]:visible').first().isVisible());
    const generate = await page.locator('[data-studio-generate]:visible').first().boundingBox();
    assert(generate.y >= bounds.y && generate.y + generate.height <= 885, 'Generate button is reachable');
    await page.screenshot({ path: `${output}/resized-bottom.png` });
    await page.mouse.wheel(0, -1600);
    await page.waitForFunction(() => document.querySelector('.studio-canvas')?.scrollTop === 0);
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No horizontal page overflow');
  } finally { await context.close(); }
}

async function run() {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const results = [];
  try {
    for (const width of [1254, 620, 390]) for (const mode of ['generate', 'img2img']) {
      const name = `gallery import ${width} ${mode}`;
      try { await importMode(browser, width, mode); results.push({ name, passed: true }); }
      catch (error) { results.push({ name, passed: false, error: error.stack }); }
      console.log(JSON.stringify(results.at(-1)));
    }
    try { await scrollWorkspace(browser); results.push({ name: 'desktop wheel after prompt resize', passed: true }); }
    catch (error) { results.push({ name: 'desktop wheel after prompt resize', passed: false, error: error.stack }); }
    console.log(JSON.stringify(results.at(-1)));
  } finally { await browser.close(); }
  fs.writeFileSync(`${output}/results.json`, JSON.stringify(results, null, 2));
  if (results.some(result => !result.passed)) process.exitCode = 1;
}
run().catch(error => { console.error(error); process.exitCode = 1; });
