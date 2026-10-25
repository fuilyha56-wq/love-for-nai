/* Browser acceptance checks; all API calls use local fixtures. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { setup, chromium } = require("./check-mobile-ui.cjs");
const { installAdminFixtures } = require("./ui-admin-fixtures.cjs");
const baseURL = process.env.LFN_UI_BASE_URL || "http://127.0.0.1:3000";
const output = path.resolve(".tmp-build/admin-auth-ui");
const defaults = {
  passwordLoginEnabled: true,
  tokenLoginEnabled: true,
  registrationEnabled: true,
  passwordRegistrationEnabled: true,
  emailRegistrationEnabled: true,
  inviteRegistrationEnabled: false,
  requireEmailVerification: true,
  emailDomainRestrictionEnabled: false,
  blockEmailAliases: false,
  allowedEmailDomains:
    "gmail.com\n163.com\n126.com\nqq.com\noutlook.com\nhotmail.com\nicloud.com\nyahoo.com\nfoxmail.com",
};
async function fit(page) {
  const dimensions = await page.evaluate(() => ({
    width: innerWidth,
    content: document.documentElement.scrollWidth,
  }));
  assert(
    dimensions.content <= dimensions.width + 1,
    JSON.stringify(dimensions),
  );
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: "msedge" });
  const errors = [];
  try {
    for (const width of [1056, 390]) {
      const { context, page } = await setup(
        browser,
        {},
        { width, height: 884 },
      );
      page.on("pageerror", (error) => errors.push(error.message));
      await installAdminFixtures(context, {
        gallery: [],
        documents: [],
        image: "",
      });
      let settings = {
        ...defaults,
        authProvider: "newapi",
        publicUrl: "https://lfn.example",
        sourceCodeUrl: "",
        smtpHost: "",
        smtpPort: 587,
        smtpFrom: "",
        smtpUser: "",
        smtpPassword: "",
        smtpSecure: false,
      };
      const patches = [];
      await context.route("**/api/admin/platform/settings", async (route) => {
        if (route.request().method() === "PUT") {
          const patch = route.request().postDataJSON();
          patches.push(patch);
          settings = { ...settings, ...patch };
        }
        return route.fulfill({ json: { settings } });
      });
      await context.route("**/api/auth/policy", (route) =>
        route.fulfill({ json: { policy: settings, provider: "newapi" } }),
      );
      await page.goto(`${baseURL}/admin?tab=platform`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page
        .getByRole("heading", { name: "基础站点", exact: true })
        .waitFor();
      assert.equal(await page.locator(".platform-category").count(), 7);
      assert.equal(
        await page.getByLabel("NewAPI 管理员令牌", { exact: true }).count(),
        0,
      );
      await fit(page);
      await page.screenshot({
        path: path.join(output, `platform-${width}.png`),
        fullPage: true,
      });
      await page
        .locator(".platform-category")
        .filter({ hasText: "注册与登录" })
        .click();
      await page
        .getByRole("heading", { name: "邮箱与身份验证", exact: true })
        .waitFor();
      await page
        .getByRole("switch", { name: "允许使用邮箱注册", exact: true })
        .click();
      await page
        .getByRole("switch", { name: "允许使用邀请码注册", exact: true })
        .click();
      await page.getByRole("button", { name: "保存设置", exact: true }).click();
      await page
        .getByText("注册与登录已保存，立即生效", { exact: true })
        .waitFor();
      assert.deepEqual(patches, [
        { emailRegistrationEnabled: false, inviteRegistrationEnabled: true },
      ]);
      await page.reload();
      await page
        .getByRole("heading", { name: "邮箱与身份验证", exact: true })
        .waitFor();
      assert.equal(
        await page
          .getByRole("switch", { name: "允许使用邮箱注册", exact: true })
          .getAttribute("aria-checked"),
        "false",
      );
      assert.equal(
        await page
          .getByRole("switch", { name: "允许使用邀请码注册", exact: true })
          .getAttribute("aria-checked"),
        "true",
      );
      await fit(page);
      await page.screenshot({
        path: path.join(output, `authentication-${width}.png`),
        fullPage: true,
      });

      for (const scenario of [
        {
          name: "invite-only",
          patch: {
            emailRegistrationEnabled: false,
            inviteRegistrationEnabled: true,
            requireEmailVerification: false,
          },
        },
        {
          name: "email-only",
          patch: {
            emailRegistrationEnabled: true,
            inviteRegistrationEnabled: false,
            requireEmailVerification: true,
          },
        },
        {
          name: "both",
          patch: {
            emailRegistrationEnabled: true,
            inviteRegistrationEnabled: true,
            requireEmailVerification: true,
          },
        },
        { name: "closed", patch: { registrationEnabled: false } },
        {
          name: "token-only",
          patch: { registrationEnabled: false, passwordLoginEnabled: false },
        },
      ]) {
        settings = { ...settings, ...defaults, ...scenario.patch };
        await page.goto(`${baseURL}/sign-in`, { waitUntil: "domcontentloaded", timeout: 120000 });
        await page
          .getByRole("button", { name: "访问令牌", exact: true })
          .waitFor();
        const register = page.getByRole("button", {
          name: "注册",
          exact: true,
        });
        if (scenario.name === "closed" || scenario.name === "token-only") {
          assert.equal(await register.count(), 0);
          if (scenario.name === "token-only")
            assert.equal(
              await page
                .getByRole("button", { name: "账号密码", exact: true })
                .count(),
              0,
            );
        } else {
          await register.click();
          if (scenario.name === "invite-only") {
            await page.getByLabel("邀请码", { exact: true }).waitFor();
            assert.equal(
              await page.getByLabel("邮箱", { exact: true }).count(),
              0,
            );
            assert.equal(
              await page
                .getByRole("button", { name: "邮箱注册", exact: true })
                .count(),
              0,
            );
          } else {
            await page.getByLabel("邮箱", { exact: true }).waitFor();
            assert.equal(
              await page.getByLabel("邀请码", { exact: true }).count(),
              0,
            );
            if (scenario.name === "both") {
              await page
                .getByRole("button", { name: "邀请码注册", exact: true })
                .click();
              await page.getByLabel("邀请码", { exact: true }).waitFor();
              await page.getByLabel("邮箱验证码", { exact: true }).waitFor();
            } else
              assert.equal(
                await page
                  .getByRole("button", { name: "邀请码注册", exact: true })
                  .count(),
                0,
              );
          }
        }
        await fit(page);
        if (scenario.name === "invite-only")
          await page.screenshot({
            path: path.join(output, `register-invite-${width}.png`),
            fullPage: true,
          });
        console.log(`PASS ${width}px ${scenario.name}`);
      }
      await context.close();
    }
    assert.deepEqual(errors, [], "Browser errors");
    console.log(
      `PASS platform categories, scoped saving and persisted form state at both widths. Screenshots: ${output}`,
    );
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
