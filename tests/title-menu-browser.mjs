// Run only in the Browser Testing workspace.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const origin = process.env.TEST_URL || "http://127.0.0.1:4173";
await mkdir("artifacts", { recursive: true });
const errors = [];
async function fits(page) {
  const result = await page.evaluate(() => ({
    page: document.documentElement.scrollHeight <= innerHeight,
    width: document.documentElement.scrollWidth <= innerWidth,
    buttons: [
      ...document.querySelectorAll(
        ".landing-content button,.landing-header button",
      ),
    ]
      .filter((e) => e.getClientRects().length)
      .every((e) => {
        const b = e.getBoundingClientRect();
        return (
          b.top >= 0 &&
          b.bottom <= innerHeight &&
          b.left >= 0 &&
          b.right <= innerWidth
        );
      }),
  }));
  assert.deepEqual(result, { page: true, width: true, buttons: true });
  await page.mouse.wheel(0, 800);
  assert.equal(await page.evaluate(() => scrollY), 0);
}
try {
  for (const [width, height] of [
    [2560, 1440],
    [1440, 900],
    [360, 852],
    [320, 568],
    [852, 393],
  ]) {
    const context = await browser.newContext({
      viewport: { width, height },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(origin);
    await page.getByRole("navigation", { name: "Main menu" }).waitFor();
    await fits(page);
    await page.screenshot({ path: `artifacts/title-${width}x${height}.png` });
    assert.equal(await page.locator(".landing-setup").count(), 0);
    assert.ok(
      (await page.locator(".game-landing").innerText()).split(/\s+/).length <
        50,
    );
    for (const name of [/Friends & AI/, /Online PvP/, /Join friends/]) {
      await page.getByRole("button", { name }).click();
      await fits(page);
      await page.getByRole("button", { name: "Back to main menu" }).click();
    }
    await page.getByRole("button", { name: "Landing settings" }).click();
    const dialog = page.getByRole("dialog", { name: "Settings", exact: true });
    await dialog.waitFor();
    await dialog.getByRole("checkbox", { name: "Sound", exact: true }).check();
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(
      await page
        .getByRole("button", { name: "Landing settings" })
        .evaluate((e) => e === document.activeElement),
      true,
    );
    await page.getByRole("button", { name: /Friends & AI/ }).click();
    await page
      .getByRole("button", { name: "Connect to play", exact: true })
      .click();
    await page.getByRole("dialog").waitFor();
    console.log(
      `PASS title ${width}x${height}: no scroll, all controls visible, compact copy, setup, settings, focus restoration, connect.`,
    );
    await context.close();
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
