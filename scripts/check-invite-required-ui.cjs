/* eslint-disable @typescript-eslint/no-require-imports -- Local registration acceptance. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const { installAdminFixtures } = require('./ui-admin-fixtures.cjs');
const output = path.resolve('.tmp/discovery-ui');
fs.mkdirSync(output, { recursive: true });
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  try {
    for (const width of [1254, 390]) {
      const { context, page } = await setup(browser, {}, { width, height: 960 });
      await installAdminFixtures(context, { gallery: [], documents: [], image: '' });
      let settings = { passwordLoginEnabled: true, tokenLoginEnabled: true, registrationEnabled: true, passwordRegistrationEnabled: true, emailRegistrationEnabled: true, inviteRegistrationEnabled: true, requireInviteCode: false, requireEmailVerification: true, emailDomainRestrictionEnabled: false, blockEmailAliases: false, allowedEmailDomains: '', authProvider: 'newapi' };
      const patches = [], registrations = [], errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/api/admin/platform/settings', route => {
        if (route.request().method() === 'PUT') { const patch = route.request().postDataJSON(); patches.push(patch); settings = { ...settings, ...patch }; }
        return route.fulfill({ json: { settings } });
      });
      await context.route('**/api/auth/policy', route => route.fulfill({ json: { policy: settings, provider: 'newapi' } }));
      await context.route('**/api/auth/register', route => {
        const body = route.request().postDataJSON();
        registrations.push({ method: route.request().method(), body });
        return route.fulfill(body.inviteCode === 'valid-invite' ? { json: { success: true } } : { status: 400, json: { message: '邀请码无效，请检查后重试' } });
      });
      try {
        await page.goto(`${baseURL}/admin?tab=authentication`, { timeout: 90000 });
        const gate = page.getByRole('switch', { name: '注册必须填写邀请码（仅限邀请）', exact: true });
        await gate.waitFor();
        await gate.click();
        await page.getByRole('button', { name: '保存设置', exact: true }).click();
        await page.getByText('注册与登录已保存，立即生效', { exact: true }).waitFor();
        assert.deepEqual(patches, [{ requireInviteCode: true }]);
        await page.reload();
        await gate.waitFor();
        assert.equal(await gate.getAttribute('aria-checked'), 'true');
        for (const name of ['允许用户使用密码登录', '允许使用访问令牌登录', '允许使用邮箱注册', '允许使用邀请码注册']) assert.equal(await page.getByRole('switch', { name, exact: true }).getAttribute('aria-checked'), 'true');
        await gate.scrollIntoViewIfNeeded();
        await page.screenshot({ path: `${output}/invite-policy-${width}.png`, animations: 'disabled' });
        await page.goto(`${baseURL}/sign-in`, { timeout: 90000 });
        await page.getByRole('button', { name: '账号密码', exact: true }).waitFor();
        assert(await page.getByRole('button', { name: '访问令牌', exact: true }).isVisible());
        await page.getByRole('button', { name: '注册', exact: true }).click();
        await page.getByRole('button', { name: '邮箱注册', exact: true }).waitFor();
        const invite = page.getByLabel('邀请码', { exact: true });
        await invite.waitFor();
        assert(await invite.evaluate(element => element.required));
        const send = page.getByRole('button', { name: '获取验证码', exact: true });
        await page.getByLabel('邮箱', { exact: true }).fill('test@example.invalid');
        assert(await send.isDisabled(), 'Invite is required before sending email');
        await invite.fill('valid-invite');
        await send.click();
        await page.getByText('验证码已发送，请查收邮箱。', { exact: true }).waitFor();
        assert.deepEqual(registrations.at(-1), { method: 'PUT', body: { email: 'test@example.invalid', method: 'email', inviteCode: 'valid-invite' } });
        await page.getByRole('button', { name: '邀请码注册', exact: true }).click();
        assert(await invite.isVisible());
        await page.getByRole('button', { name: '邮箱注册', exact: true }).click();
        await page.getByLabel('用户名', { exact: true }).fill('invited_user');
        await page.locator('input[name="password"]').fill('test-password-123');
        await page.getByLabel('邮箱验证码', { exact: true }).fill('123456');
        await page.screenshot({ path: `${output}/invite-registration-${width}.png`, animations: 'disabled' });
        await page.getByRole('button', { name: '注册账号', exact: false }).click();
        await page.getByText('注册成功，请使用新账号登录。', { exact: true }).waitFor();
        assert.equal(registrations.at(-1).method, 'POST');
        assert.equal(registrations.at(-1).body.method, 'email');
        assert.equal(registrations.at(-1).body.inviteCode, 'valid-invite');
        assert.deepEqual(errors, []);
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
        console.log(`PASS ${width}px independent invitation gate, scoped save, retained login modes, email verification and registration payload`);
      } finally { await context.close(); }
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
