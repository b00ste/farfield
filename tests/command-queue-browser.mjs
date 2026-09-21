// Browser Testing only: exercise real UI commands under delayed network delivery.
import { chromium } from "playwright";
import { installFixture } from "./fixture.mjs";
import { observeRoom } from "./room-observer.mjs";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const origin =
  process.env.TEST_URL || "https://4173--main--ai-dev-01--daniel.kethalia.com";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await context.newPage();
await installFixture(page, origin);
const game = page.frameLocator("iframe");
let latest,
  token,
  delayed = false,
  requests = [],
  streamRequests = 0,
  stateMessages = 0;
const errors = [],
  observations = [];
await observeRoom(page, (view) => {
  stateMessages++;
  if (!latest || view.revision >= latest.revision) latest = view;
  if (view.token) token = view.token;
});
page.on("request", (request) => {
  if (new URL(request.url()).pathname === "/api/events") streamRequests++;
});
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", async (r) => {
  if (/\/api\/(sync|create|command)$/.test(r.url()) && r.ok()) {
    const v = await r.json().catch(() => null);
    if (v?.state && (!latest || v.revision >= latest.revision)) latest = v;
    if (v?.token) token = v.token;
  }
});
const wait = async (fn, why) => {
  for (let n = 0; n < 150; n++) {
    if (await fn()) return;
    await page.waitForTimeout(100);
  }
  throw Error(why);
};
await mkdir("artifacts", { recursive: true });
try {
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
  await game
    .getByRole("button", { name: "Begin match →", exact: true })
    .click();
  await wait(() => latest?.state.phase === "playing", "playing");
  const canvas = game.locator("canvas"),
    box = await canvas.boundingBox();
  await game
    .getByRole("button", { name: "Center station", exact: true })
    .click();
  const z =
    Number(
      (await game.locator(".map-controls span").innerText()).replace("%", ""),
    ) / 100;
  const spawn = latest.state.spawn;
  const pt = (x, y) => ({
    x: box.width / 2 + (x - spawn.x + 0.5) * 24 * z,
    y: box.height / 2 + (y - spawn.y + 0.5) * 24 * z,
  });
  await canvas.click({ position: pt(spawn.x + 6, spawn.y + 6) });
  await game.getByRole("alert").waitFor();
  observations.push({
    name: "invalid path",
    feedback: await game.getByRole("alert").allTextContents(),
  });
  await canvas.focus();
  await page.keyboard.press("b");
  await game.getByRole("button", { name: "O shape", exact: true }).waitFor();
  await page.keyboard.press("2");
  await game
    .getByRole("button", { name: "Build Foundry", exact: true })
    .waitFor();
  await page.keyboard.press("Backspace");
  await game.getByRole("button", { name: "O shape", exact: true }).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(
    await game.getByRole("button", { name: "O shape", exact: true }).count(),
    0,
  );
  observations.push({
    name: "keyboard",
    passed: "B opens, 2 selects O, Backspace returns to shapes, Escape closes",
  });
  await page.route("**/api/command", async (route) => {
    requests.push({
      command: route.request().postDataJSON().command,
      at: Date.now(),
    });
    if (!delayed) {
      delayed = true;
      await new Promise((r) => setTimeout(r, 1800));
    }
    await route.continue();
  });
  await canvas.click({ position: pt(spawn.x, spawn.y) });
  await canvas.click({ position: pt(spawn.x + 1, spawn.y) });
  await canvas.click({ position: pt(spawn.x + 1, spawn.y + 1) });
  await page.keyboard.press("Escape");
  await game.getByRole("button", { name: "Game menu", exact: true }).click();
  const menuOpened = Date.now();
  await page.waitForTimeout(3500);
  const queuedAfterMenu = requests.filter((r) => r.at > menuOpened).length;
  observations.push({
    name: "queued commands after Escape and menu",
    menuOpened,
    requests,
    queuedAfterMenu,
    friend: latest.state.friend,
  });
  await page.screenshot({ path: "artifacts/command-queue-menu.png" });
  if (process.env.ASSERT_QUEUE_FIX === "1") {
    assert.equal(queuedAfterMenu, 0, "Escape must clear unsent queued actions");
    await game
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
    await wait(() => !latest.state.paused, "match active after menu");
    requests = [];
    delayed = false;
    const cells = latest.state.modules.find((m) => m.type === "core").cells;
    for (const cell of cells.slice(0, 3))
      await canvas.click({ position: pt(cell.x, cell.y) });
    await page.waitForTimeout(3000);
    assert.equal(
      requests.length,
      2,
      "rapid Friend commands send only in-flight and latest orders",
    );
    assert.equal(requests.at(-1).command.x, cells[2].x);
    assert.equal(requests.at(-1).command.y, cells[2].y);
    await game.getByTestId("friend-order").waitFor();
    observations.push({
      name: "latest order wins",
      requests,
      status: await game.getByTestId("friend-order").innerText(),
    });
    await context.setOffline(true);
    await game
      .getByText("Reconnecting… Commands are paused.", { exact: true })
      .waitFor();
    const offlineCount = requests.length;
    await canvas.click({ position: pt(cells[0].x, cells[0].y) });
    assert.equal(
      requests.length,
      offlineCount,
      "offline clicks are not queued for later replay",
    );
    await context.setOffline(false);
    await game
      .getByText("Reconnecting… Commands are paused.", { exact: true })
      .waitFor({ state: "hidden" });
    await page.waitForTimeout(500);
    assert.equal(
      requests.length,
      offlineCount,
      "reconnect does not replay offline clicks",
    );
    observations.push({ name: "disconnect/reconnect", passed: true });
    if (process.env.ASSERT_PAGE_RESTORE === "1") {
      const before = streamRequests,
        messagesBefore = stateMessages,
        seat = latest.selfId;
      const frame = await (
        await page.locator("iframe").elementHandle()
      ).contentFrame();
      await frame.evaluate(() =>
        window.dispatchEvent(
          new PageTransitionEvent("pageshow", { persisted: true }),
        ),
      );
      await wait(
        () => streamRequests > before && stateMessages > messagesBefore,
        "restored page reconnects and receives live state",
      );
      await page.waitForTimeout(800);
      assert.equal(
        streamRequests,
        before + 1,
        "persisted pageshow opens one replacement stream",
      );
      assert.equal(
        latest.selfId,
        seat,
        "persisted pageshow keeps same player seat",
      );
      observations.push({
        name: "synthetic persisted pageshow",
        replacementStreams: streamRequests - before,
        sameSeat: true,
      });
    }
    await page.screenshot({ path: "artifacts/command-feedback.png" });
  }
  await writeFile(
    "artifacts/command-queue.json",
    JSON.stringify({ observations, errors }, null, 2),
  );
  console.log(JSON.stringify({ observations, errors }, null, 2));
  assert.deepEqual(errors, []);
} finally {
  if (token && latest)
    await page.request.post(origin + "/api/leave", {
      headers: { Authorization: "Bearer " + token },
      data: { code: latest.code },
    });
  await browser.close();
}
