// Browser Testing profile only. UI identity is mocked; arena simulation is real.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { installFixture, assertBounds } from "./fixture.mjs";
const origin = process.env.TEST_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 2560, height: 1440 },
  });
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const fixture = await installFixture(page, origin);
  for (const route of [
    "https://pulse.walletconnect.org/**",
    "https://api.web3modal.org/**",
  ])
    await page.route(route, (r) => r.fulfill({ json: {} }));
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page.getByRole("button", { name: /Browser Wallet/ }).click();
  await page.locator(".friend-card-art svg rect").first().waitFor();
  await page.getByText("Hoverer · Gen 1").waitFor();
  await page.screenshot({ path: "artifacts/friend-portraits-2k.png" });
  await page.getByRole("textbox", { name: /Your crew awaits/ }).fill("99999");
  await page.getByText("No Friend matches that number.").waitFor();
  await page.getByRole("textbox", { name: /Your crew awaits/ }).fill("7730");
  await page.getByRole("button", { name: /^Friend #7730\b/ }).click();
  const game = page.frameLocator("iframe");
  await game.getByRole("button", { name: "Hard", exact: true }).click();
  const created = page.waitForResponse(
    (r) => r.url().endsWith("/api/create") && r.ok(),
  );
  await game.getByRole("button", { name: "Create a match" }).click();
  const room = await (await created).json();
  assert.equal(room.mode, "solo");
  assert.equal(room.opponents[0].bot, true);
  assert.equal(room.state.modules.length, 1);
  await game.getByRole("button", { name: "Launch expedition" }).click();
  await game.locator(".lobby-layer").waitFor({ state: "hidden" });
  const box = await page.locator(".rf-game-frame").boundingBox();
  assert.ok(box.width > 2500 && box.height > 1380, "2K view uses the screen");
  assert.ok(
    await game
      .locator(".module-name")
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).fontSize) >= 14),
  );
  await game
    .getByRole("button", { name: "Choose Foundry →", exact: true })
    .click();
  const canvas = game.locator("canvas"),
    map = await canvas.boundingBox();
  await page.mouse.move(
    map.x + map.width / 2 - 21.6,
    map.y + map.height / 2 + 64.8,
  );
  await game
    .getByText("Ready to build. Confirm placement.", { exact: true })
    .waitFor();
  await canvas.press("Enter");
  await game.getByText(/Foundry .*complete/).waitFor();
  const botBuilt = await page.waitForResponse(
    async (r) =>
      r.url().endsWith("/api/sync") &&
      r.ok() &&
      (await r.json()).opponents[0].state.modules.length >= 2,
  );
  assert.equal((await botBuilt.json()).opponents[0].state.friend.targetId, 2);
  await game
    .locator(".mission-sidebar")
    .getByRole("button", { name: "Inspect station" })
    .click();
  await game.getByText("Observing Strategist · AI", { exact: false }).waitFor();
  await game.getByRole("button", { name: "Return to your station" }).click();
  await game.getByRole("button", { name: "Rivals · 1 ↗" }).click();
  await game
    .getByRole("dialog")
    .getByText("Strategist · AI", { exact: true })
    .waitFor();
  assert.equal(
    await game
      .getByRole("dialog")
      .getByRole("button", { name: "Send fleet ↗" })
      .isDisabled(),
    true,
    "Preparation blocks attacks",
  );
  await game.getByRole("button", { name: "Close dialog" }).click();
  const rendered = await canvas.evaluate(async () => {
    const original = CanvasRenderingContext2D.prototype.clearRect;
    let frames = 0;
    CanvasRenderingContext2D.prototype.clearRect = function (...args) {
      frames++;
      return original.apply(this, args);
    };
    await new Promise((resolve) => setTimeout(resolve, 1000));
    CanvasRenderingContext2D.prototype.clearRect = original;
    return frames;
  });
  assert.ok(
    rendered > 30,
    "Canvas no longer has a 30 FPS cap on the test desktop",
  );
  await page.screenshot({ path: "artifacts/solo-ai-2k.png" });
  await assertBounds(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(200);
  assert.equal(await game.locator(".bottom-strip").evaluate(el => el.getBoundingClientRect().bottom <= innerHeight + 1), true, "Laptop footer fits without clipping");
  await page.screenshot({ path: "artifacts/solo-ai-laptop.png" });
  assert.deepEqual([...errors, ...fixture.errors], []);
  console.log(
    `PASS: canonical portrait UI/search, 2K layout, hover placement, solo AI construction, rival inspection, preparation gate; ${rendered} canvas frames in one second.`,
  );
} finally {
  await browser.close();
}
