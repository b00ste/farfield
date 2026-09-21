// Browser Testing profile only. Exercise RPC outages without granting an identity.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { installFixture } from "./fixture.mjs";
const origin = process.env.TEST_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({ viewport: { width: 360, height: 852 } });
  page.setDefaultTimeout(60000);
  const fixture = await installFixture(page, origin);
  fixture.mode = "rpc-error";
  await page.route("https://pulse.walletconnect.org/**", (r) =>
    r.fulfill({ json: {} }),
  );
  await page.route("https://api.web3modal.org/**", (r) =>
    r.fulfill({ json: {} }),
  );
  await page.route("https://rpc.mainnet.chain.robinhood.com/**", (r) => {
    if (r.request().method() === "POST") {
      const body = r.request().postDataJSON();
      if (body.method === "eth_getBalance")
        return r.fulfill({
          json: { id: body.id, jsonrpc: "2.0", result: "0x0" },
        });
    }
    return r.fallback();
  });
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page.getByRole("button", { name: /Browser Wallet/ }).click();
  await page
    .getByText("We couldn’t verify your Friends on Robinhood.", {
      exact: false,
    })
    .waitFor();
  assert.equal(
    await page.locator("iframe").count(),
    0,
    "RPC outage cannot authorize play",
  );
  assert.equal(
    await page.getByText("Raw Call Arguments", { exact: false }).count(),
    0,
  );
  assert.equal(
    await page
      .locator(".rf-frame-menu")
      .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
    true,
    "Error fits a 360px phone",
  );
  await page.screenshot({ path: "artifacts/wallet-rpc-error-360.png" });
  fixture.mode = "eligible";
  await page.getByRole("button", { name: "Retry loading Friends" }).click();
  await page.getByRole("button", { name: /^Friend #7730\b/ }).waitFor();
  assert.ok(fixture.ownerReads > 0, "Retry must verify ownership again");
  assert.equal(
    await page.locator("iframe").count(),
    0,
    "Discovery does not skip selection or eligibility",
  );
  assert.deepEqual(fixture.errors, []);
  console.log(
    "RPC outage, readable phone error, fresh retry, and ownership gate passed.",
  );
} finally {
  await browser.close();
}
