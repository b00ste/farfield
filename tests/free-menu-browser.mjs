// Browser Testing only. Wallet/Friend reads are fixtures; gameplay API is real.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { installFixture } from "./fixture.mjs";
import { observeRoom } from "./room-observer.mjs";
import { mkdir, writeFile } from "node:fs/promises";
const origin = process.env.TEST_URL || "http://127.0.0.1:4180";
const apiOrigin = new URL(process.env.TEST_API_URL || origin).origin;
const report = {
  origin,
  apiOrigin,
  checks: [],
  errors: [],
  paymentRequests: [],
};
const forbidden = /\b(?:RF|tokens?|deposit|payout|escrow|stake)\b/i;
const browser = await chromium.launch({
  channel: "chrome",
  args: ["--no-sandbox"],
});
await mkdir("artifacts", { recursive: true });
const wait = async (fn, label) => {
  for (let i = 0; i < 150; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(label);
};
async function checkScreen(page, root, allowComingSoon = false) {
  let text = await root.innerText();
  if (allowComingSoon) text = text.replaceAll("Wagered · Coming soon", "");
  assert.doesNotMatch(text, forbidden, "game screen has no payment copy");
  assert.doesNotMatch(
    text,
    /wager/i,
    "future label is the only wager reference",
  );
  const bounds = await page.evaluate(() => ({
    vertical: document.documentElement.scrollHeight <= innerHeight + 1,
    horizontal: document.documentElement.scrollWidth <= innerWidth + 1,
  }));
  assert.ok(
    bounds.vertical && bounds.horizontal,
    "game viewport does not scroll",
  );
  const controls = await root.locator("button").evaluateAll((buttons) =>
    buttons
      .filter((b) => b.getClientRects().length)
      .map((b) => {
        const r = b.getBoundingClientRect();
        return {
          label: b.getAttribute("aria-label") || b.innerText,
          visible:
            r.left >= 0 &&
            r.top >= 0 &&
            r.right <= innerWidth + 1 &&
            r.bottom <= innerHeight + 1,
        };
      }),
  );
  assert.ok(
    controls.every((c) => c.visible),
    "all visible game controls fit screen",
  );
}
try {
  for (const [name, width, height] of [
    ["desktop", 1440, 900],
    ["iphone", 390, 844],
    ["ipad", 1024, 1366],
  ]) {
    const ctx = await browser.newContext({
        viewport: { width, height },
        hasTouch: name !== "desktop",
        isMobile: name !== "desktop",
      }),
      page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await installFixture(page, origin);
    page.on("pageerror", (e) => report.errors.push(e.message));
    page.on("request", (request) => {
      const path = new URL(request.url()).pathname;
      if (/\/api\/(wager|escrow|fund|claim)/i.test(path))
        report.paymentRequests.push(path);
    });
    let latest, token;
    await observeRoom(page, (v) => {
      if (!latest || v.revision >= latest.revision) latest = v;
      if (v.token) token = v.token;
    });
    await page.goto(origin);
    const main = page.getByRole("navigation", { name: "Main menu" });
    await main.waitFor();
    const labels = await main.getByRole("button").allTextContents();
    assert.match(labels[0], /Online PvP/);
    assert.match(labels[1], /Friends & AI/);
    assert.match(labels[2], /Join friends/);
    await checkScreen(page, page.locator(".game-landing"));
    await page.getByRole("button", { name: /Online PvP/ }).click();
    const disabled = page.getByRole("button", {
      name: "Wagered · Coming soon",
      exact: true,
    });
    assert.ok(await disabled.isDisabled());
    assert.equal(
      await page
        .locator(".online-modes")
        .getByText("Free", { exact: true })
        .count(),
      1,
    );
    await disabled.evaluate((button) => button.click());
    assert.equal(await page.locator("iframe").count(), 0);
    await checkScreen(page, page.locator(".game-landing"), true);
    await page
      .getByRole("button", { name: "Back to main menu", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Landing settings", exact: true })
      .click();
    await checkScreen(
      page,
      page.getByRole("dialog", { name: "Settings", exact: true }),
    );
    await page
      .getByRole("button", { name: "Close settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: /Browser Wallet/ }).click();
    await page.getByRole("button", { name: /Change commander/ }).waitFor();
    await page.getByRole("button", { name: /Online PvP/ }).click();
    await page
      .getByRole("button", { name: "Find free match →", exact: true })
      .waitFor();
    assert.ok(await disabled.isDisabled());
    await checkScreen(page, page.locator(".game-landing"), true);
    await page.screenshot({ path: `artifacts/free-menu-${name}.png` });
    await page
      .getByRole("button", { name: "Back to main menu", exact: true })
      .click();
    await page.getByRole("button", { name: /Friends & AI/ }).click();
    await page
      .getByRole("button", { name: "Enter sector →", exact: true })
      .click();
    const game = page.frameLocator("iframe");
    await game
      .getByRole("button", { name: "Begin match →", exact: true })
      .waitFor();
    await wait(() => token, "custom room seat");
    assert.doesNotMatch(await game.locator("body").innerText(), forbidden);
    await game
      .getByRole("button", { name: "Begin match →", exact: true })
      .click();
    await game.getByRole("button", { name: "Game menu", exact: true }).click();
    assert.doesNotMatch(await game.getByRole("dialog").innerText(), forbidden);
    await game.getByRole("button", { name: /How to play/ }).click();
    assert.doesNotMatch(await game.getByRole("dialog").innerText(), forbidden);
    const methods = await page.evaluate(
      () => window.__friendWalletTest.state.requests,
    );
    assert.ok(
      methods.every((m) => !/(sign|sendTransaction|sendCalls)/i.test(m)),
    );
    report.checks.push({
      name,
      width,
      height,
      menuOrder: true,
      disabledFutureLabel: true,
      freeMode: true,
      noPaymentCopy: true,
      noOverflow: true,
      walletMethods: [...new Set(methods)],
    });
    await page.request.post(apiOrigin + "/api/leave", {
      headers: { Authorization: "Bearer " + token },
      data: { code: latest.code },
    });
    await ctx.close();
  }
  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.paymentRequests, []);
  console.log("PASS free-only menu", JSON.stringify(report));
} catch (error) {
  report.failure = { name: error.name, message: error.message };
  throw error;
} finally {
  await writeFile("artifacts/free-menu.json", JSON.stringify(report, null, 2));
  await browser.close();
}
