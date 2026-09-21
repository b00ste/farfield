// Browser Testing only. Four real clients on live HTTP simulation; only wallet/NFT RPC is mocked.
import { chromium } from "playwright";
import { installFixture } from "./fixture.mjs";
import { observeRoom } from "./room-observer.mjs";
import { place } from "../server/arena.ts";
import { routeTo } from "../games/farfield/actors.ts";
import {
  housing,
  capacity,
  MODULES,
  recruitmentError,
} from "../games/farfield/engine.ts";
import { writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const origin =
  process.env.TEST_URL || "https://4173--main--ai-dev-01--daniel.kethalia.com";
const apiOrigin = new URL(process.env.TEST_API_URL || origin).origin;
const duration = Number(process.env.PLAY_SECONDS || 420);
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--no-sandbox",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ],
});
const clients = [],
  report = {
    frontend: origin,
    api: apiOrigin,
    started: new Date().toISOString(),
    errors: [],
    httpErrors: [],
    commands: [],
    samples: [],
    timings: [],
    transport: {
      streamRequests: 0,
      syncRequests: 0,
      stateMessages: 0,
      streamOrigins: [],
    },
  };
await mkdir("artifacts", { recursive: true });
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function wait(fn, label, ms = 30000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await pause(100);
  }
  throw Error(label);
}
async function command(c, cmd) {
  const t = performance.now();
  const r = await c.page.request.post(apiOrigin + "/api/command", {
    headers: { Authorization: "Bearer " + c.token },
    data: { code: c.code, command: cmd },
  });
  const v = await r.json();
  report.timings.push(performance.now() - t);
  if (v.error) {
    report.errors.push({ client: c.i, command: cmd, error: v.error });
    return false;
  }
  c.latest = v;
  report.commands.push({
    client: c.i,
    type: cmd.type,
    room: cmd.room,
    at: v.state.time,
  });
  return true;
}
async function connect(i) {
  const context = await browser.newContext({
    viewport:
      i === 3 ? { width: 390, height: 844 } : { width: 1440, height: 900 },
    hasTouch: i === 3,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  const c = {
    i,
    context,
    page,
    game: page.frameLocator("iframe"),
    latest: null,
    token: null,
  };
  clients.push(c);
  await installFixture(page, origin);
  await observeRoom(page, (view) => {
    report.transport.stateMessages++;
    if (!c.latest || view.revision >= c.latest.revision) c.latest = view;
    c.code = view.code;
    if (view.token) c.token = view.token;
  });
  page.on("request", (request) => {
    const url = new URL(request.url()),
      path = url.pathname;
    if (path === "/api/events") {
      report.transport.streamRequests++;
      if (!report.transport.streamOrigins.includes(url.origin))
        report.transport.streamOrigins.push(url.origin);
    }
    if (path === "/api/sync") report.transport.syncRequests++;
  });
  page.on("pageerror", (e) =>
    report.errors.push({ client: i, pageError: e.message }),
  );
  page.on("response", async (r) => {
    if (!r.url().startsWith(apiOrigin + "/api/")) return;
    if (r.status() >= 400)
      report.httpErrors.push({
        client: i,
        status: r.status(),
        path: new URL(r.url()).pathname,
        at: new Date().toISOString(),
        ...(report.httpErrors.length < 4
          ? {
              body: (await r.text().catch(() => "<unavailable>")).slice(
                0,
                1000,
              ),
              contentType: r.headers()["content-type"],
              server: r.headers()["server"],
            }
          : {}),
      });
    if (/\/api\/(sync|create|join|command)$/.test(r.url()) && r.ok()) {
      const v = await r.json().catch(() => null);
      if (v?.state) {
        if (!c.latest || v.revision >= c.latest.revision) c.latest = v;
        c.code = v.code;
        if (v.token) c.token = v.token;
      }
    }
  });
  for (const route of [
    "https://pulse.walletconnect.org/**",
    "https://api.web3modal.org/**",
  ])
    await page.route(route, (r) => r.fulfill({ json: {} }));
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: /Browser Wallet/ }).click();
  return c;
}
function economy(s) {
  s.nextShape = 1;
  const pending = s.modules.filter((m) => m.progress < 1);
  const queued = s.recruitQueue ?? [];
  const roleTotal = (role) =>
    s.roles[role] + queued.filter((entry) => entry.role === role).length;
  if (
    pending.length &&
    s.roles.builders === 0 &&
    s.friend.targetId !== pending[0].id
  )
    return { type: "direct", ...pending[0].cells[0], task: "work" };
  const built = (t) =>
    s.modules.filter((m) => m.type === t && !m.wreck && m.progress >= 1).length;
  const build = (t) =>
    pending.some((m) => m.type === t)
      ? null
      : pending.length < 2
        ? place(s, t)
        : null;
  if (!built("foundry")) return build("foundry");
  if (roleTotal("miners") < 1 && !recruitmentError(s, "miners"))
    return { type: "recruit", role: "miners" };
  if (!built("garden")) return build("garden");
  if (roleTotal("farmers") < 1 && !recruitmentError(s, "farmers"))
    return { type: "recruit", role: "farmers" };
  if (s.crew + queued.length >= housing(s) - 1 && s.crew < 64)
    return build("habitat");
  const targets = {
    farmers: Math.min(20, Math.ceil(s.crew * 0.35) + 1),
    miners: Math.min(24, Math.ceil(s.crew * 0.4) + 1),
    builders: Math.min(10, Math.ceil(s.crew * 0.15) + 1),
    engineers: s.crew > 20 ? 2 : 0,
    guards: s.crew > 30 ? 4 : 0,
    medics: s.crew > 40 ? 2 : 0,
    scientists: s.crew > 45 ? 2 : 0,
  };
  const workplace = {
    farmers: "garden",
    miners: "foundry",
    engineers: "solar",
    guards: "turret",
    medics: "infirmary",
    scientists: "lab",
  };
  for (const [role, n] of Object.entries(targets)) {
    if (roleTotal(role) >= n || s.crew >= 64) continue;
    if (role !== "builders" && capacity(s, role) <= roleTotal(role))
      return build(workplace[role]);
    if (!recruitmentError(s, role)) return { type: "recruit", role };
  }
  if (s.modules.length < 60 && pending.length < 2 && s.alloy > 25)
    return place(s, "passage");
  return null;
}
try {
  const host = await connect(0);
  await host.page.getByRole("button", { name: /Friends & AI/ }).click();
  await host.page
    .getByRole("combobox", { name: "AI commanders", exact: true })
    .click();
  await host.page
    .getByRole("option", { name: "Friends only", exact: true })
    .click();
  await host.page
    .getByRole("button", { name: "Enter sector →", exact: true })
    .click();
  await wait(() => host.token, "host created");
  for (let i = 1; i < 4; i++) {
    const c = await connect(i);
    await c.page
      .getByRole("button", { name: "Join friends", exact: false })
      .click();
    await c.page
      .getByRole("textbox", { name: "Match code", exact: true })
      .fill(host.code);
    await c.page
      .getByRole("button", { name: "Join friends →", exact: true })
      .click();
    await wait(() => c.token, "joined " + i);
  }
  await wait(
    () => clients.every((c) => c.latest?.players.length === 4),
    "four clients see lobby",
  );
  await host.game
    .getByRole("button", { name: "Begin match →", exact: true })
    .click();
  await wait(
    () => clients.every((c) => c.latest?.state.phase === "playing"),
    "four players start",
  );
  console.log(
    "LIVE: four UI sessions joined and started",
    clients.map((c) => ({ seat: c.i, spawn: c.latest.state.spawn })),
  );
  for (const c of clients)
    await command(c, {
      type: "combat-mode",
      group: "friend",
      mode: "peaceful",
    });
  const begin = Date.now();
  let nextSample = 0;
  while (Date.now() - begin < duration * 1000) {
    for (const c of clients) {
      const cmd = economy(structuredClone(c.latest.state));
      if (cmd) await command(c, cmd);
    }
    if (Date.now() - begin >= nextSample) {
      const sample = {
        seconds: Math.round((Date.now() - begin) / 1000),
        seats: clients.map((c) => ({
          i: c.i,
          time: Math.round(c.latest.state.time),
          modules: c.latest.state.modules.length,
          workers: c.latest.state.crew,
          food: Math.round(c.latest.state.food),
          alloy: Math.round(c.latest.state.alloy),
        })),
      };
      report.samples.push(sample);
      console.log(JSON.stringify(sample));
      await writeFile(
        "artifacts/live-four-progress.json",
        JSON.stringify(report, null, 2),
      );
      nextSample += 30000;
    }
    await pause(900);
  }
  if (process.env.WIN_PHASE === "1") {
    console.log(
      "WIN PHASE: building routes, exploring and capturing with each Friend",
    );
    report.objectives = [];
    const targets = new Map(),
      used = new Set();
    for (const c of clients) {
      const s = c.latest.state;
      const m = s.monoliths
        .map((m, i) => ({ ...m, index: i }))
        .filter((m) => !used.has(m.index))
        .sort(
          (a, b) =>
            Math.hypot(a.x - s.friend.x, a.y - s.friend.y) -
            Math.hypot(b.x - s.friend.x, b.y - s.friend.y),
        )[0];
      targets.set(c.i, m.index);
      used.add(m.index);
    }
    async function approach(c, index) {
      const s = structuredClone(c.latest.state),
        m = s.monoliths[index];
      const goals = [...s.modules, ...s.terrain]
        .filter((m) => m.progress >= 1)
        .flatMap((m) => m.cells)
        .filter((p) => Math.hypot(p.x - m.x, p.y - m.y) <= 2.5);
      if (routeTo(s, s.friend, goals) !== null) {
        if (
          !c.capture ||
          c.capture.index !== index ||
          s.time - c.capture.at > 20
        ) {
          await command(c, { type: "capture", index });
          c.capture = { index, at: s.time };
        }
        return;
      }
      s.nextShape = 1;
      if (s.modules.filter((m) => m.progress < 1).length < 2) {
        const cmd = place(s, "passage", m);
        if (cmd) await command(c, cmd);
      }
    }
    let started = Date.now(),
      lastLog = 0;
    while (
      !clients.every(
        (c) =>
          c.latest.state.monoliths[targets.get(c.i)].ownerId ===
          c.latest.selfId,
      )
    ) {
      assert.ok(
        Date.now() - started < 420000,
        "four Friends reach and capture their objectives",
      );
      for (const c of clients)
        if (
          c.latest.state.monoliths[targets.get(c.i)].ownerId !== c.latest.selfId
        )
          await approach(c, targets.get(c.i));
      if (Date.now() - lastLog > 30000) {
        console.log(
          "EXPLORE",
          JSON.stringify(
            clients.map((c) => ({
              seat: c.i,
              modules: c.latest.state.modules.length,
              friend: {
                x: c.latest.state.friend.x,
                y: c.latest.state.friend.y,
              },
              owned: c.latest.state.monoliths.filter(
                (m) => m.ownerId === c.latest.selfId,
              ).length,
            })),
          ),
        );
        lastLog = Date.now();
      }
      await pause(900);
    }
    report.objectives.push(
      "All four commanders captured a distinct monolith using built paths.",
    );
    // Deliberate competition: rival 1 marches to 0's signal; both remain peaceful to prove contesting itself blocks capture.
    const defender = clients[0],
      challenger = clients[1],
      contestedIndex = targets.get(0);
    started = Date.now();
    while (!defender.latest.state.monoliths[contestedIndex].contested) {
      assert.ok(
        Date.now() - started < 300000,
        "rival reaches contested monolith",
      );
      await approach(challenger, contestedIndex);
      await pause(900);
    }
    const contested = defender.latest.state.monoliths[contestedIndex];
    assert.equal(contested.ownerId, defender.latest.selfId);
    report.objectives.push(
      "Rival Friend contested occupied monolith; ownership did not flip remotely.",
    );
    console.log("CONTEST VERIFIED; ordering real Friend combat");
    await command(defender, {
      type: "combat-mode",
      group: "friend",
      mode: "aggressive",
    });
    await command(defender, {
      type: "attack",
      target: challenger.latest.selfId,
    });
    await wait(
      () => challenger.latest.state.friend.hp < 120,
      "live combat deals damage",
      20000,
    );
    await command(challenger, { type: "ability", ability: "shield" });
    await wait(
      () => challenger.latest.state.friend.hp <= 0,
      "Friend defeated at monolith",
      45000,
    );
    report.objectives.push(
      "Friend combat damaged and defeated a rival; Shield used during the fight.",
    );
    await command(defender, {
      type: "combat-mode",
      group: "friend",
      mode: "peaceful",
    });
    // Other commanders withdraw. Winner still has to physically capture every signal and hold 60 seconds.
    for (const c of clients.slice(1)) {
      if (c.latest.state.friend.hp <= 0)
        await wait(() => c.latest.state.friend.hp > 0, "Friend respawn", 25000);
      await command(c, {
        type: "direct",
        ...c.latest.state.modules.find((m) => m.type === "core").cells[0],
        task: "move",
      });
    }
    for (const index of [0, 1, 2, 3]) {
      started = Date.now();
      while (
        defender.latest.state.monoliths[index].ownerId !==
        defender.latest.selfId
      ) {
        assert.ok(
          Date.now() - started < 300000,
          "winner physically captures monolith " + index,
        );
        await approach(defender, index);
        await pause(900);
      }
      console.log("WIN SIGNAL", index, "time", defender.latest.state.time);
    }
    await wait(
      () => clients.every((c) => c.latest.winnerId === defender.latest.selfId),
      "same winner in all four sessions",
      90000,
    );
    assert.equal(defender.latest.state.phase, "won");
    assert.ok(clients.slice(1).every((c) => c.latest.state.phase === "lost"));
    report.objectives.push(
      "All four sessions agreed on the monolith winner after the full hold timer.",
    );
    console.log("LIVE WIN VERIFIED", defender.latest.victoryReason);
  }
  for (const c of clients) {
    if (c.latest.state.phase === "playing")
      await c.game
        .getByRole("button", { name: "Center station", exact: true })
        .click();
    const cdp = await c.context.newCDPSession(c.page);
    const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
    await writeFile(
      `artifacts/live-four-${c.i}.png`,
      Buffer.from(shot.data, "base64"),
    );
    const frame = await c.page.locator("iframe").elementHandle();
    const gameFrame = await frame.contentFrame();
    const performanceSample = await gameFrame.evaluate(async () => {
      const times = [];
      let last = performance.now();
      await new Promise((resolve) => {
        const step = (t) => {
          times.push(t - last);
          last = t;
          if (times.length < 120) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      });
      times.sort((a, b) => a - b);
      return {
        p95FrameMs: times[114],
        meanFrameMs: times.reduce((a, b) => a + b) / times.length,
      };
    });
    report.samples.push({ client: c.i, ...performanceSample });
  }
  // Test a refresh without resetting the room: report recovery, do not conceal a new seat.
  const prior = clients[3].latest.selfId;
  const streamsBeforeRefresh = report.transport.streamRequests;
  clients[3].latest = null;
  await clients[3].page.reload();
  await pause(3000);
  if (
    await clients[3].page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .count()
  ) {
    await clients[3].page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .first()
      .click();
    await clients[3].page
      .getByRole("button", { name: /Browser Wallet/ })
      .click();
  }
  await wait(
    () => clients[3].page.locator("iframe").count(),
    "game returns after reload",
    30000,
  );
  await clients[3].game.locator(".sector-status").waitFor();
  if (process.env.EXPECT_STREAM === "1")
    await wait(
      () => report.transport.streamRequests > streamsBeforeRefresh,
      "fresh game reconnects live stream after reload",
    );
  await wait(
    () => clients[3].latest?.selfId === prior,
    "same seat after reload",
  );
  report.refresh = {
    retainedGame: (await clients[3].page.locator("iframe").count()) > 0,
    sameSeat: clients[3].latest.selfId === prior,
  };
  report.final = clients.map((c) => ({
    client: c.i,
    modules: c.latest.state.modules.length,
    workers: c.latest.state.crew,
    time: c.latest.state.time,
  }));
  report.completed = new Date().toISOString();
  assert.equal(report.errors.length, 0, "live gameplay and page errors");
  assert.equal(report.httpErrors.length, 0, "live transport HTTP errors");
  if (process.env.EXPECT_STREAM === "1") {
    assert.deepEqual(
      report.transport.streamOrigins,
      [apiOrigin],
      "browser streams use the configured API origin",
    );
    assert.ok(
      report.transport.streamRequests >= 4,
      "all four clients request live streams",
    );
    assert.ok(
      report.transport.syncRequests < duration * 2,
      "live sessions do not fall back to rapid HTTP polling",
    );
    assert.ok(
      report.transport.stateMessages > duration,
      "continuous RoomView messages arrive through the host",
    );
  }
  console.log(
    "LIVE COMPLETE",
    JSON.stringify({
      final: report.final,
      errors: report.errors.length,
      httpErrors: report.httpErrors.length,
      refresh: report.refresh,
    }),
  );
} catch (e) {
  report.failure = String(e.stack || e);
  console.error(report.failure);
  process.exitCode = 1;
} finally {
  await writeFile(
    "artifacts/live-four-report.json",
    JSON.stringify(report, null, 2),
  );
  for (const c of clients)
    if (c.token)
      await c.page.request
        .post(apiOrigin + "/api/leave", {
          headers: { Authorization: "Bearer " + c.token },
          data: { code: c.code },
        })
        .catch(() => {});
  await browser.close();
}
