// Browser Testing only. Real simulation and character commands; SDK identity/art are automation fixtures.
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
  for (const width of [1440, 360]) {
    const context = await browser.newContext({
        viewport: { width, height: width === 360 ? 852 : 1000 },
        hasTouch: width === 360,
      }),
      page = await context.newPage();
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
    await page.getByRole("button", { name: /^Friend #7730\b/ }).click();
    const game = page.frameLocator("iframe");
    await game.getByRole("button", { name: "Easy", exact: true }).click();
    const created = page.waitForResponse(
      (r) => r.url().endsWith("/api/create") && r.ok(),
    );
    await game.getByRole("button", { name: "Create a match" }).click();
    const room = await (await created).json();
    assert.equal(room.state.crew, 0);
    assert.equal(room.state.workers.length, 0);
    await game.getByRole("button", { name: "Launch expedition" }).click();
    await game
      .getByRole("button", { name: "Choose Foundry →", exact: true })
      .click();
    await game
      .locator(".building-explanation")
      .filter({ hasText: "Makes alloy" })
      .waitFor();
    const canvas = game.locator("canvas"),
      zoom = width > 900 ? 1.8 : 1.35;
    let box = await canvas.boundingBox();
    await canvas.click({
      position: { x: box.width / 2 - 12 * zoom, y: box.height / 2 + 36 * zoom },
    });
    await game
      .getByText("Ready to build. Confirm placement.", { exact: true })
      .waitFor();
    const built = page.waitForResponse(
      (r) => r.url().endsWith("/api/command") && r.ok(),
    );
    await game
      .getByRole("button", { name: /^Build(?: ↵)?$/, exact: true })
      .click();
    const blueprint = await (await built).json();
    assert.equal(
      blueprint.state.friend.targetId,
      blueprint.state.modules.at(-1).id,
    );
    assert.equal(blueprint.state.crew, 0);
    await game
      .getByTestId("friend-task")
      .filter({ hasText: "Refining alloy" })
      .waitFor();
    const animationFrame = await canvas.evaluate((el) => el.toDataURL());
    await page.waitForTimeout(350);
    assert.notEqual(
      await canvas.evaluate((el) => el.toDataURL()),
      animationFrame,
      "Working scene visibly animates between snapshots",
    );
    await page.screenshot({ path: `artifacts/friend-working-${width}.png` });
    const hired = page.waitForResponse(
      (r) => r.url().endsWith("/api/command") && r.ok(),
    );
    await game.getByRole("button", { name: /^Recruit miner/ }).click();
    const recruited = await (await hired).json();
    assert.equal(recruited.state.workers.length, 1);
    assert.equal(recruited.state.workers[0].x, -1);
    assert.equal(recruited.state.workers[0].y, -1);
    await page.waitForResponse(
      async (r) =>
        r.url().endsWith("/api/sync") &&
        r.ok() &&
        (await r.json()).state.workers[0]?.task === "miners",
    );
    box = await canvas.boundingBox();
    const directed = page.waitForResponse(
      (r) => r.url().endsWith("/api/command") && r.ok(),
    );
    await canvas.click({
      position: { x: box.width / 2 - 12 * zoom, y: box.height / 2 - 12 * zoom },
    });
    const commanded = await (await directed).json();
    assert.equal(commanded.state.friend.targetId, 1);
    await game
      .getByTestId("friend-task")
      .filter({ hasText: "Salvaging alloy" })
      .waitFor();
    const continued = await page.waitForResponse(
      async (r) =>
        r.url().endsWith("/api/sync") &&
        r.ok() &&
        (await r.json()).state.workers[0]?.working,
    );
    assert.equal(
      (await continued.json()).state.workers[0].task,
      "miners",
      "Miner continues after Friend leaves",
    );
    await game.getByRole("button", { name: "Manage crew" }).click();
    await game
      .getByRole("dialog")
      .getByText("No workers spawn automatically.", { exact: false })
      .waitFor();
    await game
      .getByRole("button", { name: /Recruit worker/ })
      .click();
    await game.getByTestId("role-builders").filter({ hasText: "1" }).waitFor();
    await page.screenshot({ path: `artifacts/worker-jobs-${width}.png` });
    await game.getByRole("button", { name: "Close dialog" }).click();
    await game.getByRole("button", { name: "Follow your Friend" }).click();
    await page.screenshot({ path: `artifacts/friend-and-helper-${width}.png` });
    await assertBounds(page);
    assert.equal(
      await game
        .locator("body")
        .evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.equal(
      await game
        .locator(".bottom-strip")
        .evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight + 1),
      true,
      "Footer fits phone and desktop",
    );
    assert.deepEqual([...errors, ...fixture.errors], []);
    console.log(
      `PASS ${width}px: Friend builds and works, click-to-walk, worker recruitment and autonomous job, visible instructions, no overflow.`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
