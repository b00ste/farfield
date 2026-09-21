// Browser Testing. Two distinct fixture wallets, real public matchmaking and server.
import { chromium } from "playwright";
import { installFixture, SECOND_OWNER } from "./fixture.mjs";
import { observeRoom } from "./room-observer.mjs";
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const origin =
  process.env.TEST_URL || "https://4173--main--ai-dev-01--daniel.kethalia.com";
const apiOrigin = new URL(process.env.TEST_API_URL || origin).origin;
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox", "--disable-background-timer-throttling"],
});
const clients = [],
  errors = [],
  paymentRequests = [];
const wait = async (fn, why, ms = 30000) => {
  for (let t = 0; t < ms; t += 100) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw Error(why);
};
try {
  for (let i = 0; i < 2; i++) {
    const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
      }),
      page = await context.newPage();
    const c = {
      context,
      page,
      game: page.frameLocator("iframe"),
      latest: null,
      token: null,
    };
    clients.push(c);
    await installFixture(page, origin);
    await observeRoom(page, (view) => {
      if (!c.latest || view.revision >= c.latest.revision) c.latest = view;
      if (view.token) c.token = view.token;
    });
    page.on("request", (request) => {
      if (
        /\/api\/(wager|escrow|fund|claim)/i.test(
          new URL(request.url()).pathname,
        )
      )
        paymentRequests.push(new URL(request.url()).pathname);
    });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", async (r) => {
      if (/\/api\/(sync|matchmake|command)$/.test(r.url()) && r.ok()) {
        const v = await r.json().catch(() => null);
        if (v?.state) {
          c.latest = v;
          if (v.token) c.token = v.token;
        }
      }
    });
    await page.goto(origin);
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: /Browser Wallet/ }).click();
    if (i === 1) {
      await page.evaluate(
        (owner) => window.__friendWalletTest.accounts([owner]),
        SECOND_OWNER,
      );
      await page.waitForTimeout(500);
    }
    await page.getByRole("button", { name: /Online PvP/ }).click();
    assert.equal(
      await page
        .getByRole("button", {
          name: "Wagered · Coming soon",
          exact: true,
        })
        .isDisabled(),
      true,
    );
    await page
      .getByRole("button", { name: "Find free match →", exact: true })
      .click();
    await wait(() => c.token, "online seat allocated");
  }
  await wait(
    () => clients.every((c) => c.latest?.state.phase === "playing"),
    "automatic pairing launches both players",
  );
  assert.equal(clients[0].latest.code, clients[1].latest.code);
  assert.notEqual(clients[0].latest.selfId, clients[1].latest.selfId);
  assert.deepEqual(
    new Set(clients[0].latest.players.map((p) => p.friendId)),
    new Set(["7730", "3412"]),
  );
  await new Promise((r) => setTimeout(r, 15000));
  // Personal menus must never pause a competitive room for the other player.
  for (const c of clients)
    await c.game
      .getByRole("button", { name: "Game menu", exact: true })
      .click();
  const beforeMenus = clients[0].latest.state.time;
  await new Promise((r) => setTimeout(r, 3000));
  assert.ok(
    clients[0].latest.state.time > beforeMenus + 1,
    "online simulation continues while both players have menus open",
  );
  for (const c of clients)
    await c.game
      .getByRole("button", { name: "Close dialog", exact: true })
      .click();
  const loser = clients[1],
    winner = clients[0];
  await loser.game
    .getByRole("button", { name: "Game menu", exact: true })
    .click();
  await loser.game.getByRole("button", { name: /Forfeit/ }).click();
  await loser.game
    .getByRole("button", { name: "Confirm forfeit", exact: true })
    .click();
  await wait(
    () => clients.every((c) => c.latest.winnerId === winner.latest.selfId),
    "same online winner",
  );
  for (const [i, c] of clients.entries()) {
    const result = c.game.getByRole("region", {
      name: "Match result",
      exact: true,
    });
    await result.waitFor();
    const rect = await result.boundingBox();
    assert.ok(
      rect.x <= 1 && rect.y <= 1 && rect.width >= 1279 && rect.height >= 799,
    );
    await c.game
      .getByRole("heading", {
        name: i === 0 ? "Victory" : "Defeat",
        exact: true,
      })
      .waitFor();
    const cdp = await c.context.newCDPSession(c.page);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    await writeFile(
      `artifacts/online-result-${i}.png`,
      Buffer.from(shot.data, "base64"),
    );
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(paymentRequests, []);
  const walletMethods = [];
  for (const c of clients) {
    const methods = await c.page.evaluate(
      () => window.__friendWalletTest.state.requests,
    );
    assert.ok(
      methods.every(
        (method) => !/(sign|sendTransaction|sendCalls)/i.test(method),
      ),
      "free matches never request signatures or transactions",
    );
    walletMethods.push([...new Set(methods)]);
    assert.equal(
      "economy" in c.latest,
      false,
      "public room view has no payment economy metadata",
    );
    assert.doesNotMatch(
      await c.game
        .getByRole("region", { name: "Match result", exact: true })
        .innerText(),
      /\b(?:RF|tokens?|deposit|payout|escrow|wager|stake|refund)\b/i,
    );
  }
  await writeFile(
    "artifacts/online-free.json",
    JSON.stringify(
      {
        frontend: origin,
        api: apiOrigin,
        checks: [
          "two independent players matched",
          "menus do not pause competitive play",
          "same winner after forfeit",
          "full-screen results",
          "no payment payload or requests",
        ],
        walletMethods,
        paymentRequests,
        errors,
      },
      null,
      2,
    ),
  );
  console.log(
    "PASS live online: two distinct Friends matched automatically, personal menus did not pause play, forfeited, same winner, full-screen results; free mode only",
  );
} finally {
  for (const c of clients)
    if (c.token)
      await c.page.request
        .post(apiOrigin + "/api/leave", {
          headers: { Authorization: "Bearer " + c.token },
          data: { code: c.latest.code },
        })
        .catch(() => {});
  await browser.close();
}
