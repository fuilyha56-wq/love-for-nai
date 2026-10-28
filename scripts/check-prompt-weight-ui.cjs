/* Local-only weight regression. Every generation is intercepted and costs nothing. */
/* eslint-disable @typescript-eslint/no-require-imports */
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
try {
  process.loadEnvFile(".env.local");
  process.env.LFN_UI_TEST_SESSION_SECRET ||= process.env.LFN_SESSION_SECRET;
} catch {}
process.env.LFN_UI_BASE_URL ||= "http://127.0.0.1:3100";
process.env.LFN_PLAYWRIGHT_MODULE ||= path.resolve(
  ".tmp/browser-check/node_modules/playwright-core",
);
const { setup, chromium, baseURL } = require("./check-mobile-ui.cjs");
const results = [],
  errors = [],
  output = path.resolve(".tmp/prompt-weights");
fs.mkdirSync(output, { recursive: true });
async function run(name, fn) {
  if (
    process.env.LFN_WEIGHT_FILTER &&
    !name.includes(process.env.LFN_WEIGHT_FILTER)
  )
    return;
  console.log("RUN " + name);
  try {
    await fn();
    results.push({ name, passed: true });
    console.log("PASS " + name);
  } catch (error) {
    results.push({ name, passed: false, error: error.stack });
    console.error("FAIL " + name + " " + error.message);
  }
}
(async () => {
  const browser = await chromium.launch({ channel: "msedge", headless: true });
  try {
    for (const width of [1366, 390])
      for (const [theme, layout] of [
        ["paper", "lfn"],
        ["nai", "lfn"],
        ["paper", "nlw"],
      ])
        await run(`weight-submit-${width}-${theme}-${layout}`, async () => {
          const { context, page, requests } = await setup(
            browser,
            { theme, workspaceLayout: layout },
            { width, height: 900 },
          );
          page.on("pageerror", (e) => errors.push(e.message));
          await context.addInitScript(() => {
            localStorage.setItem("lfn-image-history-mode-v1", "none");
            localStorage.setItem(
              "lfn-image-studio-form-v1",
              JSON.stringify({
                version: 1,
                model: "nai-v5-full",
                seed: "123456789",
                prompt: "1.2::sitting::, city",
                negative: "lowres",
              }),
            );
          });
          try {
            await page.goto(baseURL + "/image");
            await page.locator("[data-studio-layout]").waitFor();
            await page.waitForTimeout(700);
            const replica = width < 1024 || theme === "nai" || layout === "nlw";
            async function field(negative = false) {
              if (
                width < 1024 &&
                !(await page
                  .getByRole("dialog", { name: "提示词区域", exact: true })
                  .count())
              )
                await page.locator(".mobile-studio-prompt-toggle").click();
              if (replica) {
                await page
                  .getByRole("tablist", { name: "提示词类型", exact: true })
                  .getByRole("tab")
                  .nth(negative ? 1 : 0)
                  .click();
                return page.locator(".replica-raw-textarea:visible").first();
              }
              return page.getByRole("textbox", {
                name: negative ? "排除内容" : "描述画面",
                exact: true,
              });
            }
            async function generate() {
              if (await page.locator("textarea:focus").count())
                await page.locator("textarea:focus").blur();
              if (
                await page
                  .getByRole("listbox", { name: "标签联想", exact: true })
                  .isVisible()
                  .catch(() => false)
              )
                await page.keyboard.press("Escape");
              if (
                width < 1024 &&
                (await page
                  .getByRole("dialog", { name: "提示词区域", exact: true })
                  .count())
              )
                await page
                  .getByRole("dialog", { name: "提示词区域", exact: true })
                  .getByRole("button", { name: "完成", exact: true })
                  .click();
              const button = (await page
                .locator(".replica-run-button:visible")
                .count())
                ? page.locator(".replica-run-button:visible")
                : page.locator("[data-studio-generate]:visible");
              const [request] = await Promise.all([
                page.waitForRequest(
                  (r) =>
                    new URL(r.url()).pathname === "/api/images/operate" &&
                    r.method() === "POST",
                ),
                button.click(),
              ]);
              await page.waitForFunction(
                () =>
                  ![
                    ...document.querySelectorAll(
                      "[data-studio-generate],.replica-run-button",
                    ),
                  ].some((el) => el.offsetParent !== null && el.disabled),
              );
              return request.postDataJSON();
            }
            for (const weight of ["1.8", "0.4", "-2"]) {
              const input = await field();
              await input.fill(`${weight}::sitting::, city`);
              const body = await generate();
              assert(
                body.prompt.includes(`${weight}::sitting::`),
                JSON.stringify(body),
              );
              assert.equal(body.seed, 123456789);
            }
            const negative = await field(true);
            await negative.fill("-1.5::clouds::");
            let body = await generate();
            assert(
              body.negative_prompt.includes("-1.5::clouds::"),
              JSON.stringify(body),
            );
            const input = await field();
            await input.fill("-2::clouds::, city");
            await input.blur();
            await page
              .getByRole("button", {
                name: replica ? "标签模式" : "Tag",
                exact: true,
              })
              .first()
              .click();
            const editor = page.locator(".tag-chip-editor:visible").first();
            await editor
              .locator(".tag-chip-text")
              .filter({ hasText: /^clouds$/ })
              .dblclick();
            const edit = editor.locator("input").first();
            await edit.fill("rain");
            await edit.press("Enter");
            body = await generate();
            assert(
              body.prompt.includes("-2::rain::"),
              "Editing a negative-weight tag must preserve -2: " + body.prompt,
            );
            if (width < 1024)
              await page.locator(".mobile-studio-prompt-toggle").click();
            await editor
              .locator(".tag-chip-text")
              .filter({ hasText: /^rain$/ })
              .click({ button: "right" });
            await page
              .getByRole("menuitem", {
                name: "增加权重 (+0.05/+1层)",
                exact: true,
              })
              .click();
            body = await generate();
            assert(
              body.prompt.includes("-1.95::rain::"),
              "Numeric weights increase by 0.05: " + body.prompt,
            );
            const fixedNotice = page.locator(".seed-mode-notice:visible");
            await fixedNotice.waitFor();
            assert((await fixedNotice.innerText()).includes("123456789"));
            async function noticeFits() {
              const viewport = page.viewportSize();
              const bounds = await fixedNotice.boundingBox();
              const seedBounds = await fixedNotice.locator("b").boundingBox();
              assert(
                bounds &&
                  seedBounds &&
                  seedBounds.x >= bounds.x &&
                  seedBounds.x + seedBounds.width <=
                    bounds.x + bounds.width + 1,
                "Fixed seed value must fit inside its visible notice",
              );
              assert(
                bounds.x >= 0 &&
                  bounds.x + bounds.width <= viewport.width + 1 &&
                  bounds.y >= 0 &&
                  bounds.y + bounds.height <= viewport.height + 1,
                "Seed notice must fit the viewport",
              );
              assert(
                await page.evaluate(
                  () => document.documentElement.scrollWidth <= innerWidth + 1,
                ),
                "No horizontal page overflow",
              );
            }
            await noticeFits();
            if (width < 1024) {
              for (const size of [
                { width: 320, height: 640 },
                { width: 844, height: 390 },
              ]) {
                await page.setViewportSize(size);
                await page.waitForTimeout(200);
                await noticeFits();
              }
              await page.setViewportSize({ width, height: 900 });
              await page.waitForTimeout(200);
            }

            await page.screenshot({
              path: path.join(
                output,
                `${width}-${theme}-${layout}-fixed-seed.png`,
              ),
            });
            await fixedNotice
              .getByRole("button", { name: "改为随机", exact: true })
              .click();
            assert.equal(
              await page.locator(".seed-mode-notice:visible").count(),
              0,
            );
            for (let i = 0; i < 2; i++) {
              body = await generate();
              assert(
                !body.seed,
                "Random mode must not resend the old fixed seed: " + body.seed,
              );
            }
            if (layout === "nlw" && width >= 1024) {
              const seedInput = page.locator(".replica-seed input:visible");
              await page
                .getByRole("button", { name: "锁定种子", exact: true })
                .click();
              const seedValue = Number(await seedInput.inputValue());
              assert(seedValue > 0 && seedValue <= 4294967295);
              body = await generate();
              assert.equal(body.seed, seedValue);
              await page
                .getByRole("button", { name: "解锁种子", exact: true })
                .click();
              assert.equal(await seedInput.inputValue(), "");
              body = await generate();
              assert(!body.seed, "Unlock must clear the fixed seed");
            }
            const ids = requests
              .filter(
                (r) => r.path === "/api/images/operate" && r.method === "POST",
              )
              .map((r) => r.body._lfnRequestId);
            assert.equal(new Set(ids).size, ids.length);
            await page.screenshot({
              path: path.join(output, `${width}-${theme}-${layout}.png`),
            });
          } catch (error) {
            await page.screenshot({
              path: path.join(output, `${width}-${theme}-${layout}-failed.png`),
            });
            throw new Error(
              error.message +
                "; UI: " +
                (await page.locator("body").innerText()),
            );
          } finally {
            await context.close();
          }
        });
  } finally {
    await browser.close();
    fs.writeFileSync(
      path.join(output, "results.json"),
      JSON.stringify({ results, errors }, null, 2),
    );
  }
  if (results.some((x) => !x.passed) || errors.length) process.exitCode = 1;
})();
