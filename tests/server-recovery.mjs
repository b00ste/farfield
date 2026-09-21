// Real bundled-server restart test. No browser, injected game state, or clock acceleration.
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, readFile, stat, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import { placementError } from "../games/farfield/engine.ts";
const directory = await mkdtemp(join(tmpdir(), "farfield-recovery-"));
const filename = join(directory, "rooms.json");
const port = await new Promise((resolve) => {
  const probe = createServer();
  probe.listen(0, "127.0.0.1", () => {
    const p = probe.address().port;
    probe.close(() => resolve(p));
  });
});
const origin = `http://127.0.0.1:${port}`;
let child, exited;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function launch() {
  child = spawn(process.execPath, ["dist/server.mjs"], {
    env: {
      ...process.env,
      PORT: String(port),
      FARFIELD_STATE_PATH: filename,
      RF_WAGERS_ENABLED: "false",
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  // Only expose exit codes, never raw snapshot contents/capabilities.
  child.stderr.resume();
  exited = new Promise((resolve) =>
    child.once("exit", (code, signal) => resolve({ code, signal })),
  );
}
async function ready() {
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(origin + "/health")).ok) return;
    } catch {}
    if (child.exitCode !== null) throw Error("Server exited before healthy");
    await wait(100);
  }
  throw Error("Server health timed out");
}
async function api(action, body, token) {
  const response = await fetch(origin + "/api/" + action, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify(body),
  });
  const value = await response.json();
  assert.equal(response.status, 200, value.error || action);
  return value;
}
try {
  launch();
  await ready();
  const seat = await api("create", {
    friendId: "987654",
    mode: "custom",
    bots: ["easy"],
  });
  const started = await api(
    "command",
    { code: seat.code, command: { type: "start" } },
    seat.token,
  );
  const core = started.state.modules.find((module) => module.type === "core");
  let position;
  for (const cell of core.cells) {
    for (let dx = -2; dx <= 1 && !position; dx++) {
      for (let dy = -2; dy <= 1; dy++) {
        const x = cell.x + dx,
          y = cell.y + dy;
        if (!placementError(started.state, "passage", 1, 0, x, y)) {
          position = { x, y };
          break;
        }
      }
    }
    if (position) break;
  }
  assert.ok(position, "Starting core must permit an adjacent square passage");
  const built = await api(
    "command",
    {
      code: seat.code,
      command: {
        type: "build",
        room: "passage",
        shape: 1,
        rotation: 0,
        ...position,
      },
    },
    seat.token,
  );
  assert.equal(built.state.modules.length, 2);
  child.kill("SIGTERM");
  assert.equal((await exited).code, 0, "graceful stop must finish checkpoint");
  assert.equal((await stat(filename)).mode & 0o777, 0o600);
  const saved = JSON.parse(await readFile(filename, "utf8")).rooms.find(
    (r) => r.code === seat.code,
  );
  launch();
  await ready();
  let view = await api("sync", { code: seat.code, active: false }, seat.token);
  assert.equal(view.selfId, seat.selfId);
  assert.equal(view.state.modules.length, 2);
  assert.equal(
    view.state.time,
    saved.players[0].state.time,
    "hidden restored custom match must not fast-forward downtime",
  );
  assert.equal(view.state.alloy, saved.players[0].state.alloy);
  // Wait for a checkpoint after a real command, then prove abrupt process loss also recovers.
  const changed = await api(
    "command",
    { code: seat.code, command: { type: "recruit", role: "builders" } },
    seat.token,
  );
  const expectedCrew = changed.state.crew;
  for (let n = 0; n < 80; n++) {
    const snapshot = JSON.parse(await readFile(filename, "utf8"));
    if (
      snapshot.rooms.find((r) => r.code === seat.code)?.players[0].state
        .crew === expectedCrew
    )
      break;
    if (n === 79) throw Error("Periodic checkpoint did not persist command");
    await wait(100);
  }
  child.kill("SIGKILL");
  await exited;
  launch();
  await ready();
  view = await api("sync", { code: seat.code, active: false }, seat.token);
  assert.equal(view.selfId, seat.selfId);
  assert.equal(view.state.crew, expectedCrew);
  assert.equal(view.players.length, 2, "recovery must not duplicate seats");
  child.kill("SIGTERM");
  assert.equal((await exited).code, 0);
  await writeFile(filename, "corrupt snapshot");
  launch();
  const failed = await Promise.race([
    exited,
    wait(5000).then(() => {
      throw Error("Corrupt snapshot should fail startup");
    }),
  ]);
  assert.notEqual(failed.code, 0);
  assert.equal(
    await readFile(filename, "utf8"),
    "corrupt snapshot",
    "must preserve corrupt snapshot for recovery",
  );
  console.log(
    "PASS bundled server: graceful save, 0600 snapshot, same-seat restore, no offline fast-forward, periodic crash recovery, corrupt-file startup refusal",
  );
} finally {
  if (child && child.exitCode === null && !child.signalCode) {
    child.kill("SIGTERM");
    await exited;
  }
  await rm(directory, { recursive: true, force: true });
}
