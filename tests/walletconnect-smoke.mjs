// Real WalletConnect relay smoke check: creates an unpaired QR, never connects a wallet or signs.
import assert from "node:assert/strict";
import { chromium } from "playwright";
const origin = process.env.TEST_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
page.setDefaultTimeout(30000);
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first().click();
  await page
    .getByRole("button", { name: "WalletConnect", exact: true })
    .click();
  const dialog = page.locator('[data-rk="farfield"][role="dialog"]');
  await dialog.getByText(/Scan.*(phone|wallet)/i).waitFor();
  await page.waitForFunction(() =>
    [
      ...document.querySelectorAll('[data-rk="farfield"][role="dialog"] svg'),
    ].some(
      (el) =>
        el.getBoundingClientRect().width >= 180 &&
        el.querySelectorAll("path,rect").length > 0,
    ),
  );
  assert.equal(
    await page.locator("iframe").count(),
    0,
    "QR alone must never authorize a game session",
  );
  await page.screenshot({
    path: "artifacts/walletconnect-qr.png",

  });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: real WalletConnect QR generated with configured project ID; no wallet connected or transaction requested.",
  );
} catch (e) {
  console.log(await page.locator("body").innerText());
  console.log(errors);
  await page.screenshot({ path: "artifacts/walletconnect-failure.png" });
  throw e;
} finally {
  await browser.close();
}
