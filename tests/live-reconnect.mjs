// Real HTTP lifecycle integration, not browser/mobile wallet validation.
// Uses synthetic Friend IDs with the free practice API. No injected game state
// or accelerated clocks. Run against a dedicated test server or an idle queue.
import assert from "node:assert/strict";
import { mkdir, writeFile, readFile } from "node:fs/promises";

const origin = process.env.TEST_URL || "http://localhost:4173";
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const seats = [];
const report = {
  origin,
  startedAt: new Date().toISOString(),
  fixture:
    "Synthetic Friend IDs; ordinary free practice API, real server clock",
  checks: [],
  failure: null,
};

async function call(action, body, token) {
  const response = await fetch(`${origin}/api/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      `${action}: HTTP ${response.status}: ${value.error || "Request failed"}`,
    );
  return value;
}

const sync = (seat, active = false) =>
  call("sync", { code: seat.code, active }, seat.token);
async function pair(offset) {
  const prefix = BigInt(Date.now()) * 10n + BigInt(offset);
  const a = await call("matchmake", { friendId: String(prefix) });
  seats.push(a);
  assert.equal(
    a.state.phase,
    "ready",
    "Use an idle practice queue for this test",
  );
  const b = await call("matchmake", { friendId: String(prefix + 1n) });
  seats.push(b);
  assert.equal(a.code, b.code);
  assert.equal(b.state.phase, "playing");
  assert.equal(b.economy.payoutsEnabled, false);
  return [a, b];
}

try {
  if (origin === "http://localhost:4173") {
    report.build = JSON.parse(await readFile("dist/build.json", "utf8"));
  }
  const [leaver, hiddenWinner] = await pair(0);
  await sync(hiddenWinner, false);
  await call("leave", { code: leaver.code }, leaver.token);
  const winner = await sync(hiddenWinner, false);
  assert.equal(winner.winnerId, hiddenWinner.selfId);
  assert.equal(winner.state.phase, "won");
  assert.equal(
    winner.players.find((p) => p.id === leaver.selfId)?.online,
    false,
  );
  report.checks.push({
    name: "Backgrounded opponent retains the victory result after rival leaves",
    passed: true,
  });
  await call("leave", { code: hiddenWinner.code }, hiddenWinner.token);
  seats.splice(0, 2);

  const [a, b] = await pair(2);
  const before = await Promise.all([sync(a, false), sync(b, false)]);
  await delay(2500);
  const after = await Promise.all([sync(a, false), sync(b, false)]);
  const advancedSeconds = after.map(
    (s, i) => s.state.time - before[i].state.time,
  );
  assert.ok(advancedSeconds.every((seconds) => seconds >= 2));
  assert.ok(after.every((s) => s.state.phase === "playing"));
  report.checks.push({
    name: "Both backgrounded seats continue simulating",
    advancedSeconds,
    passed: true,
  });
  console.log(
    "PASS backgrounded clock and preserved winner. Disconnecting both seats for 62 real seconds.",
  );

  const disconnectedAt = Date.now();
  // Intentionally no requests from either seat during the reconnect deadline.
  await delay(30_000);
  console.log(
    "Both seats have been disconnected for 30 seconds; waiting for the server deadline.",
  );
  await delay(30_000);
  await delay(2000);
  const recovered = await Promise.all([sync(a, true), sync(b, true)]);
  for (let i = 0; i < recovered.length; i++) {
    assert.equal(recovered[i].selfId, [a, b][i].selfId);
    assert.equal(recovered[i].draw, true);
    assert.equal(recovered[i].winnerId, null);
    assert.equal(recovered[i].state.phase, "lost");
    assert.equal(recovered[i].state.elimination?.reason, "disconnect");
  }
  report.checks.push({
    name: "Actual simultaneous disconnect expires to a recoverable draw",
    elapsedMs: Date.now() - disconnectedAt,
    passed: true,
  });
  const revision = recovered[0].revision;
  await delay(1000);
  const terminal = await sync(a, true);
  assert.equal(terminal.revision, revision);
  report.checks.push({ name: "Recovered draw remains terminal", passed: true });
} catch (error) {
  report.failure = error instanceof Error ? error.message : String(error);
  process.exitCode = 1;
} finally {
  await Promise.allSettled(
    seats.map((s) => call("leave", { code: s.code }, s.token)),
  );
  report.finishedAt = new Date().toISOString();
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/live-reconnect.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    report.failure ? "FAIL lifecycle" : "PASS lifecycle",
    JSON.stringify(report),
  );
}
