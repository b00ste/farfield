// Real HTTP SSE lifecycle on an isolated bundled server. No browser, wallet,
// accelerated clock, state injection, live-server restart, or capability logs.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import {
  mkdtemp,
  readFile,
  stat,
  rm,
  mkdir,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { placementError } from "../games/farfield/engine.ts";

const directory = await mkdtemp(join(tmpdir(), "farfield-stream-test-"));
const filename = join(directory, "rooms.json");
const port = await new Promise((resolve) => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1", () => {
    const port = probe.address().port;
    probe.close(() => resolve(port));
  });
});
const origin = `http://127.0.0.1:${port}`;
const clients = [];
const requests = {};
const report = {
  startedAt: new Date().toISOString(),
  fixture:
    "Four synthetic Friend IDs; ordinary free custom match API; isolated bundled server",
  checks: [],
  requests,
  failure: null,
};
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const child = spawn(process.execPath, ["dist/server.mjs"], {
  env: {
    ...process.env,
    PORT: String(port),
    FARFIELD_STATE_PATH: filename,
  },
  stdio: ["ignore", "ignore", "pipe"],
});
child.stderr.resume();
const exited = new Promise((resolve) =>
  child.once("exit", (code, signal) => resolve({ code, signal })),
);
async function until(predicate, description, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await wait(100);
  }
  throw new Error(description);
}
async function request(action, body, token, signal) {
  requests[action] = (requests[action] || 0) + 1;
  return fetch(`${origin}/api/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: signal ?? AbortSignal.timeout(5000),
  });
}
async function api(action, body, token) {
  const response = await request(action, body, token);
  const value = await response.json();
  assert.equal(response.status, 200, value.error || action);
  return value;
}
async function open(seat) {
  const client = {
    seat,
    abort: new AbortController(),
    frames: 0,
    heartbeats: 0,
    latest: null,
    ended: false,
    expectedClose: false,
    error: null,
  };
  clients.push(client);
  const response = await request(
    "events",
    { code: seat.code, active: true },
    seat.token,
    client.abort.signal,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/event-stream/);
  client.reading = (async () => {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let end;
        while ((end = buffer.indexOf("\n\n")) !== -1) {
          const event = buffer.slice(0, end);
          buffer = buffer.slice(end + 2);
          if (event.startsWith(": heartbeat")) client.heartbeats++;
          const payload = event
            .split("\n")
            .find((line) => line.startsWith("data: "));
          if (!payload) continue;
          client.latest = JSON.parse(payload.slice(6));
          client.frames++;
        }
      }
    } catch (error) {
      if (!client.expectedClose)
        client.error = error instanceof Error ? error.message : String(error);
    } finally {
      client.ended = true;
      reader.releaseLock();
    }
  })();
  await until(() => client.latest, "First stream state did not arrive");
  return client;
}

try {
  await until(async () => {
    try {
      return (
        await fetch(`${origin}/health`, { signal: AbortSignal.timeout(1000) })
      ).ok;
    } catch {
      return false;
    }
  }, "Isolated server did not become healthy");
  report.build = JSON.parse(await readFile("dist/build.json", "utf8"));
  const first = await api("create", {
    friendId: "991001",
    mode: "custom",
    bots: [],
  });
  const seats = [first];
  for (let i = 1; i < 4; i++)
    seats.push(
      await api("join", { code: first.code, friendId: String(991001 + i) }),
    );
  await api(
    "command",
    { code: first.code, command: { type: "start" } },
    first.token,
  );
  const denied = await request(
    "events",
    { code: first.code, active: true },
    "invalid",
  );
  assert.equal(denied.status, 400);
  assert.match(denied.headers.get("content-type"), /application\/json/);
  await denied.json();
  report.checks.push({
    name: "Invalid stream capability rejected before SSE headers",
    passed: true,
  });

  for (const seat of seats) await open(seat);
  const began = Date.now();
  assert.equal(new Set(clients.map((c) => c.latest.selfId)).size, 4);
  for (const c of clients) {
    assert.equal(c.latest.selfId, c.seat.selfId);
    for (const seat of seats)
      assert.ok(!JSON.stringify(c.latest).includes(seat.token));
    assert.ok(c.latest.opponents.every((o) => o.state === null));
  }
  const state = clients[0].latest.state;
  const core = state.modules.find((m) => m.type === "core");
  let placement;
  for (
    let x = core.cells[0].x - 4;
    x <= core.cells[0].x + 4 && !placement;
    x++
  ) {
    for (let y = core.cells[0].y - 4; y <= core.cells[0].y + 4; y++) {
      if (!placementError(state, "passage", 1, 0, x, y)) {
        placement = {
          type: "build",
          room: "passage",
          shape: 1,
          rotation: 0,
          x,
          y,
        };
        break;
      }
    }
  }
  assert.ok(placement);
  await api("command", { code: first.code, command: placement }, first.token);
  await until(
    () => clients[0].latest.state.modules.length === 2,
    "Command did not reach the event stream",
  );
  assert.ok(clients.slice(1).every((c) => c.latest.state.modules.length === 1));
  report.checks.push({
    name: "Four distinct fog-filtered views; command delivered without sync polling",
    passed: true,
  });

  await api("sync", { code: first.code, active: false }, seats[1].token);
  await wait(6000);
  let snapshot = JSON.parse(await readFile(filename, "utf8"));
  let room = snapshot.rooms.find((r) => r.code === first.code);
  assert.equal(
    room.players.find((p) => p.id === seats[1].selfId).active,
    false,
  );
  report.checks.push({
    name: "Rare visibility sync remains authoritative while stream heartbeats renew presence",
    passed: true,
  });
  console.log(
    "PASS stream auth, four private views, command delivery and visibility; sustaining four connections without sync polls.",
  );
  while (Date.now() - began < 65_000) {
    await wait(Math.min(25_000, 65_000 - (Date.now() - began)));
    assert.ok(
      clients.every((c) => !c.ended && !c.error),
      "Stream ended during sustain interval",
    );
    console.log(
      `Four streams still connected after ${Math.floor((Date.now() - began) / 1000)} seconds`,
    );
  }
  snapshot = JSON.parse(await readFile(filename, "utf8"));
  room = snapshot.rooms.find((r) => r.code === first.code);
  assert.ok(room.players.every((p) => Date.now() - p.lastSeen < 6000));
  assert.ok(
    clients.every((c) => c.frames > 200 && c.latest.state.phase === "playing"),
  );
  report.sustainSeconds = (Date.now() - began) / 1000;
  report.frames = clients.map((c) => c.frames);
  report.checks.push({
    name: "Four streams sustain presence beyond 60 seconds with only one visibility sync",
    passed: true,
  });

  clients[3].expectedClose = true;
  clients[3].abort.abort();
  await until(() => clients[3].ended, "Client abort did not finish its stream");
  await until(
    async () => {
      const saved = JSON.parse(await readFile(filename, "utf8"));
      return (
        saved.rooms
          .find((r) => r.code === first.code)
          .players.find((p) => p.id === seats[3].selfId).active === false
      );
    },
    "Disconnected stream did not mark its seat inactive",
    7000,
  );
  report.checks.push({
    name: "Connection close marks only that seat inactive",
    passed: true,
  });
  clients.forEach((c) => {
    c.expectedClose = true;
  });
  child.kill("SIGTERM");
  let stopTimer;
  const stopped = await Promise.race([
    exited,
    new Promise((_, reject) => {
      stopTimer = setTimeout(
        () => reject(new Error("Graceful stream shutdown timed out")),
        30_000,
      );
    }),
  ]).finally(() => clearTimeout(stopTimer));
  assert.equal(stopped.code, 0);
  await until(
    () => clients.every((c) => c.ended),
    "Shutdown left a stream open",
  );
  snapshot = JSON.parse(await readFile(filename, "utf8"));
  room = snapshot.rooms.find((r) => r.code === first.code);
  assert.equal(room.players.length, 4);
  assert.ok(room.players.every((p) => p.active === false));
  assert.equal(
    room.players.find((p) => p.id === first.selfId).state.modules.length,
    2,
  );
  assert.equal((await stat(filename)).mode & 0o777, 0o600);
  report.checks.push({
    name: "SIGTERM closes streams and saves the final private checkpoint",
    passed: true,
  });
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  for (const client of clients) {
    client.expectedClose = true;
    client.abort.abort();
  }
  if (child.exitCode === null && !child.signalCode) {
    child.kill("SIGTERM");
    await exited;
  }
  await Promise.allSettled(clients.map((c) => c.reading));
  await rm(directory, { recursive: true, force: true });
  report.finishedAt = new Date().toISOString();
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/events-live.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    report.failure ? "FAIL HTTP streams" : "PASS HTTP streams",
    JSON.stringify(report),
  );
}
