// Browser Testing only: real UI and game API, fixture wallet/Friend reads.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { installFixture } from "./fixture.mjs";
import { observeRoom } from "./room-observer.mjs";
import { place } from "../server/arena.ts";
import { mkdir, writeFile } from "node:fs/promises";
const origin = process.env.TEST_URL || "http://127.0.0.1:4180";
const apiOrigin = new URL(process.env.TEST_API_URL || origin).origin;
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  args: ["--no-sandbox"],
});
const report = { origin, checks: [], errors: [] };
try {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
  ]) {
    const ctx = await browser.newContext({
      viewport: { width, height },
      hasTouch: width < 500,
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(7000);
    page.on("pageerror", (e) => report.errors.push(e.message));
    await installFixture(page, origin);
    let latest, token;
    await observeRoom(page, (v) => {
      if (!latest || v.revision >= latest.revision) latest = v;
      if (v.token) token = v.token;
    });
    const wait = async (fn, label) => {
      for (let i = 0; i < 200; i++) {
        if (await fn()) return;
        await page.waitForTimeout(100);
      }
      throw Error(label);
    };
    await page.goto(origin);
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: /Browser Wallet/ }).click();
    await page.getByRole("button", { name: /Friends & AI/ }).click();
    await page
      .getByRole("button", { name: "Enter sector →", exact: true })
      .click();
    const game = page.frameLocator("iframe");
    await game
      .getByRole("button", { name: "Begin match →", exact: true })
      .click();
    await wait(() => latest?.state.phase === "playing", "playing");
    const hint = await game.locator(".map-coordinates").boundingBox(),
      abilities = await game.locator(".ability-bar").boundingBox();
    assert.ok(
      !hint ||
        hint.y + hint.height <= abilities.y + 1 ||
        hint.x >= abilities.x + abilities.width ||
        hint.x + hint.width <= abilities.x,
      "map hint does not overlap ability controls",
    );
    await page.screenshot({ path: `artifacts/compact-hud-debug-${width}.png` });
    const workers = game
      .getByRole("navigation", { name: "Game actions" })
      .getByRole("button", { name: "Manage crew", exact: true });
    const mode = game.getByRole("button", { name: /Free workers:/ });
    assert.equal(
      await workers.locator("svg").innerHTML(),
      await mode.locator("svg.mode-unit-icon").innerHTML(),
      "worker unit graphic is consistent",
    );
    const build = place(structuredClone(latest.state), "foundry");
    assert.ok(build);
    const response = await page.request.post(apiOrigin + "/api/command", {
      headers: { Authorization: "Bearer " + token },
      data: { code: latest.code, command: build },
    });
    assert.ok(response.ok());
    await wait(
      () => latest.state.modules.some((m) => m.type === "foundry"),
      "foundry blueprint received",
    );
    const module = latest.state.modules.find((m) => m.type === "foundry");
    const cell = module.cells.at(-1),
      canvas = await game.locator("canvas").boundingBox();
    const zoom =
      Number(
        (await game.locator(".map-controls span").innerText()).replace("%", ""),
      ) / 100;
    await page.mouse.click(
      canvas.x +
        canvas.width / 2 +
        (cell.x - latest.state.spawn.x + 0.5) * 24 * zoom,
      canvas.y +
        canvas.height / 2 +
        (cell.y - latest.state.spawn.y + 0.5) * 24 * zoom,
    );
    const buildButton = game.getByRole("button", {
      name: "Build with Friend",
      exact: true,
    });
    await buildButton.waitFor();
    const hammer = await buildButton.locator("svg path").getAttribute("d");
    await wait(
      () => latest.state.modules.find((m) => m.id === module.id)?.progress >= 1,
      "foundry completion",
    );
    const work = game.getByRole("button", {
      name: "Work with Friend",
      exact: true,
    });
    await work.waitFor();
    const mine = await work.locator("svg path").getAttribute("d");
    assert.notEqual(
      hammer,
      mine,
      "construction and alloy work use different contextual icons",
    );
    const recruit = game.getByRole("button", { name: /Recruit miner/ });
    await recruit.waitFor();
    assert.equal(
      await recruit.locator("small").count(),
      0,
      "compact recruit button contains no clipped cost caption",
    );
    assert.match(
      await recruit.getAttribute("aria-label"),
      /6 alloy, 8 food/,
      "cost remains accessible",
    );
    await page.screenshot({ path: `artifacts/compact-hud-${width}.png` });
    report.checks.push({
      width,
      height,
      hint,
      abilities,
      consistentWorkerIcon: true,
      contextualWorkIcon: true,
      noClippedCostCaption: true,
    });
    if (width === 1440) {
      await game
        .getByRole("button", { name: "Close building details", exact: true })
        .click();
      for (const [w, h] of [
        [320, 568],
        [852, 393],
      ]) {
        await page.setViewportSize({ width: w, height: h });
        for (const dock of ["Left", "Right", "Bottom"]) {
          await game
            .getByRole("button", { name: "Game menu", exact: true })
            .click();
          await game
            .getByRole("combobox", { name: "Controls position", exact: true })
            .click();
          await game.getByRole("option", { name: dock, exact: true }).click();
          await game
            .getByRole("button", { name: "Close dialog", exact: true })
            .click();
          const hint = await game.locator(".map-coordinates").boundingBox(),
            bar = await game.locator(".ability-bar").boundingBox();
          assert.ok(
            !hint ||
              (hint.y >= 0 &&
                hint.y + hint.height <= h &&
                hint.x >= 0 &&
                hint.x + hint.width <= w),
            "camera hint fits resized viewport",
          );
          assert.ok(
            !hint ||
              hint.y + hint.height <= bar.y + 1 ||
              hint.x >= bar.x + bar.width ||
              hint.x + hint.width <= bar.x,
            "camera hint avoids abilities for every dock",
          );
          report.checks.push({
            width: w,
            height: h,
            dock,
            hintVisible: !!hint,
            hintNonOverlapping: true,
          });
        }
      }
    }
    await page.request.post(apiOrigin + "/api/leave", {
      headers: { Authorization: "Bearer " + token },
      data: { code: latest.code },
    });
    await ctx.close();
  }
  assert.deepEqual(report.errors, []);
  await writeFile(
    "artifacts/compact-hud.json",
    JSON.stringify(report, null, 2),
  );
  console.log("PASS compact HUD", JSON.stringify(report));
} finally {
  await browser.close();
}
