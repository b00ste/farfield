// Browser Testing only. Real commands/resources/time; wallet reads alone are fixtures.
import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { installFixture } from "./fixture.mjs";
import { observeRoom } from "./room-observer.mjs";
import { place } from "../server/arena.ts";
const origin = process.env.TEST_URL || "http://127.0.0.1:4180",
  apiOrigin = process.env.TEST_API_URL || origin,
  report = {
    origin,
    normalGameTime: true,
    checks: [],
    layouts: [],
    errors: [],
  };
const browser = await chromium.launch({
  channel: "chrome",
  args: ["--no-sandbox"],
});
let page, latest, token;
try {
  page = await browser.newPage({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    deviceScaleFactor: 1,
  });
  page.setDefaultTimeout(10000);
  await installFixture(page, origin);
  await observeRoom(page, (v) => {
    if (!latest || v.revision >= latest.revision) latest = v;
    if (v.token) token = v.token;
  });
  page.on("pageerror", (e) => report.errors.push(e.message));
  const wait = async (fn, label, seconds = 20) => {
    for (let i = 0; i < seconds * 10; i++) {
      if (await fn()) return;
      await page.waitForTimeout(100);
    }
    throw Error(label);
  };
  const tap = async (locator) => {
    await locator.waitFor();
    await wait(() => locator.isEnabled(), "button enabled");
    await locator.tap();
    await page.waitForTimeout(120);
  };
  await page.goto(origin);
  const runtime = await page
    .locator("script[src*='runtime.js']")
    .getAttribute("src");
  report.build = new URL(runtime, origin).searchParams.get("v");
  if (process.env.EXPECT_BUILD)
    assert.equal(report.build, process.env.EXPECT_BUILD);
  await tap(
    page.getByRole("button", { name: "Connect wallet", exact: true }).first(),
  );
  await tap(page.getByRole("button", { name: /Browser Wallet/ }));
  await tap(page.getByRole("button", { name: /Friends & AI/ }));
  await tap(page.getByRole("button", { name: "Enter sector →", exact: true }));
  const game = page.frameLocator("iframe");
  await tap(game.getByRole("button", { name: "Begin match →", exact: true }));
  await wait(() => latest?.state.phase === "playing", "game started");
  const command = async (c) => {
    const r = await page.request.post(apiOrigin + "/api/command", {
      headers: { Authorization: "Bearer " + token },
      data: { code: latest.code, command: c },
    });
    assert.ok(r.ok(), "command " + c.type);
  };
  for (const type of ["solar", "habitat"]) {
    const c = place(structuredClone(latest.state), type);
    assert.ok(c);
    await command(c);
    await wait(
      () =>
        latest.state.modules.some((m) => m.type === type && m.progress === 1),
      type + " complete",
    );
    await command({ type: "stop-friend" });
  }
  await wait(() => latest.state.friend.task === "idle", "Friend idle");
  const frame = await (
    await page.locator("iframe").elementHandle()
  ).contentFrame();
  await mkdir("artifacts", { recursive: true });
  for (const [width, height] of [
    [932, 430],
    [430, 932],
    [1024, 768],
  ]) {
    await page.setViewportSize({ width, height });
    await page.waitForTimeout(150);
    await tap(
      game.getByRole("button", {
        name: "Electricity balance and workers",
        exact: true,
      }),
    );
    await game.getByTestId("crew-power-balance").waitFor();
    assert.match(
      await game.getByTestId("crew-power-balance").innerText(),
      /0\.00\/s generated.*0\.13\/s buildings/s,
    );
    assert.equal(
      await game.getByTestId("energy-flow").getAttribute("data-negative"),
      "true",
    );
    const layout = await frame.evaluate(() => {
      const r = document
          .querySelector(".flight-resources")
          .getBoundingClientRect(),
        e = document.querySelector(".crew-manager");
      return {
        width: innerWidth,
        body: document.body.scrollWidth,
        hudRight: r.right,
        hudBottom: r.bottom,
        statusTop: document
          .querySelector(".sector-status")
          .getBoundingClientRect().top,
        crewWidth: e.clientWidth,
        crewScroll: e.scrollWidth,
      };
    });
    assert.ok(
      layout.body <= width &&
        layout.hudRight <= width &&
        layout.statusTop >= layout.hudBottom + 2 &&
        layout.crewScroll <= layout.crewWidth + 1,
      "energy HUD/crew fit " + width,
    );
    report.layouts.push({ width, height, ...layout });
    await page.screenshot({ path: `artifacts/power-hud-${width}.png` });
    await tap(
      game.getByRole("button", { name: "Close workers panel", exact: true }),
    );
    await tap(
      game.getByRole("button", { name: "Open build panel", exact: true }),
    );
    await tap(game.getByRole("button", { name: "O shape", exact: true }));
    assert.match(
      await game
        .getByRole("button", { name: "Build Foundry", exact: true })
        .innerText(),
      /14 alloy · 0\.12 ϟ\/s/,
    );
    const bounds = await game
      .locator(".build-palette")
      .evaluate((e) => ({ client: e.clientWidth, scroll: e.scrollWidth }));
    assert.ok(
      bounds.scroll <= bounds.client + 1,
      "building upkeep costs fit " + width,
    );
    await page.screenshot({ path: `artifacts/power-picker-${width}.png` });
    await tap(
      game.getByRole("button", { name: "Close build panel", exact: true }),
    );
  }
  report.checks.push(
    "Energy HUD gross/upkeep/net, Workers detail and building upkeep costs fit landscape, portrait and tablet",
  );
  await tap(game.getByRole("button", { name: "Shield ability", exact: true }));
  await wait(
    () => latest.state.abilities?.shieldReady > latest.state.time,
    "first Shield used",
  );
  await wait(
    () =>
      game
        .getByRole("button", { name: "Shield ability", exact: true })
        .isEnabled(),
    "second Shield ready",
    25,
  );
  await tap(game.getByRole("button", { name: "Shield ability", exact: true }));
  await wait(() => latest.state.energy < 5, "energy spent on two Shields");
  await wait(
    () => latest.state.energy === 0,
    "normal building upkeep reaches blackout",
    45,
  );
  await game.getByTestId("power-outage").waitFor();
  await tap(
    game.getByRole("button", {
      name: "Electricity balance and workers",
      exact: true,
    }),
  );
  assert.match(
    await game.getByTestId("crew-power-balance").innerText(),
    /Power off.*Reactor/s,
  );
  await tap(game.getByRole("button", { name: /Recruit worker/ }));
  await wait(
    () => latest.state.recruitQueue?.length === 1,
    "queue worker during blackout",
  );
  const queued = latest.state.recruitQueue[0],
    paidAlloy = latest.state.alloy,
    paidFood = latest.state.food;
  await page.waitForTimeout(3000);
  assert.equal(
    latest.state.recruitQueue[0].progress,
    queued.progress,
    "blackout pauses queue progress",
  );
  assert.equal(latest.state.crew, 0);
  assert.equal(latest.state.alloy, paidAlloy);
  assert.equal(latest.state.food, paidFood);
  report.checks.push(
    "Power-off warning appears; queued recruit pauses without another charge",
  );
  await page.screenshot({ path: "artifacts/power-blackout-tablet.png" });
  const reactor = latest.state.modules.find((m) => m.type === "solar");
  await command({
    type: "direct",
    x: reactor.cells[0].x,
    y: reactor.cells[0].y,
  });
  await wait(
    () =>
      latest.state.friend.task === "engineers" &&
      latest.state.friend.working &&
      latest.state.energy > 0,
    "Friend powers reactor despite blackout",
  );
  await wait(
    () =>
      latest.state.recruitQueue[0]?.progress > queued.progress ||
      latest.state.crew === 1,
    "queue resumes after power returns",
  );
  await wait(
    () => latest.state.crew === 1 && latest.state.recruitQueue.length === 0,
    "queued worker arrives",
    12,
  );
  assert.equal(latest.state.workers[0].id, queued.id);
  assert.equal(
    latest.state.alloy,
    paidAlloy,
    "restoring power does not charge recruit again",
  );
  await wait(
    async () =>
      (await game.getByTestId("energy-flow").getAttribute("data-negative")) ===
      "false",
    "positive energy HUD",
  );
  assert.equal(await game.getByTestId("power-outage").count(), 0);
  report.checks.push(
    "Manual Friend reactor work restores power, resumes same recruit and removes blackout warning",
  );
  report.final = {
    workers: latest.state.crew,
    energy: Math.round(latest.state.energy * 100) / 100,
  };
  await page.screenshot({ path: "artifacts/power-recovered-tablet.png" });
  assert.deepEqual(report.errors, []);
  console.log("PASS power", JSON.stringify(report));
} catch (e) {
  report.failure = { name: e.name, message: e.message };
  throw e;
} finally {
  if (page && latest && token)
    await page.request
      .post(apiOrigin + "/api/leave", {
        headers: { Authorization: "Bearer " + token },
        data: { code: latest.code },
      })
      .catch(() => {});
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/power-browser.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
