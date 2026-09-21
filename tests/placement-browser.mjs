// Browser Testing only: wallet fixtures are never shipped in the game.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { installFixture, SECOND_OWNER } from "./fixture.mjs";
import { placementError } from "../games/farfield/engine.ts";
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
  for (const width of [1440, 360]) {
    const a = await client(width, width === 360 ? 852 : 900);
    const commands = [];
    a.page.on("request", (r) => {
      if (r.url().endsWith("/api/command")) {
        const body = r.postDataJSON();
        if (body.command?.type === "build") commands.push(body.command);
      }
    });
    await a.page
      .getByRole("button", { name: "Enter sector →", exact: true })
      .click();
    await a.game
      .getByRole("button", { name: "Begin match →", exact: true })
      .click();
    await a.game.locator(".sector-status").waitFor();
    const canvas = a.game.locator("canvas");
    await canvas.focus();
    await a.page.keyboard.press("b");
    await a.game.getByRole("group",{name:"Choose tile shape"}).waitFor();
    await a.page.keyboard.press("b");
    await a.game.locator(".build-palette").waitFor({state:"hidden"});
    await a.page.keyboard.press("w");
    await a.game.locator(".crew-manager").waitFor();
    await a.page.waitForTimeout(200);
    assert.ok(await a.game.locator(".worker-palette").evaluate(el=>el.scrollHeight<=el.clientHeight+1),"all worker rows fit without scrolling");
    await a.page.screenshot({path:`artifacts/workers-final-${width}.png`});
    await a.page.keyboard.press("w");
    await a.game.locator(".crew-manager").waitFor({state:"hidden"});
    await a.page.keyboard.press("b");
    await a.game
      .getByRole("button", { name: "Build Foundry", exact: true })
      .click();
    const box = await canvas.boundingBox(),
      z = width > 900 ? 1.5 : 1;
    const point = (x, y) => ({
      x: box.width / 2 + (x + 0.5) * 24 * z,
      y: box.height / 2 + (y + 0.5) * 24 * z,
    });
    if (width > 900) {
      const p = point(1, -1);
      await a.page.mouse.move(box.x + p.x, box.y + p.y);
      await a.page.waitForTimeout(150);
      assert.equal(commands.length, 0, "hover only previews");
      await canvas.click({ button: "right", position: p });
      assert.equal(commands.length, 0, "right click never places");
      await a.page.mouse.move(box.x + p.x, box.y + p.y);
      await a.page.mouse.down();
      await a.page.mouse.move(box.x + p.x + 70, box.y + p.y + 20, { steps: 8 });
      await a.page.mouse.up();
      assert.equal(commands.length, 0, "drag pans without building");
      await a.game
        .getByRole("button", { name: "Center station", exact: true })
        .click();
    }
    const activate = async (p) =>
      width === 360
        ? canvas.tap({ position: p })
        : canvas.click({ position: p });
    await activate(point(-1, -1));
    await a.game.getByRole("alert").waitFor();
    assert.equal(commands.length, 0, "invalid placement is not submitted");
    const built = a.page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/command") &&
        r.request().postDataJSON().command?.type === "build",
    );
    await activate(point(-1, 1));
    const response = await built;
    assert.ok(response.ok());
    const view = await response.json();
    assert.equal(commands.length, 1, "one click sends exactly one build");
    assert.equal(commands[0].x, -1);
    assert.equal(commands[0].y, 1);
    assert.equal(view.state.modules.length, 2);
    await a.game
      .getByTestId("friend-task")
      .filter({ hasText: "Refining alloy" })
      .waitFor();
    if (width > 900) {
      await a.game.getByRole("button", { name: "Open build panel" }).click();
      await a.game.getByRole("button",{name:"I shape",exact:true}).click();
      await a.game
        .getByRole("button", { name: "Build Reactor", exact: true })
        .click();
      let candidate;
      for (let y = -5; y <= 5 && !candidate; y++)
        for (let x = -5; x <= 5; x++)
          if (
            !placementError(view.state, "solar", 0, 1, x, y)
          ) {
            candidate = { x, y };
            break;
          }
      assert.ok(candidate);
      const p = point(candidate.x, candidate.y);
      await a.page.mouse.move(box.x + p.x, box.y + p.y);
      await canvas.focus();
      await a.page.keyboard.press("r");
      const keyboard = a.page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/command") &&
          r.request().postDataJSON().command?.type === "build",
      );
      await a.page.keyboard.press("Enter");
      assert.ok((await keyboard).ok());
      assert.equal(commands.length, 2);
      assert.equal(commands[1].rotation, 1);
      assert.equal(commands[1].shape,0);
    }
    assert.deepEqual(a.fixture.errors, []);
    console.log(
      `PASS ${width}: immediate ${width === 360 ? "touch" : "mouse"} placement, validation, construction${width > 900 ? ", preview-only hover, no right-click/drag builds, keyboard rotate/Enter" : ""}.`,
    );
    await a.context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
