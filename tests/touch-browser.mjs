// Run only in Browser Testing. All UI actions use touch, never mouse or keyboard shortcuts.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { installFixture } from "./fixture.mjs";
import { collectionFixture } from "./collection-fixture.mjs";
import { placementError } from "../games/farfield/engine.ts";
const origin = process.env.TEST_URL || "http://127.0.0.1:4173";
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const sizes = process.env.TOUCH_SIZE
  ? [process.env.TOUCH_SIZE.split("x").map(Number)]
  : [
      [320, 568],
      [360, 852],
      [852, 393],
      [1024, 768],
    ];
try {
  for (const [width, height] of sizes) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    const fixture = await installFixture(page, origin);
    await collectionFixture(page);
    await page.route("https://pulse.walletconnect.org/**", (r) =>
      r.fulfill({ json: {} }),
    );
    await page.route("https://api.web3modal.org/**", (r) =>
      r.fulfill({ json: {} }),
    );
    let latest;
    const commands = [];
    page.on("response", async (r) => {
      if (/\/api\/(sync|command|create)$/.test(r.url()) && r.ok()) {
        const v = await r.json().catch(() => null);
        if (v?.state) latest = v;
      }
    });
    page.on("request", (r) => {
      if (r.url().endsWith("/api/command"))
        commands.push(r.postDataJSON().command);
    });
    const game = page.frameLocator("iframe");
    const tap = async (root, name) =>
      root.getByRole("button", { name, exact: true }).tap();
    const waitFor = async (fn, label) => {
      for (let n = 0; n < 150; n++) {
        if (await fn()) return;
        await page.waitForTimeout(100);
      }
      throw new Error(label);
    };
    const response = (type) =>
      page.waitForResponse(
        (r) =>
          r.url().endsWith("/api/command") &&
          r.request().postDataJSON().command.type === type,
      );
    const action = async (type, fn) => {
      const p = response(type);
      await fn();
      const r = await p;
      const v = await r.json();
      assert.ok(!v.error, JSON.stringify(v));
      latest = v;
      return v;
    };
    await page.goto(origin);
    await page.locator(".game-landing").waitFor();
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .first()
      .tap();
    await page.getByRole("button", { name: /Browser Wallet/ }).tap();
    await page.getByRole("button", { name: /Change commander/ }).tap();
    await page.locator(".roster-friend").first().tap();
    await tap(page, "Next Friends");
    await tap(page, "Previous Friends");
    await page.locator(".roster-friend").first().tap();
    await tap(page, "Walk");
    await tap(page, "Idle");
    await page.getByRole("button", { name: /Select commander/ }).tap();
    await page.getByRole("button", { name: /Friends & AI/ }).tap();
    await page
      .getByRole("combobox", { name: "AI commanders", exact: true })
      .tap();
    assert.equal(
      await page.getByRole("option", { name: "4 AI", exact: true }).count(),
      0,
    );
    await page.getByRole("option", { name: "3 AI", exact: true }).tap();
    await page
      .getByRole("combobox", { name: "AI difficulty", exact: true })
      .tap();
    await page.getByRole("option", { name: "Easy", exact: true }).tap();
    await tap(page, "Enter sector →");
    await tap(game, "Begin match →");
    await game.locator(".sector-status").waitFor();
    await waitFor(() => latest?.state.phase === "playing", "playing");
    assert.equal(latest.players.length, 4);
    const canvas = game.locator("canvas"),
      cdp = await context.newCDPSession(page);
    const touch = async (type, points) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map((p, id) => ({
          id,
          ...p,
          radiusX: 2,
          radiusY: 2,
          force: 1,
        })),
      });
    const zoom = async () =>
      Number(
        (await game.locator(".map-controls span").innerText()).replace("%", ""),
      );
    await tap(game, "Zoom in");
    const zin = await zoom();
    await tap(game, "Zoom out");
    assert.ok((await zoom()) < zin);
    await tap(game, "Center station");
    const box = await canvas.boundingBox(),
      cx = box.x + box.width / 2,
      cy = box.y + box.height / 2;
    const z0 = await zoom(),
      count0 = commands.length;
    await touch("touchStart", [
      { x: cx - 30, y: cy },
      { x: cx + 30, y: cy },
    ]);
    for (let i = 1; i <= 8; i++)
      await touch("touchMove", [
        { x: cx - 30 - i * 6, y: cy },
        { x: cx + 30 + i * 6, y: cy },
      ]);
    await touch("touchEnd", [{ x: cx + 78, y: cy }]);
    await touch("touchMove", [{ x: cx + 82, y: cy + 4 }]);
    await touch("touchEnd", []);
    await page.waitForTimeout(200);
    assert.ok((await zoom()) > z0, "two-finger pinch zooms");
    assert.equal(
      commands.length,
      count0,
      "pinch must not issue a gameplay command",
    );
    await tap(game, "Center station");
    await tap(game, "Open build panel");
    await tap(game, "O shape");
    await tap(game, "Build Foundry");
    await tap(game, "Rotate ↻");
    const beforeDrag = commands.length;
    await touch("touchStart", [{ x: cx, y: cy }]);
    for (let i = 1; i <= 6; i++)
      await touch("touchMove", [{ x: cx + i * 10, y: cy + 15 }]);
    await touch("touchEnd", []);
    await page.waitForTimeout(150);
    assert.equal(
      commands.length,
      beforeDrag,
      "drag does not place or move Friend",
    );
    await touch("touchStart", [{ x: cx, y: cy }]);
    await touch("touchCancel", []);
    assert.equal(commands.length, beforeDrag, "cancelled touch does not place");
    await tap(game, "Center station");
    const spawn = latest.state.spawn,
      z = width > 900 ? 1.5 : 1;
    const pt = (x, y) => ({
      x: box.width / 2 + (x - spawn.x + 0.5) * 24 * z,
      y: box.height / 2 + (y - spawn.y + 0.5) * 24 * z,
    });
    let tile;
    for (let y = spawn.y - 4; y <= spawn.y + 4 && !tile; y++)
      for (let x = spawn.x - 4; x <= spawn.x + 4; x++) {
        const p = pt(x, y);
        if (
          p.y > 130 &&
          p.y < height - 140 &&
          !placementError(latest.state, "foundry", 1, 1, x, y)
        ) {
          tile = { x, y };
          break;
        }
      }
    assert.ok(tile, "visible placement available");
    let v = await action("build", () =>
      canvas.tap({ position: pt(tile.x, tile.y) }),
    );
    assert.equal(v.state.modules.length, 2);
    assert.equal(commands.filter((c) => c.type === "build").length, 1);
    await action("demolish", () =>
      page
        .waitForTimeout(0)
        .then(() =>
          game.getByRole("button", { name: /Cancel blueprint/ }).tap(),
        ),
    );
    await tap(game, "Open build panel");
    await tap(game, "O shape");
    await tap(game, "Build Foundry");
    await action("build", () => canvas.tap({ position: pt(tile.x, tile.y) }));
    await game
      .getByRole("button", { name: /Dismantle/ })
      .waitFor({ timeout: 25000 });
    await tap(game, "Close building details");
    await action("direct", () => canvas.tap({ position: pt(tile.x, tile.y) }));
    await tap(game, "Close building details");
    await tap(game, "Manage crew");
    await action("recruit", () =>
      game.getByRole("button", { name: /Recruit worker/ }).tap(),
    );
    await action("assign", () => tap(game, "Assign miner"));
    assert.equal(latest.state.roles.miners, 1);
    await action("assign", () => tap(game, "Remove miner"));
    assert.equal(latest.state.roles.builders, 1);
    const palette = game.locator(".worker-palette");
    if (await palette.evaluate((el) => el.scrollHeight > el.clientHeight + 1)) {
      const r = await palette.boundingBox(),
        before = commands.length;
      const x = r.x + 50,
        y = r.y + r.height - 25;
      await touch("touchStart", [{ x, y }]);
      for (let i = 1; i <= 8; i++) {
        await touch("touchMove", [{ x, y: y - i * 15 }]);
        await page.waitForTimeout(20);
      }
      await touch("touchEnd", []);
      await waitFor(
        () => palette.evaluate((el) => el.scrollTop > 0),
        "worker panel scrolls with a swipe",
      );
      assert.equal(commands.length, before, "panel swipe never reaches map");
    }
    // Capture without changing mobile device metrics mid-test.
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    await writeFile(
      `artifacts/touch-workers-${width}.png`,
      Buffer.from(shot.data, "base64"),
    );
    await tap(game, "Close workers panel");
    await tap(game, "Center station");
    await tap(game, "Open build panel");
    await tap(game, "O shape");
    await tap(game, "Build Defense");
    let defense;
    for (let y = spawn.y - 5; y <= spawn.y + 5 && !defense; y++)
      for (let x = spawn.x - 5; x <= spawn.x + 5; x++) {
        const p = pt(x, y);
        if (
          p.x > 25 &&
          p.x < width - 25 &&
          p.y > 130 &&
          p.y < height - 140 &&
          !placementError(latest.state, "turret", 1, 0, x, y)
        ) {
          defense = { x, y };
          break;
        }
      }
    assert.ok(defense, "visible defense placement");
    await action("build", () =>
      canvas.tap({ position: pt(defense.x, defense.y) }),
    );
    await game
      .getByRole("button", { name: /Dismantle/ })
      .waitFor({ timeout: 25000 });
    await tap(game, "Close building details");
    await tap(game, "Manage crew");
    await action("assign", () => tap(game, "Assign guard"));
    for (const label of [
      "Guards: follow Friend",
      "Guards: hold here",
      "Staff turrets",
    ])
      await action("guards", () => tap(game, label));
    await action("assign", () => tap(game, "Remove guard"));
    await tap(game, "Close workers panel");
    await action("direct", () =>
      canvas.tap({ position: pt(defense.x, defense.y) }),
    );
    await action("demolish", () =>
      game.getByRole("button", { name: /Dismantle/ }).tap(),
    );
    await waitFor(
      () => !latest.state.modules.some((m) => m.type === "turret"),
      "dismantled floor removed after units clear",
    );
    for (const dock of ["Left", "Right", "Bottom"]) {
      await tap(game, "Game menu");
      await game
        .getByRole("combobox", { name: "Controls position", exact: true })
        .tap();
      await game.getByRole("option", { name: dock, exact: true }).tap();
      await tap(game, "Close dialog");
      await tap(game, "Open build panel");
      await tap(game, "Z shape");
      await tap(game, "Build Passage");
      await tap(game, "Close building details");
      await tap(game, "Manage crew");
      await tap(game, "Close workers panel");
    }
    await tap(game, "View entire sector");
    assert.ok(
      (await zoom()) <= Math.round((Math.min(width, height) / (84 * 24)) * 100),
      "entire sector fits screen",
    );
    await tap(game, "View The Listener");
    const captureResponse = response("capture");
    await canvas.tap({
      position: { x: box.width / 2 + 9, y: box.height / 2 + 9 },
    });
    const capture = await (await captureResponse).json();
    assert.ok(capture.error, "unconnected monolith refuses capture");
    await tap(game, "Dismiss message");
    await tap(game, "Game menu");
    const sound = game.getByRole("button", { name: /^Sound/ }),
      before = await sound.getAttribute("aria-pressed");
    await sound.tap();
    assert.notEqual(await sound.getAttribute("aria-pressed"), before);
    await action("pause", () =>
      game.getByRole("button", { name: /Pause match/ }).tap(),
    );
    assert.equal(latest.state.paused, true);
    await action("pause", () =>
      game.getByRole("button", { name: /Resume match/ }).tap(),
    );
    assert.equal(latest.state.paused, false);
    await tap(game, "Follow your Friend");
    await tap(game, "Game menu");
    await action("stop-friend", () => tap(game, "Stop your Friend"));
    await tap(game, "Close dialog");
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollHeight <= innerHeight + 1,
      ),
      "no document scrolling",
    );
    await tap(game, "Game menu");
    await tap(game, "Forfeit match");
    await action("forfeit", () => tap(game, "Confirm forfeit"));
    await tap(game, "Main menu →");
    await page.locator(".game-landing").waitFor();
    await page.screenshot({ path: `artifacts/touch-menu-${width}.png` });
    assert.deepEqual(errors, []);
    assert.deepEqual(fixture.errors, []);
    console.log(
      `PASS touch ${width}x${height}: roster, selectors, pinch, pan, cancel gesture, build/rotate/refund, movement, workers/guards, panel swipes, all docks, zoom, settings, pause, forfeit`,
    );
    await context.close();
  }
} finally {
  await browser.close();
}
