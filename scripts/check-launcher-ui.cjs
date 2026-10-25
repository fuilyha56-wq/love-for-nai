/* eslint-disable @typescript-eslint/no-require-imports -- Local browser acceptance runner. */
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const { seedEditorHistory } = require('./ui-history-fixture.cjs');
const { installContentFixtures } = require('./ui-content-fixtures.cjs');
const { installAdminFixtures } = require('./ui-admin-fixtures.cjs');
const output = path.resolve('.tmp/launcher-ui');
fs.mkdirSync(output, { recursive: true });
const reportFile = `report-${(process.env.LFN_UI_RUN || 'current').replace(/[^a-z0-9-]/gi, '-')}.json`;
const routes = (process.env.LFN_UI_ROUTES || '/image,/gallery,/history,/settings,/profile,/usage,/models,/pricing,/docs,/announcements,/notifications,/tags,/verify,/studio,/stories,/sign-in,/image/editor/history,/image/editor,/image/setting/layout,/gallery/layout-fixture,/history/layout-fixture,/admin').split(',');
const widths = (process.env.LFN_UI_WIDTHS || '320,390,600,808,839').split(',').map(Number);
const rows = [];
const fixtureImage = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="416" height="608" viewBox="0 0 416 608"><rect width="416" height="608" fill="#a9cfdf"/><circle cx="290" cy="130" r="52" fill="#fff3bd"/><path d="M0 440 140 200 320 490Z" fill="#647b93"/><path d="m78 305 62-105 79 128-74-30-21 24Z" fill="#eef3ef"/><path d="M130 608 330 300 460 608Z" fill="#496c72"/><path d="M0 500Q150 410 416 560V608H0Z" fill="#9da97c"/></svg>');
const history = Array.from({ length: 30 }, (_, i) => ({ id: `layout-fixture-${i}`, createdAt: new Date(Date.UTC(2026, 9, 23, 12, i)).toISOString(), imageUrl: `/api/history/layout-fixture-${i}/image`, parameters: { prompt: `Landscape ${i} with mountains, blue sky and clouds. A long prompt to check truncation and accessible actions.`, model: 'nai-v5-full', width: 832, height: 1216, steps: 28, scale: 5, sampler: 'k_euler_ancestral', operation: 'generate' } }));
const gallery = history.map((item, i) => ({ ...item, prompt: item.parameters.prompt, negativePrompt: 'low quality, text, watermark', title: `山间旅行 ${i + 1}`, ownerName: '布局测试', authorName: 'LFn 创作者', rating: i % 3 ? 'general' : 'r13', source: 'lfn', tags: ['landscape', 'blue sky', '中文标签'], likes: i, thumbnailUrl: item.imageUrl }));
(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    for (const route of routes) {
      const { context, page } = await setup(browser, { theme: process.env.LFN_UI_THEME || 'paper', workspaceLayout: process.env.LFN_UI_LAYOUT || 'lfn' });
      // Capture only this isolated browser's copy action without changing the host clipboard.
      await context.addInitScript(() => { window.__lfnCopiedText = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__lfnCopiedText = text; } } }); });
      const errors = [];
      const diagnostics = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('console', message => {
        if (message.type() === 'error' || message.type() === 'warning') diagnostics.push({ type: message.type(), text: message.text() });
        if (message.type() === 'error' && /hydration|hydrated|didn't match/i.test(message.text())) errors.push(message.text());
      });
      const contentFixtures = await installContentFixtures(context);
      const adminFixture = process.env.LFN_UI_ADMIN === '1' ? await installAdminFixtures(context, { gallery, documents: contentFixtures.documents, image: fixtureImage }) : null;
      await context.route('**/api/history**', async r => {
        const u = new URL(r.request().url());
        if (u.pathname.endsWith('/image')) return r.fulfill({ contentType: 'image/svg+xml', body: fixtureImage });
        if (r.request().method() !== 'GET') return r.fulfill({ status: 409, json: { message: '隔离验收禁止修改真实数据' } });
        return r.fulfill({ json: u.pathname === '/api/history' ? { items: history } : { item: history[0], ...history[0] } });
      });
      await context.route('**/api/gallery**', async r => {
        const u = new URL(r.request().url());
        if (u.pathname.endsWith('/image')) return r.fulfill({ contentType: 'image/svg+xml', body: fixtureImage });
        if (r.request().method() !== 'GET') return r.fulfill({ status: 409, json: { message: '隔离验收禁止外部操作' } });
        return r.fulfill({ json: u.pathname === '/api/gallery' ? { items: gallery } : u.pathname.endsWith('/mine') ? { items: gallery.slice(0, 3).map((item, i) => ({ ...item, status: ['approved', 'pending', 'rejected'][i], submittedAt: item.createdAt })) } : { item: gallery[0] } });
      });
      try {
        await page.goto(baseURL + route, { timeout: 90000 });
        if (route.startsWith('/image/editor/history')) { await seedEditorHistory(page, fixtureImage.toString()); await page.reload(); }
        await page.locator('.launcher-shell').waitFor();
        await page.waitForTimeout(1100);
        for (const width of widths) {
          await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
          await page.waitForTimeout(200);
          const geometry = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, height: innerHeight, title: document.querySelector('h1')?.textContent, rail: document.querySelector('.launcher-rail')?.getBoundingClientRect().width, viewport: document.querySelector('.launcher-content')?.getBoundingClientRect().width }));
          const file = `${route.replace(/\W+/g, '-').replace(/^-/, '') || 'home'}-${width}.png`;
          await page.screenshot({ path: path.join(output, file), animations: 'disabled' });
          assert(geometry.scrollWidth <= width + 1, `Horizontal overflow ${JSON.stringify(geometry)}`);
          rows.push({ route, width, passed: true, geometry, file, errors: [...errors] });
          console.log(`PASS ${route} ${width}`);
        }
        if (route.startsWith('/gallery/') || route.startsWith('/history/')) {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.getByRole('button', { name: '放大图片', exact: true }).click();
          assert.equal(await page.locator('.launcher-detail-stage').getAttribute('data-zoomed'), 'true');
          await page.getByRole('button', { name: '适应窗口', exact: true }).click();
          assert.equal(await page.locator('.launcher-detail-stage').getAttribute('data-zoomed'), 'false');
          await page.getByRole('button', { name: '图片信息', exact: true }).click();
          const metadata = page.getByRole('dialog', { name: '图片信息', exact: true });
          await metadata.waitFor();
          const bounds = await metadata.boundingBox();
          assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 391 && bounds.y + bounds.height <= 845, 'Adaptive image metadata fits the screen');
          await metadata.getByRole('button', { name: '展开正面提示词', exact: true }).click();
          assert.equal(await metadata.getByRole('button', { name: '收起正面提示词', exact: true }).getAttribute('aria-expanded'), 'true');
          await metadata.getByRole('button', { name: '复制正面提示词', exact: true }).click();
          assert((await page.evaluate(() => window.__lfnCopiedText)).includes('Landscape 0'), 'Prompt copy contains the actual metadata');
          await metadata.getByText('nai-v5-full', { exact: true }).first().scrollIntoViewIfNeeded();
          const download = metadata.locator('.image-download-menu summary');
          if (await download.count()) {
            await download.click();
            const choices = page.getByRole('menu', { name: '图片下载方式', exact: true });
            await choices.waitFor();
            assert((await choices.getByRole('menuitem').evaluateAll(items => items.map(el => el.getBoundingClientRect().height))).every(height => height >= 44), 'Nested download choices retain touch target size');
            await page.keyboard.press('Escape');
            assert(await metadata.isVisible(), 'Closing a nested download menu preserves the image information panel');
          }
          await page.screenshot({ path: path.join(output, route.replace(/\W+/g, '-') + '-metadata.png') });
          await page.keyboard.press('Escape');
          assert(await page.getByRole('button', { name: '图片信息', exact: true }).evaluate(el => el === document.activeElement), 'Metadata restores focus');
          await page.setViewportSize({ width: 808, height: 1000 });
          await page.getByRole('button', { name: '图片信息', exact: true }).click();
          await metadata.waitFor();
          const expandedBounds = await metadata.boundingBox();
          assert(expandedBounds && expandedBounds.x >= 0 && expandedBounds.x + expandedBounds.width <= 809 && expandedBounds.y + expandedBounds.height <= 1001, 'Image information remains reachable at the largest phone size');
          await page.keyboard.press('Escape');
          rows.push({ route, state: 'phone-metadata-prompt-copy-and-download', passed: true, errors: [...errors] });
        }
        if (route.startsWith('/image/editor/history?draftId=')) {
          await page.setViewportSize({ width: 390, height: 844 });
          const preview = await page.locator('.redraw-preview-image').boundingBox();
          assert(preview && preview.y < 320 && preview.y + preview.height < 780, 'The selected result leads the compact history page');
          await page.getByRole('button', { name: '版本与历史', exact: true }).click();
          const versions = page.getByRole('dialog', { name: '版本与历史', exact: true });
          await versions.waitFor();
          assert.equal(await versions.getByRole('treeitem').count(), 3, 'All seeded nodes remain reachable');
          await page.screenshot({ path: path.join(output, 'redraw-versions-dialog.png') });
          await versions.getByRole('treeitem', { name: /局部重绘 · 山间旅行/ }).click();
          await versions.waitFor({ state: 'hidden' });
          await page.locator('.redraw-preview-toolbar strong').filter({ hasText: '局部重绘' }).waitFor({ timeout: 10000 });
          await page.getByRole('button', { name: '命名作品', exact: true }).click();
          const rename = page.getByRole('dialog', { name: '重命名作品', exact: true });
          await rename.getByRole('textbox').fill('山间旅行 · 验收命名');
          await rename.getByRole('button', { name: '确认', exact: true }).click();
          await page.getByRole('heading', { name: '山间旅行 · 验收命名', exact: true }).waitFor();
          await page.getByRole('button', { name: '删除当前重绘作品', exact: true }).click();
          const confirmation = page.getByRole('dialog', { name: '确认操作', exact: true });
          await confirmation.getByRole('button', { name: '取消', exact: true }).click();
          assert(await page.getByRole('heading', { name: '山间旅行 · 验收命名', exact: true }).isVisible(), 'Cancelling deletion preserves the project');
          await page.getByRole('button', { name: '版本与历史', exact: true }).click();
          await page.getByRole('dialog', { name: '版本与历史', exact: true }).getByRole('button', { name: '从选中节点新建分支', exact: true }).click();
          const fork = page.getByRole('dialog', { name: '从此节点新建分支', exact: true });
          await fork.getByRole('textbox').fill('布局验收新分支');
          await page.keyboard.press('Tab');
          assert(await fork.evaluate(el => el.contains(document.activeElement)), 'Nested form keeps focus above the version picker');
          await page.screenshot({ path: path.join(output, 'redraw-branch-prompt.png') });
          await fork.getByRole('button', { name: '确认', exact: true }).click();
          await page.getByRole('dialog', { name: '版本与历史', exact: true }).getByRole('button', { name: /布局验收新分支/ }).waitFor();
          await page.getByRole('button', { name: '关闭版本与历史', exact: true }).click();
          rows.push({ route, state: 'compact-versions-and-preview', passed: true, errors: [...errors] });
        }
        if (route.startsWith('/sign-in')) {
          const username = page.locator('input[name=username]');
          const password = page.locator('input[name=password]');
          await username.fill('layout-fixture'); await password.fill('layout-password-for-local-test');
          await page.getByRole('button', { name: '登录', exact: true }).click();
          await page.getByText('隔离验收：凭据或验证码不正确', { exact: true }).waitFor();
          contentFixtures.setAuthMode('two-factor');
          await page.getByRole('button', { name: '登录', exact: true }).click();
          await page.getByRole('button', { name: '验证并登录', exact: true }).waitFor();
          for (const width of widths) {
            await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
            await page.screenshot({ path: path.join(output, `sign-in-two-factor-${width}.png`), animations: 'disabled' });
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          }
          await page.getByRole('button', { name: '返回重新登录', exact: true }).click();
          await page.getByRole('button', { name: '访问令牌', exact: true }).click();
          await page.getByRole('textbox', { name: '访问令牌', exact: true }).fill('layout-token-for-local-test');
          contentFixtures.setAuthMode('error');
          await page.getByRole('button', { name: '使用令牌登录', exact: true }).click();
          await page.getByText('隔离验收：凭据或验证码不正确', { exact: true }).waitFor();
          await page.getByRole('button', { name: '注册', exact: true }).click();
          await username.fill('layout-new-account'); await password.fill('layout-password-for-local-test');
          await page.locator('input[type=email]').fill('layout@example.invalid');
          await page.getByRole('button', { name: '获取验证码', exact: true }).click();
          await page.getByText('验证码已发送，请查收邮箱。', { exact: true }).waitFor();
          await page.getByLabel('邮箱验证码', { exact: true }).fill('123456');
          for (const width of widths) {
            await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
            await page.screenshot({ path: path.join(output, `sign-in-register-${width}.png`), animations: 'disabled' });
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Registration fields stay inside the form');
          }
          await page.getByRole('button', { name: '注册账号', exact: true }).click();
          await page.getByText('注册成功，请使用新账号登录。', { exact: true }).waitFor();
          await username.fill('layout-fixture'); await password.fill('layout-password-for-local-test');
          contentFixtures.setAuthMode('success');
          await page.getByRole('button', { name: '登录', exact: true }).click();
          const next = new URL(route, baseURL).searchParams.get('next') || '/image';
          await page.waitForURL(baseURL + next);
          rows.push({ route, state: 'auth-errors-token-register-two-factor-and-return', passed: true, errors: [...errors] });
        }
        if (route === '/profile') {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.locator('.profile-content').waitFor({ state: 'hidden' });
          await page.locator('a[href="#account-security"]').waitFor();
          for (const section of ['profile-wallet', 'profile-rewards', 'profile-redeem', 'profile-info', 'account-security', 'profile-security']) {
            await page.locator(`.profile-sidebar a[href="#${section}"]`).click();
            await page.locator(`#${section}`).waitFor({ state: 'visible' });
            for (const width of widths) {
              await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
              await page.screenshot({ path: path.join(output, `${section}-${width}.png`), animations: 'disabled' });
              assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
            }
            await page.setViewportSize({ width: 390, height: 844 });
            if (section === 'profile-wallet') {
              await page.getByRole('button', { name: /\$10 购买/ }).click();
              await page.getByRole('dialog', { name: '确认操作', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
            }
            if (section === 'profile-rewards') {
              await page.getByRole('button', { name: '复制邀请链接', exact: true }).click();
              assert((await page.evaluate(() => window.__lfnCopiedText)).includes('invite=layout-example'));
            }
            await page.getByRole('link', { name: '返回账号分类', exact: true }).click();
            await page.getByRole('navigation', { name: '个人资料分区', exact: true }).waitFor({ state: 'visible' });
          }
          rows.push({ route, state: 'account-categories-wallet-redeem-security-and-return', passed: true, errors: [...errors] });
        }
        if (route.startsWith('/tags?q=')) {
          await page.locator('a[href^="/tags?key="]').first().click();
          await page.getByRole('button', { name: '复制标签', exact: true }).click();
          assert((await page.evaluate(() => window.__lfnCopiedText)).startsWith('mountain_landscape'));
          await page.getByRole('link', { name: '返回检索结果', exact: true }).click();
          await page.getByRole('heading', { name: '标签检索结果', exact: true }).waitFor();
          rows.push({ route, state: 'tag-detail-copy-and-return-to-search', passed: true, errors: [...errors] });
        }
        if (route.startsWith('/admin?')) {
          const tab = new URL(route, baseURL).searchParams.get('tab');
          const inspectModal = async (trigger, label) => {
            await page.setViewportSize({ width: 390, height: 844 });
            await trigger.click();
            const dialog = page.getByRole('dialog', { name: label, exact: true });
            await dialog.waitFor();
            for (const width of widths) {
              await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
              const bounds = await dialog.boundingBox();
              assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= (width < 600 ? 845 : 1001), `${label} fits ${width}`);
              await page.screenshot({ path: path.join(output, `admin-${tab}-${label}-${width}.png`), animations: 'disabled' });
              if (label === '作品预览') {
                const frame = await dialog.locator('.admin-preview-image').boundingBox();
                const picture = await dialog.locator('.admin-preview-image img').boundingBox();
                assert(frame && picture && picture.y >= frame.y && picture.y + picture.height <= frame.y + frame.height + 1, 'The image stays in its preview frame');
              }
            }
            await page.setViewportSize({ width: 390, height: 844 });
            await page.evaluate(() => { Object.defineProperty(visualViewport, 'height', { value: 400, configurable: true }); visualViewport.dispatchEvent(new Event('resize')); });
            await page.waitForFunction(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lfn-viewport-height')) <= 401);
            const reduced = await dialog.boundingBox();
            assert(reduced && reduced.y + reduced.height <= 401, `${label} respects the reduced keyboard viewport`);
            await page.keyboard.press('Tab');
            assert(await dialog.evaluate(el => el.contains(document.activeElement)), `${label} retains keyboard focus`);
            await page.keyboard.press('Escape');
            await dialog.waitFor({ state: 'hidden' });
            await page.evaluate(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize')); });
            await page.setViewportSize({ width: 390, height: 844 });
          };
          if (tab === 'users') await inspectModal(page.getByRole('button', { name: '编辑', exact: true }).first(), '编辑用户');
          if (tab === 'gallery' || tab === 'creator') {
            await inspectModal(page.getByRole('button', { name: '编辑', exact: true }).first(), '编辑作品');
            await inspectModal(page.getByRole('button', { name: /查看作品：/ }).first(), '作品预览');
          }
          if (tab === 'announcements') {
            await inspectModal(page.getByRole('button', { name: '新建公告', exact: true }), '新建公告');
            await inspectModal(page.getByRole('button', { name: '编辑', exact: true }).first(), '编辑公告');
            await inspectModal(page.getByRole('button', { name: '评论', exact: true }).first(), '公告详情与社区评论');
          }
          if (tab === 'platform') await inspectModal(page.getByRole('button', { name: '添加端点', exact: true }), '添加端点');
          if (tab === 'activities') {
            await page.setViewportSize({ width: 390, height: 844 });
            await page.getByRole('button', { name: /山间旅行创作活动/ }).click();
            assert(await page.getByRole('heading', { name: '山间旅行创作活动', exact: true }).isVisible());
            await page.screenshot({ path: path.join(output, 'admin-activity-editor-390.png'), animations: 'disabled' });
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          }
          rows.push({ route, state: 'admin-content-and-adaptive-modals', passed: true, unknownFixtures: [...new Set(adminFixture?.unknown || [])], errors: [...errors] });
        }
        if (route === '/verify') {
          const input = page.locator('input[type=file]');
          const buffer = Buffer.from(await page.evaluate(async svg => { const image = new Image(); image.src = 'data:image/svg+xml;base64,' + btoa(svg); await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height; canvas.getContext('2d').drawImage(image, 0, 0); return canvas.toDataURL('image/png').split(',')[1]; }, fixtureImage.toString()), 'base64');
          await input.setInputFiles({ name: 'layout-landscape.png', mimeType: 'image/png', buffer });
          await page.getByText('✓ 验证通过：图片来自 Love-for-NAI', { exact: true }).waitFor();
          for (const width of widths) {
            await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Long verification identifiers wrap within the page');
            await page.locator('.verify-results').scrollIntoViewIfNeeded();
            await page.screenshot({ path: path.join(output, `verify-result-${width}.png`), animations: 'disabled' });
          }
          contentFixtures.setVerificationMode('invalid');
          await input.setInputFiles({ name: 'unverified.png', mimeType: 'image/png', buffer });
          await page.getByText('未找到可验证的 LFn 签名', { exact: true }).waitFor();
          contentFixtures.setVerificationMode('network');
          await input.setInputFiles({ name: 'network.png', mimeType: 'image/png', buffer });
          await page.getByText('Failed to fetch', { exact: true }).waitFor();
          rows.push({ route, state: 'verification-results-long-identifiers-and-errors', passed: true, errors: [...errors] });
        }
        if (route === '/studio') {
          await page.setViewportSize({ width: 390, height: 844 });
          await page.getByRole('button', { name: '提交新作品', exact: true }).click();
          const dialog = page.getByRole('dialog', { name: '提交作品', exact: true });
          await dialog.waitFor();
          for (const width of widths) {
            await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
            await page.screenshot({ path: path.join(output, `studio-submission-${width}.png`), animations: 'disabled' });
            const bounds = await dialog.boundingBox();
            assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1, 'Submission fits the page width');
          }
          await page.setViewportSize({ width: 390, height: 844 });
          await dialog.getByRole('button', { name: '年龄评级', exact: true }).click();
          await page.getByRole('option', { name: /R13/ }).click();
          await dialog.getByRole('button', { name: '提交审核', exact: true }).click();
          await dialog.getByRole('alert').filter({ hasText: '请选择要上传的图片' }).waitFor();
          await page.evaluate(() => { Object.defineProperty(visualViewport, 'height', { value: 400, configurable: true }); visualViewport.dispatchEvent(new Event('resize')); });
          await page.waitForFunction(() => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--lfn-viewport-height')) <= 401);
          const reduced = await dialog.boundingBox();
          assert(reduced && reduced.y + reduced.height <= 401, 'Submission follows the actual keyboard viewport');
          await page.screenshot({ path: path.join(output, 'studio-submission-keyboard.png'), animations: 'disabled' });
          await page.keyboard.press('Escape');
          await dialog.waitFor({ state: 'hidden' });
          await page.evaluate(() => { delete visualViewport.height; visualViewport.dispatchEvent(new Event('resize')); });
          rows.push({ route, state: 'submission-rating-and-close', passed: true, errors: [...errors] });
        }
        if (route === '/docs') {
          await page.setViewportSize({ width: 390, height: 844 });
          assert(!(await page.locator('.docs-article').isVisible()), 'Compact docs starts with the directory');
          await page.getByRole('navigation', { name: '文档目录' }).getByRole('button', { name: /快速开始/ }).click();
          for (const width of widths) {
            await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
            assert(await page.locator('.docs-article').isVisible());
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Code samples do not widen the whole page');
            await page.screenshot({ path: path.join(output, `docs-article-${width}.png`), animations: 'disabled' });
          }
          await page.setViewportSize({ width: 390, height: 844 });
          await page.getByRole('button', { name: '返回目录', exact: true }).click();
          await page.getByRole('navigation', { name: '文档目录' }).getByRole('button', { name: /模型与参数参考 7/ }).click();
          assert(await page.getByRole('article', { name: '模型与参数参考 7', exact: true }).isVisible());
          rows.push({ route, state: 'directory-article-code-and-return', passed: true, errors: [...errors] });
        }
        if (route === '/usage') {
          await page.setViewportSize({ width: 390, height: 844 });
          const first = page.locator('.usage-log-row').first();
          assert((await first.boundingBox()).y < 360, 'Primary filters leave records in the first screen');
          await first.click();
          assert.equal(await first.getAttribute('aria-expanded'), 'true');
          await page.getByText('计费与用量', { exact: true }).waitFor();
          await page.screenshot({ path: path.join(output, 'usage-record-detail.png'), animations: 'disabled' });
          await page.getByRole('button', { name: '状态筛选', exact: true }).click();
          await page.getByRole('option', { name: '失败', exact: true }).click();
          await page.waitForFunction(() => document.querySelectorAll('.usage-log-row').length === 6);
          await page.getByRole('button', { name: '状态筛选', exact: true }).click();
          await page.getByRole('option', { name: '全部状态', exact: true }).click();
          await page.getByRole('button', { name: '下一页', exact: true }).click();
          await page.waitForFunction(() => document.querySelectorAll('.usage-log-row').length === 2);
          await page.getByRole('button', { name: '更多筛选', exact: true }).click();
          await page.getByRole('textbox', { name: '请求 ID', exact: true }).fill('layout-request-1');
          await page.waitForFunction(() => document.querySelectorAll('.usage-log-row').length === 11);
          await page.screenshot({ path: path.join(output, 'usage-advanced-filters.png'), animations: 'disabled' });
          await page.locator('.date-range-trigger').click();
          const dates = page.locator('.date-range-popover');
          await dates.waitFor();
          const bounds = await dates.boundingBox();
          assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391 && bounds.y + bounds.height <= 845, 'Date selection stays in the compact viewport');
          await dates.getByRole('button', { name: '最近 7 天', exact: true }).click();
          rows.push({ route, state: 'record-details-filters-pagination-and-dates', passed: true, errors: [...errors] });
        }
        if (route === '/notifications') {
          await page.setViewportSize({ width: 390, height: 844 });
          const failed = r => r.abort();
          await context.route('**/api/notifications', failed);
          await page.getByRole('button', { name: '全部已读', exact: true }).click();
          await page.getByRole('status').filter({ hasText: '标记已读失败' }).waitFor();
          assert(await page.getByText('2 条未读', { exact: true }).isVisible());
          await page.screenshot({ path: path.join(output, 'notifications-error.png') });
          await context.unroute('**/api/notifications', failed);
          await page.getByRole('button', { name: '全部已读', exact: true }).click();
          await page.waitForFunction(() => document.querySelector('button:disabled')?.textContent.includes('全部已读'));
          assert.equal(await page.getByText('2 条未读', { exact: true }).count(), 0);
          await page.getByRole('button', { name: /山间来信回复了你的评论/ }).first().click();
          await page.waitForURL('**/announcements');
          rows.push({ route, state: 'read-receipts-errors-and-open', passed: true, errors: [...errors] });
        }
        if (route === '/announcements') {
          await page.setViewportSize({ width: 390, height: 844 });
          const comment = page.locator('#announcement-comment-layout-comment');
          await comment.getByRole('button', { name: '评论操作', exact: true }).first().click();
          await page.getByRole('menuitem', { name: '不显示此评论', exact: true }).click();
          await comment.getByRole('button', { name: '恢复显示', exact: true }).click();
          await comment.getByRole('button', { name: '赞同评论', exact: true }).first().click();
          await page.waitForFunction(() => document.querySelector('#announcement-comment-layout-comment [aria-label="赞同评论"]')?.getAttribute('aria-pressed') === 'true');
          await comment.getByRole('button', { name: '回复', exact: true }).first().click();
          await comment.getByPlaceholder('回复 山间来信…', { exact: true }).fill('这是一条仅存在于隔离浏览器的布局验收回复。');
          await comment.getByRole('button', { name: '发送', exact: true }).click();
          await page.getByText('这是一条仅存在于隔离浏览器的布局验收回复。', { exact: true }).waitFor();
          const own = page.locator('#announcement-comment-layout-reply');
          await own.getByRole('button', { name: '评论操作', exact: true }).click();
          await page.screenshot({ path: path.join(output, 'announcement-comment-menu.png'), animations: 'disabled' });
          await page.getByRole('menuitem', { name: '删除我的评论', exact: true }).click();
          await page.getByRole('dialog', { name: '确认操作', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
          assert(await own.isVisible(), 'Cancelling comment deletion preserves the thread');
          rows.push({ route, state: 'comments-reply-vote-hide-and-cancel-delete', passed: true, errors: [...errors] });
        }
        if (route === '/stories') {
          await page.getByRole('searchbox', { name: '搜索故事工作台' }).fill('山间');
          assert.equal(await page.locator('.story-dashboard-card').count(), 1);
          await page.locator('.story-dashboard-card').click();
          for (const width of widths) {
            await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
            await page.waitForTimeout(100);
            await page.screenshot({ path: path.join(output, `stories-editor-${width}.png`), animations: 'disabled' });
            const box = await page.locator('.story-generation-dock').boundingBox();
            assert(box && box.y > 120 && box.y + box.height <= (width < 600 ? 845 : 1001), 'Story generation stays in the viewport');
            assert(await page.getByRole('textbox', { name: '故事正文', exact: true }).evaluate(el => el.scrollHeight <= el.clientHeight + 2), 'Long prose remains reachable by the writing stage scroll');
            assert.equal(await page.locator('.launcher-bottom-nav:visible').count(), 0, 'The writing workspace owns its bottom toolbar');
          }
          await page.setViewportSize({ width: 390, height: 844 });
          await page.getByRole('button', { name: '打开设置', exact: true }).click();
          const settings = page.getByRole('dialog', { name: '故事设置', exact: true });
          await settings.waitFor();
          for (const width of widths.filter(width => width < 1100)) {
            await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
            const bounds = await settings.boundingBox();
            assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y + bounds.height <= (width < 600 ? 845 : 1001), 'Story settings fits each compact size');
          }
          await page.setViewportSize({ width: 390, height: 844 });
          for (const tab of ['故事', '高级', '设置']) {
            await settings.getByRole('tab', { name: tab, exact: true }).click();
            await page.screenshot({ path: path.join(output, `stories-settings-${tab}.png`), animations: 'disabled' });
          }
          await settings.getByRole('button', { name: '导出当前分支', exact: true }).click();
          await settings.getByRole('button', { name: '删除故事', exact: true }).click();
          await page.getByRole('dialog', { name: '确认操作', exact: true }).getByRole('button', { name: '取消', exact: true }).click();
          assert(await settings.isVisible(), 'Cancelling deletion returns to story settings');
          await settings.getByRole('tab', { name: '故事', exact: true }).click();
          await settings.getByRole('button', { name: '故事 AI 模型', exact: true }).click();
          await page.getByRole('option', { name: /Luna/ }).click();
          await page.waitForFunction(() => document.querySelector('[aria-label="故事 AI 模型"]')?.textContent.includes('Luna'));
          await settings.getByRole('button', { name: '故事 AI 模型', exact: true }).click();
          await page.getByRole('listbox').waitFor();
          await page.keyboard.press('Escape');
          assert(await settings.isVisible(), 'Closing a model picker preserves story settings');
          await page.keyboard.press('Escape');
          await settings.waitFor({ state: 'hidden' });
          await page.getByRole('textbox', { name: '本次生成指令', exact: true }).fill('在山路尽头揭示一封回信');
          await page.setViewportSize({ width: 390, height: 400 });
          await page.waitForTimeout(150);
          const keyboardDock = await page.locator('.story-generation-dock').boundingBox();
          assert(keyboardDock && keyboardDock.y + keyboardDock.height <= 401, 'The keyboard does not cover story generation');
          await page.screenshot({ path: path.join(output, 'stories-keyboard.png') });
          await page.getByRole('button', { name: '生成故事', exact: true }).click();
          await page.waitForFunction(() => document.querySelector('[aria-label="故事正文"]')?.value.includes('隔离验收文本'));
          await page.setViewportSize({ width: 390, height: 844 });
          const body = page.getByRole('textbox', { name: '故事正文', exact: true });
          await body.fill('主线的最新草稿，切换分支后仍须保存。');
          await page.getByRole('button', { name: '管理故事分支', exact: true }).click();
          const branches = page.getByRole('dialog', { name: '故事分支', exact: true });
          await page.screenshot({ path: path.join(output, 'stories-branches.png'), animations: 'disabled' });
          await branches.getByRole('button', { name: /另一条山路/ }).click();
          await page.waitForFunction(() => document.querySelector('[aria-label="故事正文"]')?.value === '她选择了通往河谷的小路。');
          await page.waitForTimeout(850);
          assert.equal(await body.inputValue(), '她选择了通往河谷的小路。', 'A previous branch autosave does not change the active branch');
          assert(contentFixtures.writes.some(item => item.input.branch?.content === '主线的最新草稿，切换分支后仍须保存。'), 'Pending content is saved after a branch switch');
          await page.getByRole('button', { name: '管理故事分支', exact: true }).click();
          await branches.getByRole('button', { name: '从当前正文创建分支', exact: true }).click();
          await branches.waitFor({ state: 'hidden' });
          await page.getByRole('button', { name: '打开故事列表', exact: true }).click();
          const library = page.getByRole('dialog', { name: '故事列表', exact: true });
          await page.screenshot({ path: path.join(output, 'stories-library.png') });
          await library.getByRole('button', { name: '新建故事', exact: true }).click();
          for (const width of widths) {
            await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
            await page.screenshot({ path: path.join(output, `stories-create-${width}.png`), animations: 'disabled' });
            assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
          }
          await page.getByRole('textbox', { name: '故事标题', exact: true }).fill('验收故事');
          await page.getByRole('button', { name: '奇幻旅途', exact: true }).click();
          await page.getByRole('button', { name: '创建故事', exact: true }).click();
          await page.getByRole('textbox', { name: '故事标题', exact: true }).waitFor();
          assert.equal(await page.getByRole('textbox', { name: '故事标题', exact: true }).inputValue(), '验收故事');
          await page.getByRole('button', { name: '返回故事首页', exact: true }).click();
          await page.locator('.launcher-story-actions input[type=file]').setInputFiles({ name: '导入验收.txt', mimeType: 'text/plain', buffer: Buffer.from('从本地文本导入的第一段故事。') });
          await page.waitForFunction(() => document.querySelector('[aria-label="故事正文"]')?.value === '从本地文本导入的第一段故事。');
          rows.push({ route, state: 'story-editor-create-settings-branches-import-and-keyboard', passed: true, writes: contentFixtures.writes.length, errors: [...errors] });
        }
        if (route === '/settings#appearance') {
          for (const width of widths) {
            await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
            await page.getByRole('button', { name: '选择自定义强调色', exact: true }).click();
            const picker = page.getByRole('dialog', { name: 'LFN 取色器', exact: true });
            const colorBounds = await picker.boundingBox();
            assert(colorBounds && colorBounds.x >= 0 && colorBounds.x + colorBounds.width <= width + 1 && colorBounds.y >= 0 && colorBounds.y + colorBounds.height <= (width < 600 ? 845 : 1001));
            await picker.getByRole('button', { name: '选择 #4076a7', exact: true }).click();
            await picker.getByRole('textbox', { name: '颜色代码', exact: true }).fill('#4e8566');
            assert.equal(await picker.getByRole('slider', { name: '绿色通道', exact: true }).inputValue(), '133');
            await page.screenshot({ path: path.join(output, `lfn-color-picker-${width}.png`), animations: 'disabled' });
            await page.keyboard.press('Escape');
            assert(await page.getByRole('button', { name: '选择自定义强调色', exact: true }).evaluate(el => el === document.activeElement));
          }
          await page.setViewportSize({ width: 390, height: 844 });
          await page.getByRole('link', { name: '返回设置分类', exact: true }).click();
          assert(await page.getByRole('navigation', { name: '设置分类', exact: true }).isVisible(), 'Compact settings returns to the category list');
          assert(!(await page.locator('.settings-content').isVisible()), 'Category list does not leave a second form behind it');
          await page.getByRole('navigation', { name: '设置分类', exact: true }).getByRole('link', { name: '模型与密钥', exact: true }).click();
          await page.getByRole('heading', { name: '模型与密钥', exact: true }).waitFor();
          rows.push({ route, state: 'category-return-and-change', passed: true, errors: [...errors] });
        }
        if (route === '/gallery' || route === '/history') {
          if (route === '/gallery') {
            assert.equal(await page.locator('select').count(), 0, 'Gallery uses the LFn selector throughout');
            for (const width of widths) {
              await page.setViewportSize({ width, height: width < 600 ? 844 : 1000 });
              await page.getByRole('button', { name: '作品分级', exact: true }).click();
              const menu = page.getByRole('listbox', { name: '作品分级', exact: true });
              await menu.waitFor();
              const bounds = await menu.boundingBox();
              assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= (width < 600 ? 845 : 1001));
              assert.equal(await menu.getByRole('option').count(), 5);
              await page.screenshot({ path: path.join(output, `lfn-gallery-rating-${width}.png`), animations: 'disabled' });
              await menu.getByRole('option', { name: 'R13', exact: true }).click();
              assert.equal(await page.locator('.launcher-image-card').count(), 10, 'Rating filters actual loaded images');
              await page.getByRole('button', { name: '作品分级', exact: true }).focus();
              await page.keyboard.press('ArrowDown');
              await page.getByRole('listbox', { name: '作品分级', exact: true }).waitFor();
              assert.equal(await page.locator('.launcher-image-card').count(), 10, 'Opening with arrows preserves the selected value');
              await page.keyboard.press('Home');
              await page.keyboard.press('Enter');
              assert.equal(await page.locator('.launcher-image-card').count(), 24);
            }
            rows.push({ route, state: 'lfn-rating-menu-filter-and-keyboard', passed: true, errors: [...errors] });
          }
          await page.setViewportSize({ width: 390, height: 844 });
          await page.evaluate(() => scrollTo(0, 0));
          const trigger = page.locator('.launcher-image-menu-button').first();
          await trigger.click();
          const menu = page.locator('.launcher-image-menu');
          await menu.waitFor();
          const bounds = await menu.boundingBox();
          assert(bounds && bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= 391 && bounds.y + bounds.height <= 845, 'Image actions fit within viewport');
          const targets = await menu.locator('button,a,summary').evaluateAll(items => items.filter(el => el.getClientRects().length).map(el => ({ height: el.getBoundingClientRect().height, label: el.textContent })));
          assert(targets.every(item => item.height >= 44 && item.label?.trim()), 'Every image action has a readable label and touch target');
          await page.screenshot({ path: path.join(output, route.slice(1) + '-menu.png') });
          await page.keyboard.press('Escape');
          assert(await trigger.evaluate(el => el === document.activeElement), 'Image menu restores focus');
          const query = page.getByRole('searchbox');
          await query.fill(route === '/gallery' ? '山间旅行 30' : 'Landscape 29');
          assert.equal(await page.locator(route === '/gallery' ? '.launcher-image-card' : '.history-card').count(), 1, 'Collection search filters loaded images');
          await query.fill('');
          await page.getByRole('button', { name: '下一页', exact: true }).click();
          assert.equal(await page.locator(route === '/gallery' ? '.launcher-image-card' : '.history-card').count(), 6, 'Collection paging preserves all loaded items');
          rows.push({ route, state: 'menu-search-pagination', passed: true, errors: [...errors] });
        }

      } catch (error) { rows.push({ route, passed: false, error: error.message, errors }); console.log(`FAIL ${route}: ${error.message}`); }
      finally { if (diagnostics.length) fs.writeFileSync(path.join(output, `console-${route.replace(/\W+/g, '-')}.json`), JSON.stringify(diagnostics, null, 2)); if (adminFixture?.unknown.length) console.log(`UNMOCKED ${route}: ${[...new Set(adminFixture.unknown)].join(", ")}`); await context.close(); }
      fs.writeFileSync(path.join(output, reportFile), JSON.stringify(rows, null, 2));
    }
  } finally { await browser.close(); }
  console.log(JSON.stringify({ scenarios: rows.length, failed: rows.filter(row => !row.passed).length, errors: rows.flatMap(row => row.errors || []) }));
  if (rows.some(row => !row.passed || row.errors?.length)) process.exitCode = 1;
})();
