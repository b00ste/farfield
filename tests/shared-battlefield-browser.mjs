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
  for (const width of [2560, 360]) {
    const a = await client(width, width === 360 ? 852 : 1440),
      commands = [];
    let latest;
    a.page.on("response", async (r) => {
      if (/\/api\/(sync|command|create)$/.test(r.url()) && r.ok()) {
        const v = await r.json().catch(() => null);
        if (v?.state) latest = v;
      }
    });
    a.page.on("request", (r) => {
      if (r.url().endsWith("/api/command"))
        commands.push(r.postDataJSON().command);
    });
    if (width === 2560) {
      await a.page
        .getByRole("combobox", { name: "AI commanders", exact: true })
        .click();
      await a.page.getByRole("option", { name: "3 AI", exact: true }).click();
    }
    await a.page
      .getByRole("button", { name: "Enter sector →", exact: true })
      .click();
    await a.game
      .getByRole("button", { name: "Begin match →", exact: true })
      .click();
    await a.game.locator(".sector-status").waitFor();
    assert.equal(await a.game.locator(".command-bar>button").count(), 2);
    assert.equal(
      await a.game.getByRole("button", { name: "Rivals", exact: true }).count(),
      0,
    );
    assert.equal(latest.players.length, width === 2560 ? 4 : 2);
    const spawnAt = latest.state.spawn;
    assert.ok(Math.abs(spawnAt.x) === 32 && Math.abs(spawnAt.y) === 32);
    assert.equal(
      latest.state.terrain.filter((m) => m.owner === "neutral").length,
      4,
    );
    assert.equal(latest.state.monoliths.length, 4);
    assert.equal(latest.state.seed, 0);
    assert.equal(latest.state.deposits.length, 0);
    assert.equal(latest.state.visibleUnits.length, 0);
    assert.equal(
      latest.state.terrain.some((m) => m.owner !== "neutral"),
      false,
    );
    const canvas = a.game.locator("canvas");
    await canvas.focus();
    await a.page.keyboard.press("b");
    await a.game.getByRole("group", { name: "Choose tile shape" }).waitFor();
    assert.equal(
      await a.game.getByRole("navigation", { name: "Station modules" }).count(),
      0,
    );
    await a.game.getByRole("button", { name: "O shape", exact: true }).click();
    await a.game
      .getByRole("button", { name: "Build Foundry", exact: true })
      .click();
    await a.page.keyboard.press("Escape");
    assert.equal(await a.game.locator(".context-command").count(), 0);
    await a.page.keyboard.press("b");
    await a.game.getByRole("button", { name: "O shape", exact: true }).click();
    await a.game
      .getByRole("button", { name: "Build Foundry", exact: true })
      .click();
    await a.page.waitForTimeout(100);
    assert.ok(
      await canvas.evaluate((el) => el === document.activeElement),
      "selection returns focus to level",
    );
    const box = await canvas.boundingBox(),
      z = width > 900 ? 1.5 : 1,
      spawn = latest.state.spawn;
    const point = (x, y) => ({
      x: box.width / 2 + (x - spawn.x + 0.5) * 24 * z,
      y: box.height / 2 + (y - spawn.y + 0.5) * 24 * z,
    });
    const candidate = (type, shape = 1) => {
      for (let y = spawn.y - 5; y <= spawn.y + 5; y++)
        for (let x = spawn.x - 5; x <= spawn.x + 5; x++)
          if (!placementError(latest.state, type, shape, 0, x, y))
            return { x, y };
      throw new Error("No placement");
    };
    const activate = async (p) =>
      width === 360
        ? canvas.tap({ position: p })
        : canvas.click({ position: p });
    const commandResponse = (type) =>
      a.page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/command") &&
          r.request().postDataJSON().command.type === type,
      );
    const tile = candidate("foundry"),
      waitBuild = commandResponse("build");
    await activate(point(tile.x, tile.y));
    const v = await (await waitBuild).json();
    assert.equal(
      commands.filter((c) => c.type === "build").length,
      1,
      "one press places immediately",
    );
    assert.equal(v.state.modules.length, 2);
    const cancel = commandResponse("demolish");
    await a.game.getByRole("button", { name: /Cancel blueprint/ }).click();
    const canceled = await (await cancel).json();
    assert.equal(canceled.state.modules.length, 1);
    assert.ok(canceled.state.alloy >= 65);
    await a.page.keyboard.press("b");
    await a.game.getByRole("button", { name: "O shape", exact: true }).click();
    await a.game
      .getByRole("button", { name: "Build Foundry", exact: true })
      .click();
    const rebuild = commandResponse("build");
    await activate(point(tile.x, tile.y));
    await rebuild;
    await a.game
      .getByRole("button", { name: /Dismantle/ })
      .waitFor({ timeout: 20000 });
    const demolish = commandResponse("demolish");
    await a.game.getByRole("button", { name: /Dismantle/ }).click();
    const demolished = await (await demolish).json();
    assert.equal(demolished.state.modules.at(-1).wreck, true);
    await a.page.keyboard.press("w");
    await a.game.locator(".crew-manager").waitFor();
    await a.page.waitForTimeout(200);
    assert.ok(
      await a.game
        .locator(".worker-palette")
        .evaluate((el) => el.scrollHeight <= el.clientHeight + 1),
      "worker controls fit",
    );
    await a.page.screenshot({ path: `artifacts/shared-workers-${width}.png` });
    await a.page.keyboard.press("w");
    await a.game
      .getByRole("button", { name: "View entire sector", exact: true })
      .click();
    await a.page.screenshot({ path: `artifacts/shared-sector-${width}.png` });
    assert.equal(
      await a.page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight + 1,
      ),
      true,
    );
    assert.deepEqual(a.fixture.errors, []);
    console.log(
      `PASS shared battlefield ${width}: shape-first, Escape, first-click placement, cancel/dismantle, focus, fog, two dock controls, no scrolling`,
    );
    await a.context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
