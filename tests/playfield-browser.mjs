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
async function choose(scope, label, value) {
  await scope.getByRole("combobox", { name: label, exact: true }).click();
  await scope.getByRole("option", { name: value, exact: true }).click();
}
const contexts = [];
try {
  for (const width of [2560, 360]) {
    const a = await client(width, width === 360 ? 852 : 1440);
    contexts.push(a);
    await a.page.screenshot({ path: `artifacts/landing-${width}.png` });
    await choose(a.page, "AI commanders", "4 AI");
    const created = a.page.waitForResponse(
      (r) => r.url().endsWith("/api/create") && r.ok(),
    );
    await a.page
      .getByRole("button", { name: "Enter sector →", exact: true })
      .click();
    const room = await (await created).json();
    assert.match(
      await a.page.locator("iframe").getAttribute("src"),
      /game\.html\?v=[a-f0-9]+/,
    );
    assert.equal(
      await a.game
        .getByRole("button", { name: "Solo vs AI", exact: true })
        .count(),
      0,
    );
    assert.equal(room.players.length, 5);
    assert.ok(room.opponents.every((p) => p.state === null && !p.discovered));
    assert.equal(
      await a.game.locator(".flight-brand, .pilot-status").count(),
      0,
    );
    assert.equal(await a.game.locator(".command-bar button").count(), 3);

    await a.game
      .getByRole("button", { name: "Begin match →", exact: true })
      .waitFor();
    assert.equal(
      await a.game.locator(".lobby-layer").count(),
      0,
      "custom setup is on the playfield",
    );
    const canvas = a.game.locator("canvas");
    let box = await canvas.boundingBox();
    assert.ok(box.width >= width - 2);
    assert.ok(box.height >= (width === 360 ? 852 : 1440) - 2);
    await a.game
      .getByRole("button", { name: "Invite & AI", exact: true })
      .click();
    await a.game
      .getByRole("button", { name: /Remove Cadet|Remove Navigator/ })
      .first()
      .click();
    await a.game
      .getByRole("button", { name: "Add hard AI", exact: true })
      .click();
    await a.game.locator(".match-roster>div").nth(4).waitFor();
    assert.equal(await a.game.locator(".match-roster>div").count(), 5);
    await a.game.getByRole("button", { name: "Close dialog" }).click();
    await a.game
      .getByRole("button", { name: "Begin match →", exact: true })
      .click();
    await a.game
      .getByTitle("Energy powers rooms, research and defense")
      .click();
    await a.game
      .getByRole("button", { name: "Gather energy", exact: true })
      .click();
    await a.game
      .getByRole("alert")
      .filter({ hasText: "completed passages" })
      .waitFor();
    await a.page.screenshot({ path: `artifacts/floor-required-${width}.png` });
    // Reset camera, place a Foundry at the first connected row.
    await a.game
      .getByRole("button", { name: "Center station", exact: true })
      .click();
    // Each docking option persists through a return to the title menu.
    for (const side of ["left", "right", "bottom"]) {
      await a.game
        .getByRole("button", { name: "Game menu", exact: true })
        .click();
      await choose(
        a.game,
        "Controls position",
        side[0].toUpperCase() + side.slice(1),
      );
      await a.game.getByRole("button", { name: "Close dialog" }).click();
      await a.game.getByRole("button", { name: "Open build panel" }).click();
      await a.page.waitForTimeout(200);
      for (const selector of [".command-bar", ".command-drawer"]) {
        const rect = await a.game.locator(selector).boundingBox();
        assert.ok(
          rect.x >= 0 &&
            rect.y >= 0 &&
            rect.x + rect.width <= width + 1 &&
            rect.y + rect.height <= (width === 360 ? 852 : 1440) + 1,
          `${side} ${selector} fits`,
        );
      }
      const before = await a.game.locator(".sector-status").innerText();
      await a.page.waitForTimeout(1200);
      assert.notEqual(
        await a.game.locator(".sector-status").innerText(),
        before,
        "simulation continues with build drawer open",
      );
      await a.page.screenshot({ path: `artifacts/dock-${side}-${width}.png` });
      await a.game.getByRole("button", { name: "Close build panel" }).click();
    }
    await a.game.getByRole("button", { name: "Rivals", exact: true }).click();
    assert.equal(await a.game.locator(".station-thumbnail").count(), 0);
    assert.equal(
      await a.game
        .getByRole("button", { name: "Inspect station", exact: true })
        .count(),
      0,
    );
    await a.game
      .getByRole("button", { name: "Explore with Friend →", exact: true })
      .first()
      .click();
    await a.game
      .getByRole("alert")
      .filter({ hasText: "completed passages" })
      .waitFor();
    await a.game
      .getByRole("button", { name: "Center station", exact: true })
      .click();
    await a.game.getByRole("button", { name: "Open build panel" }).click();
    await a.page.screenshot({ path: `artifacts/build-controls-${width}.png` });
    await a.game
      .getByRole("button", { name: "Build Foundry", exact: true })
      .click();
    box = await canvas.boundingBox();
    const zoom = width > 900 ? 1.5 : 1;
    await canvas.click({
      position: { x: box.width / 2 - 12 * zoom, y: box.height / 2 + 36 * zoom },
    });
    await a.game
      .getByTestId("friend-task")
      .filter({ hasText: "Refining alloy" })
      .waitFor();
    await a.game
      .getByRole("button", { name: "Manage crew", exact: true })
      .click();
    await a.game.getByRole("button", { name: /Recruit worker/ }).click();
    await a.game
      .getByTestId("role-builders")
      .filter({ hasText: "1" })
      .waitFor();
    await a.game
      .getByRole("button", { name: "Assign miner", exact: true })
      .click();
    await a.game.getByTestId("role-miners").filter({ hasText: "1" }).waitFor();
    await a.game
      .getByRole("button", { name: "Remove miner", exact: true })
      .click();
    await a.game
      .getByTestId("role-builders")
      .filter({ hasText: "1" })
      .waitFor();
    const workerPanel = await a.game.locator(".worker-palette").boundingBox();
    const lastJob = await a.game
      .getByRole("button", { name: "Assign scientist", exact: true })
      .boundingBox();
    assert.ok(
      lastJob.y + lastJob.height <= workerPanel.y + workerPanel.height,
      "All worker controls visible without scrolling",
    );
    await a.page.screenshot({ path: `artifacts/workers-compact-${width}.png` });
    assert.equal(await a.game.locator("dialog[open]").count(), 0);
    await a.game.getByRole("button", { name: "Close workers panel" }).click();
    if (
      await a.game
        .getByRole("button", { name: "Close building details" })
        .count()
    )
      await a.game
        .getByRole("button", { name: "Close building details" })
        .click();
    await a.page.screenshot({ path: `artifacts/fullscreen-play-${width}.png` });
    await a.game.getByRole("button", { name: "Rivals", exact: true }).click();
    assert.equal(await a.game.locator(".station-thumbnail").count(), 0);
    assert.equal(await a.game.locator(".unknown-station").count(), 4);
    await a.game.getByRole("button", { name: "Close rivals panel" }).click();

    assert.equal(
      await a.game
        .locator("body")
        .evaluate(() => document.documentElement.scrollWidth > innerWidth),
      false,
    );
    assert.equal(
      await a.game
        .locator(".command-bar")
        .evaluate((el) => el.getBoundingClientRect().bottom <= innerHeight),
      true,
    );
    await a.game.getByRole("button", { name: "Game menu" }).click();
    await a.game
      .getByRole("button", { name: "Wallet & connection →", exact: true })
      .click();
    const walletDialog = a.page.locator('[data-rk="farfield"][role="dialog"]');
    await walletDialog.getByRole("button", { name: /Disconnect/ }).waitFor();
    assert.equal(
      await a.page.locator(".rf-game-frame").evaluate((el) => el.inert),
      true,
    );
    const walletBox = await walletDialog.boundingBox();
    assert.ok(walletBox.x >= 0 && walletBox.x + walletBox.width <= width + 1);
    await a.page.waitForTimeout(300);
    await a.page.screenshot({ path: `artifacts/game-wallet-${width}.png` });
    await a.page.keyboard.press("Escape");
    await walletDialog.waitFor({ state: "hidden" });
    await a.game
      .getByRole("button", { name: "Forfeit match", exact: true })
      .click();
    await a.game
      .getByRole("button", { name: "Confirm forfeit", exact: true })
      .click();
    await a.game
      .getByTestId("match-reason")
      .filter({ hasText: "You forfeited the match." })
      .waitFor();
    await a.game
      .getByTestId("match-winner")
      .filter({ hasText: "no winner yet" })
      .waitFor();
    assert.ok(
      await a.game
        .getByRole("region", { name: "Match result" })
        .evaluate((el) => {
          const r = el.getBoundingClientRect();
          return (
            r.x === 0 &&
            r.y === 0 &&
            r.width === innerWidth &&
            r.height === innerHeight
          );
        }),
    );
    assert.equal(
      await a.game
        .getByRole("navigation", { name: "Game actions" })
        .isVisible(),
      false,
    );
    assert.equal(
      await a.game
        .getByRole("button", { name: "Game menu", exact: true })
        .isVisible(),
      false,
    );
    await a.page.screenshot({ path: `artifacts/result-clear-${width}.png` });
    await a.game
      .getByRole("button", { name: "Main menu →", exact: true })
      .click();
    await a.page.locator(".game-landing").waitFor();
    await a.page.getByRole("button", { name: /Friends & AI/ }).click();
    // Persist a non-default dock through returning to the title and launching again.
    await a.page
      .getByRole("button", { name: "Enter sector →", exact: true })
      .click();
    await a.game
      .getByRole("button", { name: "Game menu", exact: true })
      .click();
    await choose(a.game, "Controls position", "Right");
    await a.game
      .getByRole("button", { name: "Main menu →", exact: true })
      .click();
    await a.page.getByRole("button", { name: /Friends & AI/ }).click();
    await a.page
      .getByRole("button", { name: "Enter sector →", exact: true })
      .click();
    await a.game.locator('.immersive-game[data-dock="right"]').waitFor();
    assert.deepEqual(a.fixture.errors, []);
    console.log(
      `PASS ${width}: landing, auto commander, 4 AI, full-screen custom setup, floor-gated gathering/exploration, build, compact worker assignments, forfeit, return, no overflow.`,
    );
    await a.context.close();
  }
  const a = await client(1440, 1000),
    b = await client(360, 852, true);
  contexts.push(a, b);
  // Mixed match: 1 human host + 3 AI + a joining human.
  await choose(a.page, "AI commanders", "3 AI");
  const created = a.page.waitForResponse(
    (r) => r.url().endsWith("/api/create") && r.ok(),
  );
  await a.page
    .getByRole("button", { name: "Enter sector →", exact: true })
    .click();
  const room = await (await created).json();
  await b.page.getByRole("button", { name: "Back to main menu" }).click();
  await b.page.getByRole("button", { name: /Join friends/ }).click();
  await b.page.getByRole("textbox", { name: "Match code" }).fill(room.code);
  await b.page
    .getByRole("button", { name: "Join friends →", exact: true })
    .click();
  await b.game.getByText("Waiting for host", { exact: true }).waitFor();
  await a.game
    .getByRole("button", { name: "Begin match →", exact: true })
    .click();
  await b.game.locator(".sector-status").waitFor();
  assert.equal(await b.game.locator(".launch-ribbon").count(), 0);
  for (const c of [a, b]) {
    await c.game.getByRole("button", { name: "Game menu" }).click();
    await c.game
      .getByRole("button", { name: "Forfeit match", exact: true })
      .click();
    await c.game
      .getByRole("button", { name: "Confirm forfeit", exact: true })
      .click();
    await c.game
      .getByRole("button", { name: "Main menu →", exact: true })
      .click();
  }
  // Online matchmaking pairs these clients automatically. The future mode stays disabled.
  for (const c of [a, b]) {
    await c.page.getByRole("button", { name: /Online PvP/ }).click();
    assert.equal(
      await c.page
        .getByRole("button", { name: /Wagered · Coming soon/ })
        .isDisabled(),
      true,
    );
    await c.page
      .getByRole("button", { name: "Find free match →", exact: true })
      .click();
  }
  await a.game.locator(".sector-status").waitFor();
  await b.game.locator(".sector-status").waitFor();
  await a.game.getByRole("button", { name: "Game menu" }).click();
  assert.equal(
    await a.game
      .getByRole("button", { name: "Pause match", exact: true })
      .count(),
    0,
  );
  await a.game
    .getByRole("button", { name: "Forfeit match", exact: true })
    .click();
  await a.game
    .getByRole("button", { name: "Confirm forfeit", exact: true })
    .click();
  await b.game.getByRole("heading", { name: "Victory", exact: true }).waitFor();
  assert.ok(
    await b.game
      .getByRole("region", { name: "Match result" })
      .evaluate((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.x === 0 &&
          r.y === 0 &&
          r.width === innerWidth &&
          r.height === innerHeight
        );
      }),
  );
  assert.equal(
    await b.game.getByRole("navigation", { name: "Game actions" }).isVisible(),
    false,
  );
  assert.deepEqual([...a.fixture.errors, ...b.fixture.errors, ...errors], []);
  console.log(
    "PASS mixed 5-seat custom match, automatic online pairing, no online pause, forfeit/winner propagation, RF deposits unavailable.",
  );
} catch (e) {
  for (const [i, c] of contexts.entries())
    if (!c.page.isClosed()) {
      await c.page.screenshot({ path: `artifacts/playfield-failure-${i}.png` });
      console.error((await c.page.locator("body").innerText()).slice(-1500));
    }
  throw e;
} finally {
  await browser.close();
}
