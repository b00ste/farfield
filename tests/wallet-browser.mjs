// Browser Testing profile only. Identity fixtures are automation-only.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  installFixture,
  createArtworkFixture,
  SECOND_OWNER,
} from "./fixture.mjs";
const origin = process.env.TEST_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const errors = [];
async function setup(width) {
  const context = await browser.newContext({
      viewport: { width, height: 852 },
      hasTouch: width < 500,
      reducedMotion: "reduce",
    }),
    page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (e) => errors.push(e.message));
  const fixture = await installFixture(page, origin, {
    artworkCall: await createArtworkFixture(),
  });
  await page.route("https://pulse.walletconnect.org/**", (r) =>
    r.fulfill({ json: {} }),
  );
  await page.route("https://api.web3modal.org/**", (r) =>
    r.fulfill({ json: {} }),
  );
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
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  const dialog = page.locator('[data-rk="farfield"][role="dialog"]');
  await dialog.waitFor();
  const gameBox = await page.locator(".rf-game-frame").boundingBox(),
    modalBox = await dialog.boundingBox();
  assert.ok(
    modalBox.x >= gameBox.x - 1 &&
      modalBox.y >= gameBox.y - 1 &&
      modalBox.x + modalBox.width <= gameBox.x + gameBox.width + 1 &&
      modalBox.y + modalBox.height <= gameBox.y + gameBox.height + 1,
    "Wallet modal fits inside the SDK viewport",
  );
  const clipped = await dialog.evaluate((root) =>
    [...root.querySelectorAll("button, a")]
      .filter((el) => {
        const box = el.getBoundingClientRect();
        return box.width > 0 && (box.left < 0 || box.right > innerWidth);
      })
      .map((el) => el.textContent),
  );
  assert.deepEqual(
    clipped,
    [],
    "Wallet controls must fit a phone without clipping",
  );
  assert.equal(
    await page.locator(".rf-game-frame").evaluate((el) => el.inert),
    true,
  );
  assert.equal(
    await dialog.evaluate((el) =>
      getComputedStyle(el)
        .getPropertyValue("--rk-colors-modalBackground")
        .trim(),
    ),
    "#14232d",
  );
  await page.screenshot({
    path: `artifacts/wallet-connect-${width}.png`,
    clip: gameBox,
  });
  await page.getByRole("button", { name: /Browser Wallet/ }).click();
  await page.getByRole("button", { name: /^Friend #7730\b/ }).waitFor();
  return { page, fixture };
}
try {
  const desktop = await setup(1200);
  desktop.fixture.mode = "owner-changed";
  await desktop.page.getByRole("button", { name: /^Friend #7730\b/ }).click();
  await desktop.page
    .getByRole("button", { name: "Retry eligibility" })
    .waitFor();
  assert.equal(
    await desktop.page.locator("iframe").count(),
    0,
    "Stale discovery must not grant play",
  );
  desktop.fixture.mode = "eligible";
  await desktop.page.getByRole("button", { name: "Retry eligibility" }).click();
  await desktop.page
    .frameLocator("iframe")
    .getByRole("button", { name: "Create a match" })
    .waitFor();
  // Wrong-network events immediately close the existing game; RainbowKit switches back.
  await desktop.page.evaluate(() => window.__friendWalletTest.chain("0x1"));
  await desktop.page.locator("iframe").waitFor({ state: "detached" });
  await desktop.page.getByRole("button", { name: "Chain Selector" }).click();
  await desktop.page.getByRole("button", { name: /Robinhood/ }).click();
  await desktop.page.locator("iframe").waitFor();
  // Switching accounts invalidates discovery and selection before new ownership reads.
  await desktop.page.evaluate(
    (account) => window.__friendWalletTest.accounts([account]),
    SECOND_OWNER,
  );
  await desktop.page.locator("iframe").waitFor({ state: "detached" });
  await desktop.page.getByRole("button", { name: /^Friend #3412\b/ }).waitFor();
  const phone = await setup(360);
  await phone.page.getByRole("button", { name: /^Friend #7730\b/ }).click();
  await phone.page
    .frameLocator("iframe")
    .getByRole("button", { name: "Create a match" })
    .waitFor();
  await phone.page
    .locator(".farfield-wallet-tools")
    .getByRole("button", { name: /0x11/ })
    .click();
  await phone.page.getByRole("button", { name: /Disconnect/ }).waitFor();
  await phone.page.screenshot({
    path: "artifacts/wallet-account-360.png",
    clip: await phone.page.locator(".rf-game-frame").boundingBox(),
  });
  await phone.page.getByRole("button", { name: /Disconnect/ }).click();
  await phone.page.locator("iframe").waitFor({ state: "detached" });
  await phone.page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .waitFor();
  assert.deepEqual(
    [...errors, ...desktop.fixture.errors, ...phone.fixture.errors],
    [],
  );
  console.log(
    "PASS: themed desktop/mobile modals, viewport containment, input blocking, stale-owner rejection, network switching, account switching, RainbowKit disconnect.",
  );
} catch (e) {
  for (const [i, p] of browser
    .contexts()
    .flatMap((c) => c.pages())
    .entries()) {
    console.log(await p.locator("body").innerText());
    await p.screenshot({ path: `artifacts/wallet-failure-${i}.png` });
  }
  console.log(errors);
  throw e;
} finally {
  await browser.close();
}
