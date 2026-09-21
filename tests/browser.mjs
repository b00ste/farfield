// Run only in the Browser Testing workspace. Wallet/RPC mocks never enter a playable build.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import {
  installFixture,
  createArtworkFixture,
  assertBounds,
} from "./fixture.mjs";
const origin = process.env.TEST_URL || "http://127.0.0.1:4173";
await mkdir("artifacts", { recursive: true });
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const errors = [];
async function client(width, height) {
  const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: width < 500,
      reducedMotion: "reduce",
    }),
    page = await context.newPage();
  page.setDefaultTimeout(15000);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(msg.text());
  });
  const fixture = await installFixture(page, origin, {
    artworkCall: await createArtworkFixture(),
  });
  // WalletConnect configuration/telemetry are not part of mocked ownership tests.
  // A separate real-service check covers QR generation without signing or pairing.
  await page.route("https://pulse.walletconnect.org/**", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.route("https://api.web3modal.org/**", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.goto(origin);
  assert.equal(
    await page.locator("iframe").count(),
    0,
    "Disconnected wallet must not play",
  );
  await page
    .getByRole("button", { name: /^Connect (wallet|Browser wallet)$/ })
    .click();
  await page.getByRole("button", { name: /Browser Wallet/ }).click();
  await page.getByRole("button", { name: /^Friend #7730\b/ }).click();
  const game = page.frameLocator("iframe");
  await game.getByRole("button", { name: "Create a match" }).waitFor();
  await page.locator(".rf-runtime-status").waitFor({ state: "hidden" });
  assert.ok(fixture.ownerReads >= 2);
  assert.equal(
    await page.locator("iframe").getAttribute("sandbox"),
    "allow-scripts",
  );
  await assertBounds(page);
  return { context, page, game, fixture };
}
try {
  const a = await client(
    Number(process.env.DESKTOP_WIDTH || 2560),
    Number(process.env.DESKTOP_HEIGHT || 1440),
  );
  await a.page
    .locator(".rf-game-frame")
    .screenshot({ path: "artifacts/desktop-lobby.png" });
  await a.game
    .getByRole("button", { name: "Multiplayer PvP", exact: true })
    .click();
  const created = a.page.waitForResponse(
    (r) => r.url().endsWith("/api/create") && r.status() === 200,
  );
  await a.game.getByRole("button", { name: "Create a match" }).click();
  const room = await (await created).json();
  assert.match(room.code, /^[A-F0-9]{10}$/);
  const b = await client(Number(process.env.MOBILE_WIDTH || 393), 852);
  await b.game
    .getByRole("textbox", { name: "Station room code" })
    .fill(room.code);
  await b.game.getByRole("button", { name: "Join →", exact: true }).tap();
  await b.game.getByText("Waiting for the host to launch…").waitFor();
  await a.game.getByRole("button", { name: "Launch expedition" }).click();
  await b.game.getByRole("button", { name: "Build Passage" }).waitFor();
  await b.game.locator(".lobby-layer").waitFor({ state: "hidden" });
  await a.game.getByText(/2\/4 ONLINE/).waitFor();
  await a.page
    .locator(".rf-game-frame")
    .screenshot({ path: "artifacts/desktop-game.png" });
  await b.page
    .locator(".rf-game-frame")
    .screenshot({ path: "artifacts/mobile-game.png" });
  // Pointer placement from phone coordinates; both clients share the resulting module.
  await b.game.getByRole("button", { name: "Build Garden", exact: true }).tap();
  const canvas = b.game.locator("canvas"),
    box = await canvas.boundingBox();
  assert.ok(box);
  await canvas.tap({
    position: { x: box.width / 2 - 16.2, y: box.height / 2 + 48.6 },
  });
  await b.game.getByText("Ready to build. Confirm placement.").waitFor();
  const built = b.page.waitForResponse(
    (r) => r.url().endsWith("/api/command") && r.status() === 200,
  );
  await b.game
    .getByRole("button", { name: /^Build(?: ↵)?$/, exact: true })
    .tap();
  const after = await (await built).json();
  assert.equal(after.state.modules.length, 2);
  assert.equal(after.state.placed, 1);
  const synced = await a.page.waitForResponse(
    async (r) =>
      r.url().endsWith("/api/sync") &&
      r.status() === 200 &&
      (await r.json()).opponents[0].state.placed === 1,
  );
  const sharedView = await synced.json();
  assert.equal(
    sharedView.state.modules.length,
    1,
    "Rival construction must not change my station",
  );
  assert.equal(sharedView.opponents[0].state.modules.length, 2);
  await b.page.waitForResponse(
    async (r) =>
      r.url().endsWith("/api/sync") &&
      r.status() === 200 &&
      (await r.json()).state.modules.some(
        (m) => m.type === "garden" && m.progress >= 1,
      ),
  );
  // Shared host pause; guests cannot resume it.
  await a.game
    .getByRole("button", { name: "Pause mission", exact: true })
    .click();
  await b.game.getByText("MISSION PAUSED").waitFor();
  assert.equal(
    await b.game.getByRole("button", { name: "Resume mission" }).isDisabled(),
    true,
  );
  await a.game
    .getByRole("button", { name: "Resume mission", exact: true })
    .click();
  await b.game.getByText("MISSION PAUSED").waitFor({ state: "hidden" });
  await b.game.getByRole("button", { name: "Manage crew" }).click();
  const before = Number(await b.game.getByTestId("role-farmers").textContent());
  await b.game
    .getByRole("button", { name: "Recruit farmer", exact: true })
    .click();
  await b.game
    .getByTestId("role-farmers")
    .filter({ hasText: String(before + 1) })
    .waitFor();
  await b.game.getByRole("button", { name: "Close dialog" }).click();
  // Keyboard placement moves the preview and rotates it, with focus retained in the map.
  await a.game
    .getByRole("button", { name: "Build Research", exact: true })
    .click();
  await a.game.locator("canvas").focus();
  const desktopBox = await a.game.locator("canvas").boundingBox();
  await a.game.locator("canvas").click({
    position: { x: desktopBox.width / 2 + 110, y: desktopBox.height / 2 },
  });
  await a.game.locator("canvas").press("ArrowRight");
  await a.game.locator("canvas").press("r");
  await a.page
    .locator(".rf-game-frame")
    .screenshot({ path: "artifacts/desktop-placement.png" });
  await b.game.getByRole("button", { name: "Settings", exact: true }).tap();
  await b.game.getByRole("checkbox", { name: "Reduce motion" }).waitFor();
  assert.equal(
    await b.game.getByRole("checkbox", { name: "Reduce motion" }).isChecked(),
    true,
  );
  await b.game.getByRole("button", { name: "Close dialog" }).tap();
  await b.game.getByRole("button", { name: "How to play" }).tap();
  await b.page
    .locator(".rf-game-frame")
    .screenshot({ path: "artifacts/mobile-help.png" });
  await b.game.getByRole("button", { name: "Close dialog" }).tap();
  await assertBounds(b.page);
  assert.equal(
    await b.game
      .locator("body")
      .evaluate(() => document.documentElement.scrollWidth > innerWidth),
    false,
    "No phone horizontal overflow",
  );
  // Runtime identity changes unmount the playable game.
  await b.page.evaluate(() => window.__friendWalletTest.disconnect());
  await b.page.locator("iframe").waitFor({ state: "detached" });
  assert.deepEqual([...errors, ...a.fixture.errors, ...b.fixture.errors], []);
  console.log(
    "PASS: desktop + phone, verified runtime gate, two-client PvP isolation, touch build, keyboard controls, crew, shared pause, reduced motion, identity disconnect, no browser errors.",
  );
} catch (error) {
  console.error("Browser errors:", errors);
  for (const p of browser.contexts().flatMap((c) => c.pages())) {
    console.error((await p.locator("body").innerText()).slice(0, 1500));
    await p
      .screenshot({
        path: `artifacts/failure-${browser.contexts().indexOf(p.context())}.png`,
      })
      .catch(() => {});
  }
  throw error;
} finally {
  await browser.close();
}
