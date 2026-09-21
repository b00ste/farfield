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
async function client(width, height, second = false) {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: width < 500,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => errors.push(e.message));
  const fixture = await installFixture(page, origin);
  await collectionFixture(page);
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
  if (second)
    await page.evaluate(
      (owner) => window.__friendWalletTest.accounts([owner]),
      SECOND_OWNER,
    );
  await page.getByRole("button", { name: /Friends & AI/ }).click();
  await page
    .getByRole("button", { name: "Enter sector →", exact: true })
    .waitFor();
  return { context, page, fixture, game: page.frameLocator("iframe") };
}

try {
  for (const width of [2560, 360]) {
    const a = await client(width, width === 360 ? 852 : 1440);
    await a.page.getByRole("button", { name: "Back to main menu" }).click();
    const change = a.page.getByRole("button", { name: /Change commander/ });
    assert.equal(
      await change.evaluate((el) => el.parentElement.className),
      "title-menu",
    );
    await change.click();
    await a.page.getByRole("region", { name: "Your commanders" }).waitFor();
    assert.equal(await a.page.locator("dialog[open]").count(), 0);
    assert.equal(
      await a.page.getByRole("navigation", { name: "Main menu" }).count(),
      0,
    );
    await a.page.locator(".roster-friend").first().click();
    assert.ok(await a.page.locator(".roster-friend").count() >= (width > 900 ? 12 : 3), "uses available space for the roster");
    const firstId=await a.page.locator(".roster-friend").first().getAttribute("aria-label");
    await a.page.getByRole("button",{name:"Next Friends",exact:true}).click();
    assert.notEqual(await a.page.locator(".roster-friend").first().getAttribute("aria-label"),firstId);
    await a.page.getByRole("button",{name:"Previous Friends",exact:true}).click();
    await a.page.getByRole("textbox",{name:"Find a Friend"}).fill("7771");
    assert.equal(await a.page.locator(".roster-friend").count(),1);
    await a.page.locator(".roster-friend").click();
    await a.page.getByRole("heading",{name:"Friend #7771",exact:true}).waitFor();
    await a.page.getByRole("textbox",{name:"Find a Friend"}).fill("");
    await a.page.locator(".commander-portrait canvas").waitFor();
    await a.page
      .getByTestId("friend-type")
      .filter({ hasText: "TYPE · Hoverer" })
      .waitFor();
    assert.equal(await a.page.locator(".friend-card").count(), 0);
    assert.ok(
      await a.page
        .locator(".commander-screen")
        .evaluate((el) => el.getBoundingClientRect().width >= innerWidth - 1),
    );
    await a.page.getByRole("button", { name: "Walk", exact: true }).click();
    const frames = new Set();
    for (let i = 0; i < 10; i++) {
      frames.add(
        await a.page
          .locator(".commander-portrait canvas")
          .evaluate((el) => el.toDataURL()),
      );
      await a.page.waitForTimeout(140);
    }
    assert.ok(frames.size > 1, "canonical Friend frames animate");
    await a.page.getByRole("button", { name: "Idle", exact: true }).click();
    const idleFrames=new Set();
    for(let i=0;i<10;i++){idleFrames.add(await a.page.locator(".commander-portrait canvas").evaluate(el=>el.toDataURL()));await a.page.waitForTimeout(140);}
    assert.ok(idleFrames.size>1,"inspection animates by default as well as when walking");
    for (const selector of [
      ".commander-screen",
      ".commander-inspect .play-button",
      ".commander-pages",
    ]) {
      const box = await a.page.locator(selector).boundingBox();
      assert.ok(
        box.x >= 0 &&
          box.y >= 0 &&
          box.x + box.width <= width + 1 &&
          box.y + box.height <= (width === 360 ? 852 : 1440) + 1,
        selector + " fits",
      );
    }
    assert.equal(
      await a.page.evaluate(
        () => document.documentElement.scrollHeight > innerHeight,
      ),
      false,
    );
    await a.page.screenshot({
      path: `artifacts/commander-screen-${width}.png`,
    });
    await a.page
      .getByRole("button", { name: /Select commander|Keep commander/ })
      .click();
    await a.page.getByRole("navigation", { name: "Main menu" }).waitFor();
    await a.page.getByRole("button", { name: /Change commander/ }).click();
    await a.page.getByRole("button", { name: "Back to main menu" }).click();
    await a.page.getByRole("navigation", { name: "Main menu" }).waitFor();
    await a.page.getByRole("button", { name: /Friends & AI/ }).click();
    assert.equal(await a.page.locator("select").count(), 0);
    const count = a.page.getByRole("combobox", {
      name: "AI commanders",
      exact: true,
    });
    await count.click();
    await a.page.getByRole("option", { name: "3 AI", exact: true }).click();
    assert.match(await count.innerText(), /3 AI/);
    const difficulty = a.page.getByRole("combobox", {
      name: "AI difficulty",
      exact: true,
    });
    await difficulty.focus();
    await a.page.keyboard.press("ArrowDown");
    await a.page.keyboard.press("End");
    await a.page.keyboard.press("Enter");
    assert.match(await difficulty.innerText(), /Hard/);
    await count.click();
    await a.page.keyboard.press("Escape");
    assert.equal(await a.page.getByRole("listbox").count(), 0);
    await count.click();
    await a.page
      .getByRole("option", { name: "Friends only", exact: true })
      .click();
    assert.ok(await difficulty.isDisabled());
    await count.click();
    await a.page.screenshot({ path: `artifacts/custom-select-${width}.png` });
    await a.page.keyboard.press("Escape");
    assert.deepEqual(a.fixture.errors, []);
    await a.context.close();
    console.log(
      `PASS ${width}: dedicated commander screen, portrait inspection, selection, Back, no scrolling.`,
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
