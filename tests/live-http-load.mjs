// Real HTTP load, separate from browser/FPS measurements. No state injection.
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
const origin = process.env.TEST_URL || "http://localhost:4173";
const roomCount = Number(process.env.LOAD_ROOMS || 4);
const seats = [],
  times = [],
  errors = [];
async function call(action, body, token) {
  const start = performance.now();
  const r = await fetch(origin + "/api/" + action, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: "Bearer " + token } : {}),
    },
    body: JSON.stringify(body),
  });
  const v = await r.json();
  times.push(performance.now() - start);
  if (!r.ok)
    errors.push({ status: r.status, action, error: v.error ?? v.message ?? v });
  return v;
}
try {
  for (let room = 0; room < roomCount; room++) {
    const host = await call("create", {
      friendId: String(10000 + room * 4),
      mode: "custom",
      bots: [],
    });
    assert.ok(host.token);
    seats.push(host);
    for (let i = 1; i < 4; i++) {
      const seat = await call("join", {
        code: host.code,
        friendId: String(10000 + room * 4 + i),
      });
      assert.ok(seat.token);
      seats.push(seat);
    }
    await call(
      "command",
      { code: host.code, command: { type: "start" } },
      host.token,
    );
  }
  const began = Date.now();
  let rounds = 0;
  while (Date.now() - began < 20000) {
    const round = Date.now();
    await Promise.all(
      seats.map((s) => call("sync", { code: s.code, active: true }, s.token)),
    );
    rounds++;
    await new Promise((r) =>
      setTimeout(r, Math.max(0, 250 - (Date.now() - round))),
    );
  }
  if (errors.length) console.error(JSON.stringify(errors.slice(0, 8)));

  times.sort((a, b) => a - b);
  const report = {
    seats: seats.length,
    rooms: roomCount,
    seconds: (Date.now() - began) / 1000,
    syncRequests: rounds * seats.length,
    errors,
    p95Ms: times[Math.floor(times.length * 0.95)],
  };
  await writeFile(
    "artifacts/live-http-load.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    errors.length ? "FAIL HTTP load" : "PASS HTTP load",
    JSON.stringify({
      ...report,
      errors: errors.slice(0, 3),
      errorCount: errors.length,
    }),
  );
  assert.equal(
    errors.length,
    0,
    "HTTP load returned errors; see artifacts/live-http-load.json",
  );
} finally {
  await Promise.all(seats.map((s) => call("leave", { code: s.code }, s.token)));
}
