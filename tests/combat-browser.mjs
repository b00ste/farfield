// Browser Testing only: deterministic combat fixture, production Rooms command/tick logic.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { installFixture } from "./fixture.mjs";
import { battle } from "./combat-fixture.ts";
const origin = process.env.TEST_URL || "http://127.0.0.1:4173";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  for (const [width, height] of process.env.TOUCH_SIZE
    ? [process.env.TOUCH_SIZE.split("x").map(Number)]
    : [
        [1440, 900],
        [320, 568],
        [852, 393],
      ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: true,
      isMobile: width < 1000,
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await installFixture(page, origin);
    await page.route("https://pulse.walletconnect.org/**", (r) =>
      r.fulfill({ json: {} }),
    );
    const { rooms, room, a, p, turret } = battle();
    p.state.modules.push({
      id: 850,
      type: "foundry",
      owner: p.id,
      progress: 1,
      cells: [{ x: 0, y: 1 }],
    });
    let started = false;
    const timer = setInterval(() => {
      if (started) rooms.advance(0.1, 1000);
    }, 100);
    try {
      await page.route("**/api/create", (r) =>
        r.fulfill({
          json: { token: a.token, ...rooms.view(room, a.token, 1000) },
        }),
      );
      await page.route("**/api/sync", (r) =>
        r.fulfill({ json: rooms.view(room, a.token, 1000) }),
      );
      await page.route("**/api/command", (r) => {
        try {
          return r.fulfill({
            json: rooms.command(
              a.code,
              a.token,
              r.request().postDataJSON().command,
              1000,
            ),
          });
        } catch (e) {
          return r.fulfill({ status: 400, json: { error: e.message } });
        }
      });
      await page.goto(origin);
      await page
        .getByRole("button", { name: "Connect wallet", exact: true })
        .first()
        .tap();
      await page.getByRole("button", { name: /Browser Wallet/ }).tap();
      await page.getByRole("button", { name: /Friends & AI/ }).tap();
      await page
        .getByRole("button", { name: "Enter sector →", exact: true })
        .tap();
      const game = page.frameLocator("iframe"),
        canvas = game.locator("canvas");
      await canvas.waitFor();
      await game.getByRole("button", { name: "Game menu", exact: true }).tap();
      await game
        .getByRole("button", { name: "Follow your Friend", exact: true })
        .tap();
      for (const [group, mode] of [
        ["workers", "aggressive"],
        ["workers", "peaceful"],
        ["friend", "peaceful"],
        ["friend", "aggressive"],
      ]) {
        const toggle = game.locator(`[data-combat-group="${group}"]`);
        await toggle.tap();
        await page.waitForTimeout(150);
        assert.equal(p.state.combatModes[group], mode);
        assert.equal(
          await toggle.getAttribute("aria-pressed"),
          String(mode === "aggressive"),
        );
        assert.equal(
          (await toggle.innerText()).trim(),
          "",
          "combat toggles use icons only",
        );
      }
      if (width > 1000) {
        await canvas.focus();
        const shapes = ["I", "O", "T", "L", "J", "S", "Z"];
        for (let i = 0; i < shapes.length; i++) {
          await game
            .getByRole("button", { name: "Open build panel", exact: true })
            .click();
          await page.keyboard.press(String(i + 1));
          await page.keyboard.press("Backspace");
          assert.equal(
            await game
              .getByRole("button", { name: `${shapes[i]} shape`, exact: true })
              .getAttribute("aria-pressed"),
            "true",
          );
          await page.keyboard.press("Escape");
        }
        const buildings = [
          "Passage",
          "Reactor",
          "Garden",
          "Foundry",
          "Quarters",
          "Defense",
          "Research",
          "Infirmary",
        ];
        for (let i = 0; i < buildings.length; i++) {
          await page.keyboard.press("b");
          await page.keyboard.press(shapes[i % 7].toLowerCase());
          await page.keyboard.press(String(i + 1));
          assert.match(
            (await game
              .locator(".context-command")
              .getAttribute("aria-label")) || "",
            new RegExp(buildings[i]),
          );
          await page.keyboard.press("Escape");
        }
        await page.keyboard.press("b");
        await page.keyboard.press("3");
        await game
          .getByText("2 · Choose a building", { exact: true })
          .waitFor();
        await page.keyboard.press("4");
        await game.locator(".context-command").waitFor();
        assert.match(
          (await game.locator(".context-command").getAttribute("aria-label")) ||
            "",
          /Foundry/,
        );
        await page.keyboard.press("Escape");
        await game
          .getByRole("button", { name: "Open build panel", exact: true })
          .click();
        await page.keyboard.press("l");
        await game
          .getByText("2 · Choose a building", { exact: true })
          .waitFor();
        await page.keyboard.press("Escape");
        assert.equal(await game.locator(".command-drawer").count(), 0);
      }
      await game
        .getByRole("button", { name: "Manage crew", exact: true })
        .tap();
      await game.getByText("0 unassigned", { exact: true }).waitFor();
      assert.equal(
        await game
          .locator(".crew-recruit")
          .getByText(/workers/)
          .count(),
        0,
      );
      await game
        .getByRole("button", { name: "Close workers panel", exact: true })
        .tap();
      const cb = await canvas.boundingBox(),
        cz = width > 900 ? 1.5 : 1;
      await canvas.tap({
        position: {
          x: cb.width / 2 + 0.5 * 24 * cz,
          y: cb.height / 2 + 1.5 * 24 * cz,
        },
      });
      await game.locator(".context-command").waitFor();
      await page.waitForTimeout(200);
      const rail = await game.locator(".context-command").boundingBox();
      const buttons = await game.locator(".command-bar").boundingBox();
      assert.ok(
        rail.x >= buttons.x + buttons.width,
        "details sit to the right of buttons",
      );
      assert.ok(
        Math.abs(rail.height - buttons.height) <= 2,
        "same shallow height",
      );
      assert.ok(rail.y + rail.height <= height, "rail stays inside viewport");
      if (width > 1000)
        assert.equal(
          await game
            .locator(".context-command")
            .evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
          true,
          "desktop rail does not clip actions",
        );
      const workButton = await game
        .getByRole("button", { name: "Work with Friend", exact: true })
        .boundingBox();
      assert.ok(
        workButton.y >= rail.y &&
          workButton.y + workButton.height <= rail.y + rail.height,
        "actions fit vertically inside the rail",
      );
      const railShot = await (
        await context.newCDPSession(page)
      ).send("Page.captureScreenshot", { format: "png" });
      await writeFile(
        `artifacts/command-rail-${width}.png`,
        Buffer.from(railShot.data, "base64"),
      );
      const workToggle = game.getByRole("button", {
        name: "Work with Friend",
        exact: true,
      });
      assert.equal(await workToggle.getAttribute("aria-pressed"), "true");
      await workToggle.tap();
      await page.waitForTimeout(150);
      assert.equal(p.state.friend.order, "idle");
      assert.equal(await workToggle.getAttribute("aria-pressed"), "false");
      await workToggle.tap();
      await page.waitForTimeout(150);
      assert.equal(p.state.friend.order, "work");
      assert.equal(await workToggle.getAttribute("aria-pressed"), "true");
      await game
        .getByRole("button", { name: "Close building details", exact: true })
        .tap();
      const energy = p.state.energy;
      await game
        .getByRole("button", { name: "Shield ability", exact: true })
        .tap();
      await game
        .locator('[data-ability="shield"][data-active="true"]')
        .waitFor();
      assert.equal(p.state.energy, energy - 20);
      assert.equal(
        await game
          .getByRole("button", { name: "Shield ability", exact: true })
          .isDisabled(),
        true,
      );
      await game
        .getByRole("button", { name: "EMP ability", exact: true })
        .tap();
      await page.waitForTimeout(300);
      assert.equal(turret.disabledUntil, 6);
      const z = width > 900 ? 1.5 : 1,
        b = await canvas.boundingBox();
      // Touch an unoccupied turret tile, rather than the guard standing on top of it.
      await canvas.tap({
        position: {
          x: b.width / 2 + 4.5 * 24 * z,
          y: b.height / 2 + 1.5 * 24 * z,
        },
      });
      for (let i = 0; i < 100 && !p.state.friend.attack; i++)
        await page.waitForTimeout(20);
      assert.equal(p.state.friend.attack?.moduleId, turret.id);
      started = true;
      await page.waitForTimeout(1800);
      const cdp = await context.newCDPSession(page),
        shot = await cdp.send("Page.captureScreenshot", { format: "png" });
      await writeFile(
        `artifacts/combat-${width}.png`,
        Buffer.from(shot.data, "base64"),
      );
      for (let i = 0; i < 100 && !turret.wreck; i++)
        await page.waitForTimeout(100);
      assert.equal(turret.wreck, true);
      assert.ok(p.state.friend.hp > 0);
      assert.deepEqual(errors, []);
      console.log(
        `PASS combat ${width}x${height}: mode toggles, shallow side rail, touch abilities, cooldowns, target selection, shield/EMP siege and visible survival`,
      );
    } finally {
      clearInterval(timer);
      await context.close();
    }
  }
} finally {
  await browser.close();
}
