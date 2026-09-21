import { collectionFixture } from "./collection-fixture.mjs";
// Browser Testing only: wallet fixtures are never shipped in the game.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { installFixture, SECOND_OWNER } from "./fixture.mjs";

const origin = process.env.TEST_URL || "http://127.0.0.1:4173";
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const errors = [];
async function client(width, height, control = {}) {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: width < 500,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  const fixture = await installFixture(page, origin);
  await collectionFixture(page, control);
  for (const url of [
    "https://pulse.walletconnect.org/**",
    "https://api.web3modal.org/**",
  ])
    await page.route(url, (r) => r.fulfill({ json: {} }));
  await page.route("https://rpc.mainnet.chain.robinhood.com/**", async (r) => {
    if (r.request().method() === "POST") {
      const body = r.request().postDataJSON();
      if (body.method === "eth_getBalance")
        return r.fulfill({
          json: { id: body.id, jsonrpc: "2.0", result: "0x0" },
          headers: { "access-control-allow-origin": "*" },
        });
    }
    return r.fallback();
  });
  // An old unversioned child must never be loaded behind the new host.
  await page.route(/\/game\.js$/, (r) =>
    r.fulfill({
      contentType: "application/javascript",
      body: "throw new Error('Legacy unversioned game loaded')",
    }),
  );
  await page.goto(origin);
  await page.locator(".game-landing").waitFor();
  assert.equal(await page.locator("iframe").count(), 0);
  assert.equal(await page.locator(".friend-gallery").count(), 0);
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: /Browser Wallet/ }).click();
  await page.getByRole("button", { name: /Change commander/ }).click();
  await page.getByRole("region", { name: "Your commanders" }).waitFor();
  return { context, page, fixture, game: page.frameLocator("iframe") };
}

try {
  for (const width of [2560, 360]) {
    let release;
    const pending = new Promise((resolve) => {
      release = resolve;
    });
    const a = await client(width, width === 360 ? 852 : 1440, { pending });
    await a.page
      .getByRole("status")
      .filter({ hasText: "Loading your Friends…" })
      .waitFor();
    assert.equal(
      await a.page
        .getByText("No eligible Friends in this wallet.", { exact: true })
        .count(),
      0,
    );
    assert.equal(
      await a.page.getByText("0 Friends", { exact: true }).count(),
      0,
    );
    assert.equal(
      await a.page
        .getByRole("navigation", { name: "Friend pages" })
        .isVisible(),
      false,
    );
    assert.ok(
      await a.page.getByRole("textbox", { name: "Find a Friend" }).isDisabled(),
    );
    await a.page.screenshot({ path: `artifacts/friends-loading-${width}.png` });
    release();
    await a.page
      .getByRole("heading", { name: "Friend #7730", exact: true })
      .waitFor();
    await a.page.locator(".commander-portrait canvas").waitFor();
    assert.equal(await a.page.locator(".roster-loading").count(), 0);
    assert.ok(
      (await a.page.locator(".roster-friend[aria-pressed=true]").count()) === 1,
    );
    await a.page
      .getByRole("textbox", { name: "Find a Friend" })
      .fill("99999999");
    await a.page
      .getByRole("status")
      .filter({ hasText: "No Friend matches that number." })
      .waitFor();
    assert.equal(
      await a.page
        .getByText("No eligible Friends in this wallet.", { exact: true })
        .count(),
      0,
    );
    assert.deepEqual(a.fixture.errors, []);
    await a.context.close();
    console.log(
      `PASS ${width}: loading never claims empty, delayed data automatically opens selected preview, search empty is distinct.`,
    );
  }
  const control = { fail: true };
  const a = await client(360, 852, control);
  await a.page
    .getByRole("alert")
    .filter({ hasText: "Couldn’t load your Friends." })
    .waitFor({ timeout: 30000 });
  assert.equal(
    await a.page
      .getByText("No eligible Friends in this wallet.", { exact: true })
      .count(),
    0,
  );
  await a.page.screenshot({ path: "artifacts/friends-load-error.png" });
  control.fail = false;
  let release;
  control.pending = new Promise((resolve) => {
    release = resolve;
  });
  await a.page
    .getByRole("button", { name: "Retry loading Friends", exact: true })
    .click();
  await a.page
    .getByRole("status")
    .filter({ hasText: "Loading your Friends…" })
    .waitFor();
  release();
  await a.page
    .getByRole("heading", { name: "Friend #7730", exact: true })
    .waitFor();
  assert.deepEqual(a.fixture.errors, []);
  await a.context.close();
  const empty = await client(360, 852, { empty: true });
  await empty.page
    .getByText("No eligible Friends in this wallet.", { exact: true })
    .waitFor();
  assert.equal(
    await empty.page.getByRole("button", { name: /Select commander/ }).count(),
    0,
  );
  await empty.page.getByRole("button", { name: "Back to main menu" }).click();
  await empty.page.getByRole("navigation", { name: "Main menu" }).waitFor();
  assert.deepEqual(empty.fixture.errors, []);
  await empty.context.close();
  assert.deepEqual(errors, []);
  console.log("PASS failure/retry/recovery, confirmed empty wallet and Back.");
} finally {
  await browser.close();
}
