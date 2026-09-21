// Browser Testing only. Wallet reads are fixtures; game commands, resources and time are real.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { installFixture } from "./fixture.mjs";
import { observeRoom } from "./room-observer.mjs";
import { place } from "../server/arena.ts";
import { rates } from "../games/farfield/engine.ts";
const origin = process.env.TEST_URL || "http://127.0.0.1:4180",
  apiOrigin = new URL(process.env.TEST_API_URL || origin).origin;
const report = {
  origin,
  profile: "tablet1024x768",
  normalGameTime: true,
  checks: [],
  errors: [],
};
const browser = await chromium.launch({
  channel: "chrome",
  args: ["--no-sandbox"],
});
let page, latest, token;
try {
  const ctx = await browser.newContext({
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 1,
  });
  page = await ctx.newPage();
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
  const cdp = await ctx.newCDPSession(page);
  const tap = async (locator) => {
    await locator.waitFor();
    await wait(() => locator.isEnabled(), "button enabled");
    const b = await locator.boundingBox();
    assert.ok(b);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        {
          x: b.x + b.width / 2,
          y: b.y + b.height / 2,
          id: 0,
          radiusX: 2,
          radiusY: 2,
          force: 1,
        },
      ],
    });
    await page.waitForTimeout(70);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await page.waitForTimeout(350);
  };
  await page.goto(origin);
  await tap(
    page.getByRole("button", { name: "Connect wallet", exact: true }).first(),
  );
  await tap(page.getByRole("button", { name: /Browser Wallet/ }));
  await tap(page.getByRole("button", { name: /Friends & AI/ }));
  await tap(page.getByRole("button", { name: "Enter sector →", exact: true }));
  let game = page.frameLocator("iframe");
  await tap(game.getByRole("button", { name: "Begin match →", exact: true }));
  await wait(() => latest?.state.phase === "playing", "match playing");
  const command = async (cmd) => {
    const r = await page.request.post(apiOrigin + "/api/command", {
      headers: { Authorization: "Bearer " + token },
      data: { code: latest.code, command: cmd },
    });
    assert.ok(r.ok(), "real command " + cmd.type);
    const j = await r.json();
    assert.ok(!j.error, j.error);
  };
  for (const type of ["garden", "habitat"]) {
    const cmd = place(structuredClone(latest.state), type);
    assert.ok(cmd);
    await command(cmd);
    await wait(
      () => latest.state.modules.some((m) => m.type === type),
      type + " blueprint",
    );
    const m = latest.state.modules.find((m) => m.type === type);
    await command({ type: "direct", x: m.cells[0].x, y: m.cells[0].y });
    await wait(
      () => latest.state.modules.find((n) => n.id === m.id)?.progress === 1,
      type + " complete",
    );
    await command({ type: "stop-friend" });
  }
  assert.equal(latest.state.crew, 0);
  await tap(
    game.getByRole("button", { name: "Food balance and workers", exact: true }),
  );
  await game.getByTestId("crew-food-balance").waitFor();
  const recruit = () => game.getByRole("button", { name: /Recruit worker/ });
  const startFood = latest.state.food;
  for (let i = 1; i <= 5; i++) {
    await tap(recruit());
    await wait(
      () => latest.state.recruitQueue.length === i,
      "queue recruit " + i,
    );
  }
  assert.equal(latest.state.crew, 0, "recruitment is delayed, not instant");
  assert.ok(
    Math.abs(latest.state.food - (startFood - 40)) < 0.01,
    "food charged once upfront",
  );
  assert.equal(
    await game.getByTestId("recruit-queue").locator("progress").count(),
    5,
  );
  assert.ok(await recruit().isDisabled(), "queue cap disables recruit");
  report.checks.push(
    "Five queued recruits reserve costs and show individual progress before first arrival",
  );
  await command({ type: "pause" });
  await wait(() => latest.state.paused, "paused for layout inspection");
  await page.setViewportSize({ width: 320, height: 568 });
  await page.waitForTimeout(300);
  const frame = await (
    await page.locator("iframe").elementHandle()
  ).contentFrame();
  const layout = await frame.evaluate(() => ({
    width: innerWidth,
    body: document.body.scrollWidth,
    statusTop: document.querySelector(".sector-status").getBoundingClientRect()
      .top,
    hudBottom: document
      .querySelector(".flight-resources")
      .getBoundingClientRect().bottom,
    hud: (() => {
      const r = document
        .querySelector(".flight-resources")
        .getBoundingClientRect();
      return { x: r.x, right: r.right, width: r.width };
    })(),
    crew: (() => {
      const e = document.querySelector(".crew-manager");
      return { client: e.clientWidth, scroll: e.scrollWidth };
    })(),
  }));
  assert.ok(
    layout.body <= 320 && layout.hud.x >= 0 && layout.hud.right <= 320,
    "320px food/queue HUD fits viewport",
  );
  assert.ok(
    layout.statusTop >= layout.hudBottom + 2,
    "status line clears resource bar",
  );
  assert.ok(
    layout.crew.scroll <= layout.crew.client + 1,
    "queue drawer has no horizontal overflow",
  );
  assert.match(await game.locator(".flight-resources").innerText(), /\+5/);
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/economy-phone320-queue.png" });
  report.phone320 = layout;
  report.checks.push(
    "320px HUD and five-item queue fit without horizontal overflow (match paused for inspection)",
  );
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.waitForTimeout(300);
  await command({ type: "pause" });
  await wait(() => !latest.state.paused, "resumed after layout inspection");
  const cancelId = latest.state.recruitQueue.at(-1).id,
    beforeCancelFood = latest.state.food;
  await tap(
    game.getByRole("button", {
      name: "Cancel recruit " + cancelId,
      exact: true,
    }),
  );
  await wait(
    () => latest.state.recruitQueue.length === 4,
    "cancel removes order",
  );
  assert.ok(
    latest.state.food >= beforeCancelFood + 7.8,
    "cancel refunds8 food",
  );
  assert.ok(!(await recruit().isDisabled()), "cancel releases queue slot");
  await tap(recruit());
  await wait(() => latest.state.recruitQueue.length === 5, "requeue");
  report.checks.push("Cancel refunds reserved food and permits requeue");
  const savedSelf = latest.selfId,
    queuedIds = latest.state.recruitQueue.map((q) => q.id),
    beforeReloadCrew = latest.state.crew;
  await page.reload();
  await page.waitForTimeout(2000);
  const reconnect = page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first();
  if (await reconnect.isVisible()) {
    await tap(reconnect);
    await tap(page.getByRole("button", { name: /Browser Wallet/ }));
  }
  game = page.frameLocator("iframe");
  await game
    .getByRole("button", { name: "Food balance and workers", exact: true })
    .waitFor();
  await wait(
    () =>
      latest.selfId === savedSelf &&
      latest.state.crew + latest.state.recruitQueue.length === 5,
    "same session queue restored",
  );
  assert.ok(latest.state.crew >= beforeReloadCrew);
  assert.ok(latest.state.recruitQueue.every((q) => queuedIds.includes(q.id)));
  report.checks.push(
    "Reload preserves original queue and same commander without duplicate recruits",
  );
  await wait(
    () => latest.state.crew === 5 && latest.state.recruitQueue.length === 0,
    "all five arrive serially",
    40,
  );
  assert.equal(latest.state.food, 0);
  await wait(
    () => latest.state.foodShortage > 0.2,
    "shortage ramps gradually",
    15,
  );
  await game.getByTestId("food-shortage").waitFor();
  const shortage = latest.state.foodShortage;
  assert.ok(shortage > 0 && shortage <= 1);
  assert.equal(
    await game.getByTestId("food-flow").getAttribute("data-negative"),
    "true",
  );
  await tap(
    game.getByRole("button", { name: "Food balance and workers", exact: true }),
  );
  const balance = await game.getByTestId("crew-food-balance").innerText();
  assert.match(balance, /0\.65\/s upkeep/);
  assert.match(await game.locator(".drawer-heading").innerText(), /5\/6/);
  report.checks.push(
    "Five workers consume0.65 food/s; zero-food shortage ramps and HUD reports reduced effectiveness",
  );
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/economy-tablet-shortage.png" });
  const garden = latest.state.modules.find((m) => m.type === "garden");
  await command({ type: "direct", x: garden.cells[0].x, y: garden.cells[0].y });
  await wait(
    () =>
      latest.state.friend.working &&
      latest.state.friend.task === "farmers" &&
      latest.state.food > 0,
    "Friend farms despite shortage",
  );
  await wait(
    () => latest.state.foodShortage < shortage - 0.05,
    "shortage eases with restored food",
    15,
  );
  assert.ok(
    rates(latest.state).food > 0.9,
    "Friend farming outproduces worker upkeep",
  );
  await wait(
    async () =>
      (await game.getByTestId("food-flow").getAttribute("data-negative")) ===
      "false",
    "food HUD turns positive",
  );
  report.checks.push(
    "Friend farming remains productive during shortage; food and effectiveness recover",
  );
  await page.screenshot({ path: "artifacts/economy-tablet-recovery.png" });
  report.final = {
    workers: latest.state.crew,
    food: Math.round(latest.state.food * 100) / 100,
    netFood: rates(latest.state).food,
    shortage: latest.state.foodShortage,
  };
  assert.deepEqual(report.errors, []);
  console.log("PASS economy", JSON.stringify(report));
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
    "artifacts/economy-tablet.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
