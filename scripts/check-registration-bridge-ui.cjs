/* eslint-disable @typescript-eslint/no-require-imports -- Local browser acceptance. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { setup, chromium, baseURL } = require('./check-mobile-ui.cjs');
const policy = { passwordLoginEnabled: true, tokenLoginEnabled: true, registrationEnabled: true, passwordRegistrationEnabled: true, emailRegistrationEnabled: true, inviteRegistrationEnabled: false, requireInviteCode: true, requireEmailVerification: true, emailDomainRestrictionEnabled: false, blockEmailAliases: false, allowedEmailDomains: '' };
(async () => {
  const browser = await chromium.launch({ headless: true, channel: 'msedge' });
  const results = [];
  try {
    for (const width of [1254, 390]) for (const signedIn of [true, false]) {
      const { context, page } = await setup(browser, {}, { width, height: 884 });
      const registrations = [], logins = [], errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await context.route('**/api/auth/policy', route => route.fulfill({ json: { policy, provider: 'newapi' } }));
      await context.route('**/api/auth/register', route => {
        registrations.push({ method: route.request().method(), body: route.request().postDataJSON() });
        return route.fulfill({ json: { success: true, ...(route.request().method() === 'POST' ? { signedIn } : {}) } });
      });
      await context.route('**/api/auth/login', route => {
        logins.push(route.request().postDataJSON());
        return route.fulfill({ json: { user: { id: 52, name: 'lfntest' } } });
      });
      try {
        await page.goto(`${baseURL}/sign-in?invite=valid-invite`, { timeout: 90000 });
        await page.getByLabel('邀请码', { exact: true }).waitFor();
        assert.equal(await page.getByLabel('邀请码', { exact: true }).inputValue(), 'valid-invite');
        const username = page.locator('form input[name="username"]');
        assert.equal(await username.getAttribute('maxlength'), '20');
        await username.fill('lfntest');
        assert(await username.evaluate(input => input.checkValidity()));
        await page.locator('form input[name="password"]').fill('test-password123');
        await page.getByLabel('邮箱', { exact: true }).fill('browser-test@qq.com');
        await page.getByRole('button', { name: '获取验证码', exact: true }).click();
        await page.getByText('验证码已发送，请查收邮箱。', { exact: true }).waitFor();
        await page.getByLabel('邮箱验证码', { exact: true }).fill('82aefc');
        await page.getByRole('button', { name: '注册账号', exact: true }).click();
        if (!signedIn) {
          await page.getByText('注册成功，请使用新账号登录。', { exact: true }).waitFor();
          await page.locator('form input[name="username"]').fill('lfntest');
          await page.locator('form input[name="password"]').fill('test-password123');
          await page.getByRole('button', { name: '登录', exact: true }).click();
        }
        await page.waitForURL(`${baseURL}/image`, { timeout: 30000 });
        const post = registrations.find(item => item.method === 'POST');
        assert.equal(post.body.inviteCode, 'valid-invite');
        assert.equal(post.body.verificationCode, '82aefc');
        assert.equal(post.body.remember, true);
        assert(!('affCode' in post.body));
        assert.equal(logins.length, signedIn ? 0 : 1);
        assert.deepEqual(errors, []);
        results.push({ width, automaticSignIn: signedIn, passed: true });
        console.log(`PASS ${width}px ${signedIn ? 'registration enters workspace without another login' : 'successful registration offers normal login when automatic sign-in is unavailable'}`);
      } finally { await context.close(); }
    }
    fs.mkdirSync('.tmp/auth-registration-ui', { recursive: true });
    fs.writeFileSync('.tmp/auth-registration-ui/results.json', JSON.stringify(results, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
