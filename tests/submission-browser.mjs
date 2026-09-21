// Browser Testing: logical viewport, actual UI placement/dismantling, reload recovery.
import { chromium } from "playwright";
import { installFixture } from "./fixture.mjs";
import { observeRoom } from "./room-observer.mjs";
import { placementError } from "../games/farfield/engine.ts";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const origin =
  process.env.TEST_URL || "https://4173--main--ai-dev-01--daniel.kethalia.com";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
  }),
  page = await context.newPage();
await installFixture(page, origin);
let latest, token;
await observeRoom(page, (view) => {
  if (!latest || view.revision >= latest.revision) latest = view;
  if (view.token) token = view.token;
});
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", async (r) => {
  if (/\/api\/(sync|create|command)$/.test(r.url()) && r.ok()) {
    const v = await r.json().catch(() => null);
    if (v?.state) {
      latest = v;
      if (v.token) token = v.token;
    }
  }
});
const wait = async (fn, why) => {
  for (let i = 0; i < 300; i++) {
    if (await fn()) return;
    await page.waitForTimeout(100);
  }
  throw Error(why);
};
const game = page.frameLocator("iframe");
async function clickGame(button) {
  await button.waitFor();
  const b = await button.evaluate((e) => {
    const b = e.getBoundingClientRect();
    return { x: b.x, y: b.y, width: b.width, height: b.height };
  });
  const f = await page.locator("iframe").boundingBox();
  await page.mouse.click(
    f.x + ((b.x + b.width / 2) * f.width) / 960,
    f.y + ((b.y + b.height / 2) * f.height) / 640,
  );
}

try {
  await page.goto(origin + "/?submission=1");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: /Browser Wallet/ }).click();
  await page.getByRole("button", { name: /Friends & AI/ }).click();
  await page
    .getByRole("button", { name: "Enter sector →", exact: true })
    .click();
  await clickGame(
    game.getByRole("button", { name: "Begin match →", exact: true }),
  );
  await wait(() => latest?.state.phase === "playing", "match begins");
  const frame = await (
    await page.locator("iframe").elementHandle()
  ).contentFrame();
  assert.deepEqual(
    await frame.evaluate(() => [innerWidth, innerHeight]),
    [960, 640],
  );
  const code = latest.code,
    seat = latest.selfId;
  // B -> O -> Passage -> one real mouse click on the scaled canvas.
  await frame.locator("canvas").focus();
  await page.keyboard.press("b");
  await page.keyboard.press("2");
  await page.keyboard.press("1");
  const s = latest.state,
    spawn = s.spawn;
  let point;
  for (let dx = -3; dx < 4; dx++)
    for (let dy = -3; dy < 4; dy++)
      if (
        !point &&
        !placementError(s, "passage", 1, 0, spawn.x + dx, spawn.y + dy)
      )
        point = { x: spawn.x + dx, y: spawn.y + dy };
  assert.ok(point);
  const box = await page.locator("iframe").boundingBox(),
    scale = box.width / 960;
  const zoom =
    Number(
      (await game.locator(".map-controls span").innerText()).replace("%", ""),
    ) / 100;
  const client = {
    x: box.x + (480 + (point.x - spawn.x + 0.5) * 24 * zoom) * scale,
    y: box.y + (320 + (point.y - spawn.y + 0.5) * 24 * zoom) * scale,
  };
  await page.mouse.click(client.x, client.y);
  await wait(
    () => latest.state.modules.length === 2,
    "single-click scaled placement",
  );
  const m = latest.state.modules.at(-1);
  await page.keyboard.press("Escape");
  await wait(
    () => latest.state.modules.find((n) => n.id === m.id)?.progress >= 1,
    "construction completes",
  );
  // Move back onto core, then inspect the completed edge while the Friend is far enough to dismantle safely.
  await page.request.post(origin + "/api/command", {
    headers: { Authorization: "Bearer " + token },
    data: { code, command: { type: "direct", ...spawn, task: "move" } },
  });
  await wait(
    () =>
      Math.hypot(
        latest.state.friend.x - spawn.x,
        latest.state.friend.y - spawn.y,
      ) < 0.01,
    "Friend at core",
  );
  await page.mouse.click(client.x, client.y);
  const result = page.waitForResponse(
    (r) =>
      r.url().endsWith("/api/command") &&
      r.request().postDataJSON().command.type === "demolish",
  );
  await clickGame(game.getByRole("button", { name: /Dismantle/ }));
  const response = await (await result).json();
  assert.ok(!response.error, JSON.stringify(response));
  await wait(
    () => !latest.state.modules.some((n) => n.id === m.id),
    "floor removed after clearing units",
  );
  latest = null;
  await page.reload();
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: /Browser Wallet/ }).click();
  await wait(() => page.locator("iframe").count(), "restored iframe");
  await wait(
    () => latest?.selfId === seat && latest.code === code,
    "restored same seat",
  );
  await game.locator(".sector-status").waitFor();
  assert.equal(await page.locator(".game-landing").count(), 0);
  const cdp = await context.newCDPSession(page);
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    "artifacts/submission-1920.png",
    Buffer.from(shot.data, "base64"),
  );
  await page.setViewportSize({ width: 852, height: 393 });
  await page.waitForTimeout(400);
  assert.deepEqual(
    await (
      await (await page.locator("iframe").elementHandle()).contentFrame()
    ).evaluate(() => [innerWidth, innerHeight]),
    [960, 640],
  );
  // Revoke this real seat server-side, then verify recovery from the resulting expiry.
  await page.request.post(origin + "/api/leave", {
    headers: { Authorization: "Bearer " + token },
    data: { code },
  });
  await game
    .getByText(
      "This match expired or the server restarted. Return to the main menu to start again.",
    )
    .waitFor();
  await clickGame(game.getByRole("button", { name: "Main menu", exact: true }));
  await page.getByRole("button", { name: /Friends & AI/ }).waitFor();
  assert.equal(
    await page.evaluate(() => sessionStorage.getItem("farfield-active-seat")),
    null,
  );
  token = null;
  assert.deepEqual(errors, []);
  console.log(
    "PASS: 960x640 submission viewport at two sizes, scaled click placement, real floor removal, reload seat recovery, expired-seat exit",
  );
} catch (e) {
  const cdp = await context.newCDPSession(page);
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  await writeFile(
    "artifacts/submission-failure.png",
    Buffer.from(shot.data, "base64"),
  );
  throw e;
} finally {
  if (token)
    await page.request.post(origin + "/api/leave", {
      headers: { Authorization: "Bearer " + token },
      data: { code: latest.code },
    });
  await browser.close();
}
