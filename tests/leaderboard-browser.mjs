// Browser Testing only: explicit wallet/NFT and standings fixtures. No matches,
// signatures or real rank records are created by this UI regression.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { installFixture } from "./fixture.mjs";
import { mkdir, writeFile } from "node:fs/promises";
const origin = process.env.TEST_URL || "http://127.0.0.1:4180";
const divisions = ["Diamond", "Platinum", "Gold", "Silver", "Bronze"];
const positions = [5, 12, 27, 45, 80];
const entries = divisions.map((division, i) => ({
  season: "Preseason", rating: 2000 - i * 300, deviation: 100,
  provisional: false, division, label: division,
  placements: { completed: 5, required: 5 }, matches: 9,
  wins: 6, losses: 2, draws: 1, friendId: String(7730 + i),
  name: `Friend #${7730 + i}`, position: positions[i],
}));
const report = { fixture: "Wallet reads and leaderboard records mocked", filters: [], screens: [], errors: [] };
const browser = await chromium.launch({ channel: "chrome", args: ["--no-sandbox"] });
await mkdir("artifacts", { recursive: true });
let release;
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
async function bounds(page, root, name) {
  const value = await root.evaluate(node => {
    const boxes = [...node.querySelectorAll("button")].filter(b => b.getClientRects().length).map(b => {
      const r = b.getBoundingClientRect();
      return { label: b.textContent, x: r.x, y: r.y, right: r.right, bottom: r.bottom, height: r.height };
    });
    return { width: innerWidth, height: innerHeight, horizontal: document.documentElement.scrollWidth > innerWidth + 1, vertical: document.documentElement.scrollHeight > innerHeight + 1, boxes };
  });
  assert.equal(value.horizontal, false, `${name}: horizontal body overflow`);
  assert.equal(value.vertical, false, `${name}: vertical body overflow`);
  assert.ok(value.boxes.every(r => r.x >= 0 && r.y >= 0 && r.right <= value.width + 1 && r.bottom <= value.height + 1), `${name}: controls outside viewport`);
  report.screens.push({ name, ...value });
}
async function setup(viewport, enabled = true) {
  const context = await browser.newContext({ viewport, hasTouch: viewport.width < 1100 });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on("pageerror", error => report.errors.push(error.message.replace(/https?:\/\/\S+/g,"[url]")));
  await installFixture(page, origin);
  await page.route("**/api/ranked/config", route => route.fulfill({ json: { enabled, season: "Preseason" } }));
  return { context, page };
}
async function connect(page) {
  await page.getByRole("button", { name: "Connect wallet", exact: true }).first().click();
  await page.getByRole("button", { name: /Browser Wallet/ }).click();
  await page.getByRole("button", { name: /Change commander/ }).waitFor();
}
try {
  const { context, page } = await setup({ width: 1440, height: 900 });
  let mode = "loading";
  const hold = new Promise(resolve => { release = resolve; });
  await page.route("**/api/ranked/leaderboard", async route => {
    const body = route.request().postDataJSON();
    const division = body.division || "All";
    report.filters.push(division);
    if (mode === "loading") await hold;
    if (mode === "error") return route.fulfill({ status: 503, json: { error: "Fixture unavailable" } });
    return route.fulfill({ json: { season: "Preseason", entries: mode === "empty" ? [] : division === "All" ? entries : entries.filter(entry => entry.division === division) } });
  });
  await page.goto(origin);
  const main = page.getByRole("navigation", { name: "Main menu" });
  await main.getByRole("button", { name: /^Leaderboard\b/ }).waitFor();
  await bounds(page, main, "desktop-disconnected-title");
  await page.screenshot({ path: "artifacts/leaderboard-title-desktop-disconnected.png" });
  await main.getByRole("button", { name: /^Leaderboard\b/ }).click();
  const board = page.getByRole("region", { name: "Ranked leaderboard" });
  await board.getByRole("status").filter({ hasText: /Loading/ }).waitFor();
  await page.screenshot({ path: "artifacts/leaderboard-loading.png" });
  mode = "normal"; release();
  await board.getByRole("cell", { name: "Friend #7730", exact: true }).waitFor();
  assert.equal(await board.locator("tbody tr").count(), 5);
  await page.screenshot({ path: "artifacts/leaderboard-desktop.png" });
  for (const division of ["Bronze", "Silver", "Gold", "Platinum", "Diamond"]) {
    await board.getByRole("combobox").click();
    await page.getByRole("option", { name: division, exact: true }).click();
    const entry = entries.find(entry => entry.division === division);
    await board.getByRole("cell", { name: entry.name, exact: true }).waitFor();
    assert.equal(await board.locator("tbody tr").count(), 1);
    assert.equal(await board.locator("tbody tr td").first().innerText(), String(entry.position));
    assert.equal(report.filters.at(-1), division);
  }
  // Each rank has its own query cache; a return to All restores the complete set.
  await board.getByRole("combobox").click();
  await page.getByRole("option", { name: /^All\b/ }).click();
  await board.getByRole("cell", { name: "Friend #7734", exact: true }).waitFor();
  assert.equal(await board.locator("tbody tr").count(), 5);
  await board.getByRole("button", { name: "Back to main menu", exact: true }).click();
  await main.waitFor();
  await connect(page);
  await bounds(page, main, "desktop-connected-title");
  await page.screenshot({ path: "artifacts/leaderboard-title-desktop-connected.png" });
  await page.getByRole("button", { name: /^Online PvP/ }).click();
  await page.getByRole("button", { name: "Leaderboard ↗", exact: true }).click();
  await board.getByRole("button", { name: "Back to online play", exact: true }).click();
  await page.getByRole("region", { name: "Match setup" }).waitFor();
  report.navigation = { titleEntryDisconnected: true, titleBack: true, onlineBack: true };
  await context.close();
  for (const state of ["empty", "error"]) {
    const { context, page } = await setup({ width: 390, height: 844 });
    let failing = state === "error";
    await page.route("**/api/ranked/leaderboard", route => failing
      ? route.fulfill({ status: 503, json: { error: "Fixture unavailable" } })
      : route.fulfill({ json: { season: "Preseason", entries: [] } }));
    await page.goto(origin);
    await page.getByRole("navigation", { name: "Main menu" }).getByRole("button", { name: /^Leaderboard\b/ }).click();
    const board = page.getByRole("region", { name: "Ranked leaderboard" });
    if (state === "error") {
      await board.getByRole("alert").waitFor();
      await page.screenshot({ path: "artifacts/leaderboard-error.png" });
      failing = false;
      await board.getByRole("button", { name: "Retry", exact: true }).click();
    }
    await board.getByText(/Complete five placement/).waitFor();
    await board.getByRole("combobox").click();
    await page.getByRole("option", { name: "Gold", exact: true }).click();
    await board.getByText("No commanders in Gold yet.", { exact: true }).waitFor();
    await bounds(page, board, state);
    await page.screenshot({ path: `artifacts/leaderboard-${state === "error" ? "error-recovered" : state}.png` });
    await context.close();
  }
  for (const [name, width, height] of [["phone320",320,568],["phone",390,844],["tablet",1024,768],["landscape",852,393]]) {
    const { context, page } = await setup({ width, height });
    await page.route("**/api/ranked/leaderboard", route => route.fulfill({ json: { season: "Preseason", entries } }));
    await page.goto(origin);
    for (const connected of [false, true]) {
      if (connected) await connect(page);
      const main = page.getByRole("navigation", { name: "Main menu" });
      await main.getByRole("button", { name: /^Leaderboard\b/ }).waitFor();
      await bounds(page, main, `${name}-${connected ? "connected" : "disconnected"}-title`);
      await page.screenshot({ path: `artifacts/leaderboard-title-${name}-${connected ? "connected" : "disconnected"}.png` });
      await main.getByRole("button", { name: /^Leaderboard\b/ }).click();
      const board = page.getByRole("region", { name: "Ranked leaderboard" });
      await board.getByRole("cell", { name: "Friend #7730", exact: true }).waitFor();
      await board.getByRole("combobox").click();
      await bounds(page, page.getByRole("listbox"), `${name}-picker`);
      await page.screenshot({ path: `artifacts/leaderboard-picker-${name}.png` });
      await page.keyboard.press("Escape");
      await bounds(page, board, `${name}-board`);
      await board.getByRole("button", { name: "Back to main menu", exact: true }).click();
    }
    await context.close();
  }
  const disabled = await setup({ width: 1440, height: 900 }, false);
  await disabled.page.goto(origin);
  await disabled.page.getByRole("navigation", { name: "Main menu" }).waitFor();
  assert.equal(await disabled.page.getByRole("button", { name: /^Leaderboard\b/ }).count(), 0);
  await disabled.context.close();
  assert.deepEqual(report.errors, []);
} catch (error) { report.failure = error.message; process.exitCode = 1; }
finally { release?.(); await writeFile("artifacts/leaderboard-browser.json", JSON.stringify(report, null, 2)); await browser.close(); }
console.log(JSON.stringify({ checks: report.screens.length, filters: report.filters, errors: report.errors, failure: report.failure }));
