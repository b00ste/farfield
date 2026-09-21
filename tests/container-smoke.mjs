// Run only on GitHub-hosted CI or an Infrastructure workspace with Docker.
// Creates its own disposable container + anonymous test volume; never targets
// the live server or any pre-existing container/volume. No wallet or real money.
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { placementError } from "../games/farfield/engine.ts";

if (
  process.env.GITHUB_ACTIONS !== "true" &&
  process.env.HIVE_WORKSPACE_PROFILE !== "infrastructure"
) {
  throw new Error(
    "Container validation belongs in GitHub Actions or an Infrastructure workspace; do not run Docker in the primary workspace.",
  );
}

const exec = promisify(execFile);
const image = process.env.CONTAINER_IMAGE || "farfield:ci";
const name = `farfield-smoke-${randomUUID()}`;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const report = {
  image,
  startedAt: new Date().toISOString(),
  checks: [],
  failure: null,
};
let created = false;
let origin;
async function docker(...args) {
  const { stdout } = await exec("docker", args, {
    timeout: 60_000,
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}
async function call(action, body, token) {
  const response = await fetch(`${origin}/api/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      `${action}: HTTP ${response.status}: ${value.error || "Request failed"}`,
    );
  return value;
}
async function healthy() {
  const until = Date.now() + 30_000;
  while (Date.now() < until) {
    try {
      const response = await fetch(`${origin}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      if (response.ok) return await response.json();
    } catch {}
    await delay(250);
  }
  throw new Error(
    "Container HTTP healthcheck did not become ready within 30 seconds",
  );
}
async function publishedOrigin() {
  const binding = await docker("port", name, "4173/tcp");
  assert.match(binding, /^127\.0\.0\.1:\d+$/);
  origin = `http://${binding}`;
}
function comparable(view) {
  const {
    alloy,
    energy,
    food,
    modules,
    workers,
    friend,
    crew,
    time,
    paused,
    phase,
  } = view.state;
  return {
    alloy,
    energy,
    food,
    modules,
    workers,
    friend,
    crew,
    time,
    paused,
    phase,
  };
}

try {
  await docker(
    "run",
    "--detach",
    "--name",
    name,
    "--init",
    "--stop-timeout",
    "30",
    "--publish",
    "127.0.0.1::4173",
    "--volume",
    "/data",
    "--env",
    "FARFIELD_STATE_PATH=/data/rooms.json",
    "--env",
    "RF_WAGERS_ENABLED=false",
    image,
  );
  created = true;
  await publishedOrigin();
  await healthy();
  const uid = await docker(
    "exec",
    name,
    "node",
    "-e",
    "console.log(process.getuid())",
  );
  assert.equal(uid, "1000");
  report.checks.push({
    name: "Production image starts as UID 1000 and serves HTTP health",
    passed: true,
  });

  const seat = await call("create", {
    friendId: "990001",
    mode: "custom",
    bots: ["easy"],
  });
  const command = (command) =>
    call("command", { code: seat.code, command }, seat.token);
  let state = (await command({ type: "start" })).state;
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
  assert.ok(placement, "Starting core must permit an adjacent passage");
  await command(placement);
  await command({ type: "recruit", role: "builders" });
  const before = await command({ type: "pause" });
  assert.equal(before.state.modules.length, 2);
  assert.equal(before.state.workers.length, 1);
  assert.equal(before.state.paused, true);
  assert.equal(before.economy.payoutsEnabled, false);

  // Observe the real five-second checkpoint interval; no injected state/time.
  await delay(6000);
  const storage = JSON.parse(
    await docker(
      "exec",
      name,
      "node",
      "-e",
      `
    const fs = require('node:fs');
    const path = '/data/rooms.json';
    const stat = fs.statSync(path);
    const snapshot = JSON.parse(fs.readFileSync(path, 'utf8'));
    console.log(JSON.stringify({ mode: stat.mode & 0o777, uid: stat.uid,
      roomCount: snapshot.rooms.length,
      persisted: snapshot.rooms.some(r => r.code === ${JSON.stringify(seat.code)}) }));
  `,
    ),
  );
  assert.deepEqual(storage, {
    mode: 0o600,
    uid: 1000,
    roomCount: 1,
    persisted: true,
  });
  report.checks.push({
    name: "Fresh volume is writable by UID 1000 and checkpoints use mode 0600",
    passed: true,
  });

  await docker("stop", "--time", "30", name);
  const exitCode = await docker(
    "inspect",
    "--format",
    "{{.State.ExitCode}}",
    name,
  );
  assert.equal(
    exitCode,
    "0",
    "Graceful shutdown must save and exit successfully",
  );
  await docker("start", name);
  await publishedOrigin();
  await healthy();
  const after = await call(
    "sync",
    { code: seat.code, active: true },
    seat.token,
  );
  assert.equal(after.code, seat.code);
  assert.equal(after.selfId, seat.selfId);
  assert.deepEqual(
    after.players.map((p) => p.id),
    before.players.map((p) => p.id),
  );
  assert.deepEqual(comparable(after), comparable(before));
  assert.equal(after.economy.payoutsEnabled, false);
  report.checks.push({
    name: "Graceful restart restores the same seat, station, worker, resources and paused clock",
    passed: true,
  });
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  if (created) {
    try {
      // Only the UUID-named container and its own anonymous ephemeral test
      // volume are removed. No shared/named/cloud volume is ever addressed.
      await docker("rm", "--force", "--volumes", name);
    } catch {
      report.failure ??= "Could not clean the disposable test container";
      process.exitCode = 1;
    }
  }
  report.finishedAt = new Date().toISOString();
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/container-smoke.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    report.failure ? "FAIL container smoke" : "PASS container smoke",
    JSON.stringify(report),
  );
}
