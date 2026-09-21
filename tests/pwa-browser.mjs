// Browser Testing only. Native install and iOS/standalone signals are explicitly
// synthetic; manifests, service workers, cache behavior, and game API are real.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installFixture } from "./fixture.mjs";
import { observeRoom } from "./room-observer.mjs";
const origin = process.env.TEST_URL || "http://127.0.0.1:4180";
await mkdir("artifacts", { recursive: true });
const apiOrigin = new URL(process.env.TEST_API_URL || origin).origin;
const temporaryProfiles = [];
const persistentContexts = [];
const report = {
  origin,
  apiOrigin,
  checkedAt: new Date().toISOString(),
  checks: [],
  errors: [],
};
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const wait = async (fn, why) => {
  for (let i = 0; i < 150; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(why);
};
const menu = (page) => page.getByRole("navigation", { name: "Main menu" });
const install = (page) => page.getByRole("button", { name: /Install game/i });
async function fits(page) {
  const result = await page.evaluate(() => ({
    vertical: document.documentElement.scrollHeight <= innerHeight + 1,
    horizontal: document.documentElement.scrollWidth <= innerWidth + 1,
    buttons: [
      ...document.querySelectorAll(
        ".landing-content button,.landing-header button",
      ),
    ]
      .filter((e) => e.getClientRects().length)
      .map((e) => {
        const b = e.getBoundingClientRect();
        return {
          name: e.getAttribute("aria-label") || e.innerText,
          width: b.width,
          height: b.height,
          inBounds:
            b.top >= 0 &&
            b.left >= 0 &&
            b.bottom <= innerHeight + 1 &&
            b.right <= innerWidth + 1,
        };
      }),
  }));
  assert.ok(
    result.vertical && result.horizontal,
    "title has no document overflow",
  );
  assert.ok(
    result.buttons.every((b) => b.inBounds),
    "all visible title controls fit viewport",
  );
  const target = result.buttons.find((b) => /Install game/i.test(b.name));
  assert.ok(
    target && target.width >= 44 && target.height >= 44,
    "install touch target is at least 44px",
  );
  return result;
}
async function context(options = {}) {
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: false,
    ...options,
  });
  const page = await ctx.newPage();
  page.setDefaultTimeout(20000);
  page.on("pageerror", (e) => report.errors.push(e.message));
  return { ctx, page };
}
try {
  // Real network/assets/SW, without fixtures or request routing.
  const profile = await mkdtemp(join(tmpdir(), "farfield-pwa-install-"));
  temporaryProfiles.push(profile);
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: "chrome",
    headless: true,
    ignoreHTTPSErrors: false,
    args: ["--no-sandbox"],
  });
  persistentContexts.push(ctx);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => report.errors.push(e.message));
  await page.goto(origin);
  await menu(page).waitFor();
  const manifestUrl = await page
    .locator('link[rel="manifest"]')
    .getAttribute("href");
  const manifestResponse = await page.request.get(
    new URL(manifestUrl, origin).href,
  );
  assert.equal(manifestResponse.status(), 200);
  const manifest = await manifestResponse.json();
  assert.equal(manifest.display, "standalone");
  const iconSizes = [];
  for (const icon of manifest.icons) {
    const size = await page.evaluate(
      async (url) => {
        const img = new Image();
        img.src = url;
        await img.decode();
        return [img.naturalWidth, img.naturalHeight];
      },
      new URL(icon.src, new URL(manifestUrl, origin)).href,
    );
    iconSizes.push(size.join("x"));
  }
  assert.ok(iconSizes.includes("192x192") && iconSizes.includes("512x512"));
  const apple = await page
    .locator('link[rel="apple-touch-icon"]')
    .getAttribute("href");
  const appleSize = await page.evaluate(async (url) => {
    const i = new Image();
    i.src = url;
    await i.decode();
    return [i.naturalWidth, i.naturalHeight];
  }, new URL(apple, origin).href);
  assert.deepEqual(appleSize, [180, 180]);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await wait(
    () => page.evaluate(() => !!navigator.serviceWorker.controller),
    "real service worker controls the page",
  );
  const cdp = await ctx.newCDPSession(page);
  let installability;
  try {
    installability = await cdp.send("Page.getInstallabilityErrors");
  } catch {
    installability = { unsupported: true };
  }
  if (!installability.unsupported)
    assert.deepEqual(
      installability.installabilityErrors,
      [],
      "persistent Chrome profile passes installability checks",
    );
  const cacheUrls = await page.evaluate(async () => {
    const keys = await caches.keys();
    const urls = [];
    for (const key of keys)
      for (const request of await (await caches.open(key)).keys())
        urls.push(new URL(request.url).pathname);
    return urls;
  });
  assert.ok(cacheUrls.length > 0, "offline shell is actually cached");
  assert.ok(
    cacheUrls.every(
      (path) => !path.startsWith("/api/") && !/room|state|wallet/i.test(path),
    ),
    "API and match state are not cached",
  );
  report.checks.push({
    name: "manifest-assets-service-worker",
    manifest: { name: manifest.name, display: manifest.display },
    iconSizes,
    appleSize,
    cacheUrls,
    installability,
  });
  await ctx.setOffline(true);
  await page.goto(origin + "/?pwa-offline-check=1");
  const offline = await page.locator("body").innerText();
  assert.match(
    offline,
    /offline|connection|connect to/i,
    "offline fallback explains reconnecting",
  );
  report.checks.push({
    name: "offline-fallback",
    message: offline.slice(0, 250),
  });
  await ctx.setOffline(false);
  await ctx.close();

  for (const [width, height] of [
    [320, 568],
    [390, 844],
    [568, 320],
    [852, 393],
    [1024, 768],
  ]) {
    const { ctx, page } = await context({
      viewport: { width, height },
      hasTouch: true,
      isMobile: true,
      deviceScaleFactor: 2,
    });
    await installFixture(page, origin);
    await page.goto(origin);
    await menu(page).waitFor();
    const disconnected = await fits(page);
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .first()
      .tap();
    await page.getByRole("button", { name: /Browser Wallet/ }).tap();
    await page.getByRole("button", { name: /Change commander/ }).waitFor();
    const connected = await fits(page);
    await page.screenshot({
      path: `artifacts/pwa-menu-${width}x${height}.png`,
    });
    report.checks.push({
      name: "mobile-title",
      width,
      height,
      disconnected,
      connected,
    });
    await ctx.close();
  }

  // Deferred install event only: proves UI handling, not an OS installation.
  {
    const { ctx, page } = await context({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
    });
    await page.goto(origin);
    await menu(page).waitFor();
    await page.evaluate(() => {
      window.__installPrompts = 0;
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.defineProperties(event, {
        prompt: {
          value: async () => {
            window.__installPrompts++;
          },
        },
        userChoice: {
          value: Promise.resolve({ outcome: "dismissed", platform: "web" }),
        },
      });
      window.dispatchEvent(event);
    });
    await install(page).tap();
    await page
      .getByRole("dialog", { name: "Install Farfield", exact: true })
      .waitFor();
    await page
      .getByRole("button", { name: "Close install farfield", exact: true })
      .tap();
    await page.evaluate(() => {
      const event = new Event("beforeinstallprompt", { cancelable: true });
      Object.defineProperties(event, {
        prompt: {
          value: async () => {
            window.__installPrompts++;
          },
        },
        userChoice: {
          value: Promise.resolve({ outcome: "accepted", platform: "web" }),
        },
      });
      window.dispatchEvent(event);
    });
    await install(page).tap();
    assert.equal(await page.evaluate(() => window.__installPrompts), 2);
    await page.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
    await install(page).waitFor({ state: "hidden" });
    report.checks.push({
      name: "synthetic-beforeinstallprompt",
      promptCalls: 2,
      dismissalShowsHelp: true,
      appinstalledHidesButton: true,
      actualOSInstall: false,
    });
    await ctx.close();
  }

  {
    const { ctx, page } = await context({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    });
    await page.goto(origin);
    await menu(page).waitFor();
    await install(page).tap();
    const dialog = page.getByRole("dialog");
    await dialog.waitFor();
    assert.match(await dialog.innerText(), /Home Screen/i);
    assert.match(await dialog.innerText(), /Share/i);
    await page.screenshot({ path: "artifacts/pwa-ios-help.png" });
    report.checks.push({ name: "synthetic-iOS-UA-help", actualSafari: false });
    await ctx.close();
  }

  {
    const { ctx, page } = await context();
    await page.addInitScript(() => {
      const original = window.matchMedia.bind(window);
      window.matchMedia = (query) => {
        const result = original(query);
        if (query.includes("display-mode: standalone"))
          Object.defineProperty(result, "matches", { value: true });
        return result;
      };
      Object.defineProperty(navigator, "standalone", { value: true });
    });
    await page.goto(origin);
    await menu(page).waitFor();
    assert.equal(await install(page).count(), 0);
    report.checks.push({ name: "synthetic-standalone", installHidden: true });
    await ctx.close();
  }

  {
    const { ctx, page } = await context();
    await installFixture(page, origin);
    let latest,
      token,
      streams = 0;
    await observeRoom(page, (view) => {
      if (!latest || view.revision >= latest.revision) latest = view;
      if (view.token) token = view.token;
    });
    page.on("request", (request) => {
      if (new URL(request.url()).pathname === "/api/events") streams++;
    });
    await page.goto(origin);
    await menu(page).waitFor();
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
    await wait(
      () => latest?.state.phase === "playing",
      "match starts behind controlled PWA shell",
    );
    const self = latest.selfId,
      before = latest.state.time;
    if (process.env.TEST_REBUILD_SW === "1") {
      assert.equal(
        new URL(origin).hostname,
        "127.0.0.1",
        "rebuild only the isolated local candidate",
      );
      await promisify(execFile)("npm", ["run", "build"], {
        env: { ...process.env, PUBLIC_API_ORIGIN: apiOrigin },
        timeout: 120000,
      });
    }
    await page.evaluate(async () => {
      window.__pwaGameSentinel = "stays";
      const registration = await navigator.serviceWorker.ready;
      await registration.update();
    });
    if (process.env.TEST_REBUILD_SW === "1") {
      await wait(
        () =>
          page.evaluate(
            async () => !!(await navigator.serviceWorker.ready).waiting,
          ),
        "changed worker waits rather than replacing the live match worker",
      );
    }
    await wait(
      () => latest.state.time > before + 2,
      "live state keeps advancing after SW update check",
    );
    assert.equal(
      await page.evaluate(() => window.__pwaGameSentinel),
      "stays",
      "SW update check did not force page reload",
    );
    assert.equal(latest.selfId, self);
    assert.ok(streams >= 1, "fixture wallet game uses real SSE");
    const cachedApi = await page.evaluate(async () => {
      for (const key of await caches.keys())
        for (const request of await (await caches.open(key)).keys())
          if (new URL(request.url).pathname.startsWith("/api/")) return true;
      return false;
    });
    assert.equal(cachedApi, false);
    report.checks.push({
      name: "live-match-update-check",
      samePlayer: true,
      noForcedReload: true,
      realStreams: streams,
      APICached: false,
      changedWorkerVersion: process.env.TEST_REBUILD_SW === "1",
      waitingWorker: process.env.TEST_REBUILD_SW === "1",
    });
    if (token)
      await page.request.post(apiOrigin + "/api/leave", {
        headers: { Authorization: "Bearer " + token },
        data: { code: latest.code },
      });
    await ctx.close();
  }
  {
    const { ctx, page } = await context();
    await page.addInitScript(() => {
      Object.defineProperty(window, "localStorage", {
        get() {
          throw new DOMException("Storage blocked", "SecurityError");
        },
      });
    });
    await page.goto(origin);
    await menu(page).waitFor();
    await install(page).click();
    await page.getByRole("dialog").waitFor();
    report.checks.push({
      name: "blocked-localStorage",
      landingAndInstallHelpWork: true,
    });
    await ctx.close();
  }
  assert.deepEqual(report.errors, []);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/pwa-browser.json",
    JSON.stringify(report, null, 2),
  );
  console.log("PASS PWA browser", JSON.stringify(report));
} catch (error) {
  report.failure = { name: error.name, message: error.message };
  throw error;
} finally {
  await writeFile(
    "artifacts/pwa-browser.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
  for (const context of persistentContexts)
    await context.close().catch(() => {});
  for (const profile of temporaryProfiles)
    await rm(profile, { recursive: true, force: true });
}
