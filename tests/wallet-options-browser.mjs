// Browser Testing only. Real wallet connectors/relay, no approvals or signing.
// Mobile links are observed through browser navigation; window.open is intercepted.
// The test browser has no native wallet apps and never completes a connection.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const sanitize = (text) =>
  text.replace(
    /(?:https?:\/\/|zerion:|metamask:|wc:)[^\s]+/gi,
    "[wallet URL hidden]",
  );
const origin = process.env.TEST_URL || "http://127.0.0.1:4180";
const browser = await chromium.launch({
  channel: "chrome",
  args: ["--no-sandbox"],
});
const report = { origin, checks: [], errors: [] };
await mkdir("artifacts", { recursive: true });
try {
  for (const profile of [
    { name: "desktop", viewport: { width: 1280, height: 850 } },
    {
      name: "ipad-standalone",
      viewport: { width: 1024, height: 1366 },
      hasTouch: true,
      isMobile: true,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    },
    {
      name: "iphone",
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      isMobile: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    },
  ]) {
    if (
      process.env.WALLET_PROFILE &&
      profile.name !== process.env.WALLET_PROFILE
    )
      continue;
    for (const wallet of ["Zerion", "MetaMask"]) {
      if (process.env.WALLET_NAME && wallet !== process.env.WALLET_NAME)
        continue;
      const { name, ...options } = profile;
      const ctx = await browser.newContext(options),
        page = await ctx.newPage();
      page.setDefaultTimeout(30000);
      page.on("console", (message) => {
        if (["error", "warning"].includes(message.type())) {
          const text = sanitize(message.text());
          if (!report.console) report.console = [];
          report.console.push({
            profile: name,
            wallet,
            text: text.slice(0, 800),
          });
        }
      });
      page.on("pageerror", (e) =>
        report.errors.push({
          profile: name,
          wallet,
          message: sanitize(e.message),
        }),
      );
      await page.addInitScript(
        ({ standalone }) => {
          window.__walletLinks = [];
          window.open = (input) => {
            try {
              const u = new URL(input);
              window.__walletLinks.push({
                protocol: u.protocol,
                host: u.hostname,
                path: /^\/?(?:wc|connect)?$/.test(u.pathname)
                  ? u.pathname
                  : "[other]",
                hasPairing:
                  u.searchParams.has("uri") ||
                  u.searchParams.has("channelId") ||
                  u.searchParams.has("comm"),
              });
            } catch {}
            return null;
          };
          if (standalone) {
            Object.defineProperty(navigator, "standalone", { value: true });
            Object.defineProperty(navigator, "platform", { value: "MacIntel" });
            Object.defineProperty(navigator, "maxTouchPoints", { value: 5 });
          }
        },
        { standalone: name === "ipad-standalone" },
      );
      const navigationLinks = [];
      const cdp = await ctx.newCDPSession(page);
      await cdp.send("Page.enable");
      for (const event of [
        "Page.frameRequestedNavigation",
        "Page.frameScheduledNavigation",
      ])
        cdp.on(event, ({ url }) => {
          try {
            const u = new URL(url);
            if (
              ["zerion:", "metamask:"].includes(u.protocol) ||
              /metamask/.test(u.hostname)
            )
              navigationLinks.push({
                protocol: u.protocol,
                host: u.hostname,
                path: /^\/?(?:wc|connect)?$/.test(u.pathname)
                  ? u.pathname
                  : "[other]",
                hasPairing:
                  u.searchParams.has("uri") ||
                  u.searchParams.has("channelId") ||
                  u.searchParams.has("comm"),
              });
          } catch {}
        });
      page.on("request", (request) => {
        try {
          const u = new URL(request.url());
          if (
            u.protocol === "metamask:" ||
            u.protocol === "zerion:" ||
            /metamask/.test(u.hostname)
          )
            navigationLinks.push({
              protocol: u.protocol,
              host: u.hostname,
              path: /^\/?(?:wc|connect)?$/.test(u.pathname)
                ? u.pathname
                : "[other]",
              hasPairing:
                u.searchParams.has("uri") ||
                u.searchParams.has("channelId") ||
                u.searchParams.has("comm"),
            });
        } catch {}
      });
      await page.goto(origin);
      await page
        .getByRole("button", { name: "Connect wallet", exact: true })
        .first()
        .click();
      const dialog = page.locator('[data-rk="farfield"][role="dialog"]');
      for (const label of ["Zerion", "MetaMask", "WalletConnect"])
        assert.ok(
          await dialog
            .getByRole("button", { name: label, exact: true })
            .isVisible(),
        );
      assert.equal(
        await dialog
          .getByRole("button", { name: "Rainbow", exact: true })
          .count(),
        0,
      );
      if (wallet === "Zerion")
        await page.screenshot({ path: `artifacts/wallet-options-${name}.png` });
      await dialog.getByRole("button", { name: wallet, exact: true }).click();
      // Desktop connectors may first show extension instructions; choose mobile.
      const mobile = dialog.getByRole("button", { name: /Mobile/i });
      if (await mobile.count()) await mobile.first().click();
      let result;
      for (let i = 0; i < 200; i++) {
        const links = [
          ...navigationLinks,
          ...(await page.evaluate(() => window.__walletLinks)),
        ];
        if (!links.length) {
          const remembered = await page.evaluate(() =>
            JSON.parse(
              localStorage.getItem("WALLETCONNECT_DEEPLINK_CHOICE") || "null",
            ),
          );
          if (remembered?.name === wallet) {
            const url = new URL(remembered.href);
            links.push({
              protocol: url.protocol,
              host: url.hostname,
              path: /^\/?(?:wc|connect)?$/.test(url.pathname)
                ? url.pathname
                : "[other]",
              generatedLinkRemembered: true,
            });
          }
        }
        const qr = await dialog
          .locator("svg")
          .evaluateAll((list) =>
            list.some(
              (e) =>
                e.getBoundingClientRect().width >= 180 &&
                e.querySelectorAll("path,rect").length > 0,
            ),
          );
        if (
          links.some(
            (link) => link.hasPairing || link.generatedLinkRemembered,
          ) ||
          qr
        ) {
          result = { links, qr };
          break;
        }
        await page.waitForTimeout(150);
      }
      if (!result) {
        report.failedLinks = navigationLinks;
        report.frames = await page.locator("iframe").evaluateAll((frames) =>
          frames.map((frame) => {
            try {
              const url = new URL(frame.src);
              return {
                protocol: url.protocol,
                host: url.hostname,
                path: /^\/?(?:wc|connect)?$/.test(url.pathname)
                  ? url.pathname
                  : "[other]",
              };
            } catch {
              return { src: "unparseable" };
            }
          }),
        );
        report.failureUI = sanitize(await dialog.innerText());
        // No post-connection screenshots: a QR or pairing URI could be visible.
      }
      assert.ok(result, `${name} ${wallet} generates QR or mobile link`);
      assert.equal(
        await page.locator("iframe").count(),
        0,
        "unpaired connector must not authorize game session",
      );
      report.checks.push({
        profile: name,
        wallet,
        directEntries: true,
        noRainbow: true,
        ...result,
      });
      await ctx.close();
    }
  }
  assert.deepEqual(report.errors, []);
  console.log("PASS wallet options", JSON.stringify(report));
} catch (error) {
  report.failure = { name: error.name, message: sanitize(error.message) };
  throw new Error(sanitize(error.message));
} finally {
  await writeFile(
    "artifacts/wallet-options.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
