/* Local-only regression; all account data and admin requests are intercepted. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
try {
  process.loadEnvFile(".env.local");
  process.env.LFN_UI_TEST_SESSION_SECRET ||= process.env.LFN_SESSION_SECRET;
} catch {}
process.env.LFN_UI_BASE_URL ||= "http://127.0.0.1:3100";
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve(
  ".tmp/browser-check/node_modules/playwright-core",
);
const { setup, chromium, baseURL } = require("./check-mobile-ui.cjs");
const { installAdminFixtures } = require("./ui-admin-fixtures.cjs");
const output = path.resolve(".tmp/referral-status-ui");
fs.mkdirSync(output, { recursive: true });
const results = [],
  errors = [];
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [390, 1366]) {
      console.log("RUN referral-status-" + width);
      const { context, page } = await setup(
        browser,
        { theme: "paper" },
        { width, height: 900 },
      );
      let disabled = true,
        fail = false,
        reads = 0;
      page.on("pageerror", (e) => errors.push(e.message));
      try {
        await installAdminFixtures(context, {
          gallery: [],
          documents: [],
          image: Buffer.from(""),
        });
        await context.route("**/api/admin/referrals", (route) =>
          route.fulfill({
            json: {
              items: [
                {
                  code: "TEST-INVITE",
                  inviterUserId: 10,
                  inviterName: "Inviter",
                  invitedCount: 3,
                  createdAt: "2026-10-26T00:00:00Z",
                },
              ],
              reward: 0,
            },
          }),
        );
        await context.route("**/api/admin/risk/chain-preview", (route) => {
          assert.equal(route.request().method(), "POST");
          reads++;
          if (fail)
            return route.fulfill({
              status: 503,
              json: { message: "账号状态暂时无法读取，请重试" },
            });
          return route.fulfill({
            json: {
              accountProvider: "NewAPI",
              component: {
                rootUserId: 10,
                userIds: [10, 11, 12, 13],
                ancestors: [],
                descendants: [11, 12, 13],
                edges: [11, 12, 13].map((id) => ({
                  inviterUserId: 10,
                  registeredUserId: id,
                })),
                maxDepth: 10,
                cycleDetected: false,
              },
              users: [
                {
                  userId: 10,
                  username: "Inviter",
                  accountStatus: "active",
                  blocked: false,
                  score: 0,
                  level: "normal",
                },
                {
                  userId: 11,
                  username: "Invited2",
                  accountStatus: disabled ? "disabled" : "active",
                  blocked: false,
                  score: 0,
                  level: "normal",
                },
                {
                  userId: 12,
                  username: "LocalBan",
                  accountStatus: "active",
                  blocked: true,
                  score: 90,
                  level: "critical",
                },
                {
                  userId: 13,
                  username: "Unknown",
                  accountStatus: "unknown",
                  blocked: false,
                  score: 0,
                  level: "normal",
                },
              ],
            },
          });
        });
        await page.goto(baseURL + "/admin?tab=referrals");
        await page
          .getByRole("button", { name: "查看关系树", exact: true })
          .click();
        const details = page.locator("dl").last();
        await details.getByText("正常", { exact: true }).waitFor();
        const node = (name) =>
          page.locator(".referral-node > button").filter({ hasText: name });
        assert((await node("Invited2").innerText()).includes("NewAPI 已禁用"));
        await node("Invited2").click();
        await details.getByText("已禁用", { exact: true }).waitFor();
        assert((await details.innerText()).includes("无本地封禁记录"));
        await node("LocalBan").click();
        await details.getByText("正常", { exact: true }).waitFor();
        assert((await details.innerText()).includes("已封禁"));
        await node("Unknown").click();
        await details.getByText("状态未知", { exact: true }).waitFor();
        disabled = false;
        await page
          .getByRole("button", { name: "刷新账号状态", exact: true })
          .click();
        await node("Invited2").click();
        await details.getByText("正常", { exact: true }).waitFor();
        assert(!(await node("Invited2").innerText()).includes("已禁用"));
        await page.screenshot({
          path: path.join(output, `referrals-${width}.png`),
        });
        fail = true;
        await page
          .getByRole("button", { name: "刷新账号状态", exact: true })
          .click();
        await page
          .getByRole("alert")
          .filter({ hasText: "暂时无法读取" })
          .waitFor();
        assert.equal(await page.locator("dl").count(), 0);
        fail = false;
        await page
          .getByRole("button", { name: "重试读取账号状态", exact: true })
          .click();
        await details.getByText("正常", { exact: true }).waitFor();
        assert(reads >= 4);
        results.push({ name: "referral-status-" + width, passed: true });
        console.log("PASS referral-status-" + width);
      } catch (e) {
        results.push({
          name: "referral-status-" + width,
          passed: false,
          error: e.stack,
        });
        console.error(e);
        await page.screenshot({
          path: path.join(output, `referrals-${width}-failed.png`),
        });
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
    fs.writeFileSync(
      path.join(output, "results.json"),
      JSON.stringify({ results, errors }, null, 2),
    );
  }
  if (results.some((r) => !r.passed) || errors.length) process.exitCode = 1;
})();
