import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Rooms } from "../server/rooms.ts";
import { applyCommand, tick } from "../games/farfield/engine.ts";
import { RoomStore } from "../server/room-store.ts";
import {
  createActor,
  TASK_LABELS,
  workPower,
} from "../games/farfield/actors.ts";

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "farfield-store-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  let now = 1_000_000;
  const filename = join(directory, "private", "rooms.json");
  const store = new RoomStore(filename, {
    webRoot: join(directory, "web"),
    now: () => now,
  });
  const rooms = new Rooms();
  const seat = rooms.create("123", now, "normal", "custom", ["normal"]);
  rooms.command(seat.code, seat.token, { type: "start" }, now);
  return {
    directory,
    filename,
    store,
    rooms,
    seat,
    setNow(value: number) {
      now = value;
    },
  };
}

test("rooms recover tokens, commands, fog, paused state and shared references without advancing offline time", async (t) => {
  const f = await fixture(t);
  assert.equal((await f.store.load()).size, 0);
  const room = f.rooms.rooms.get(f.seat.code)!;
  const player = room.players[0];
  player.state.paused = true;
  player.state.time = 43.5;
  player.state.friend.path = [
    { x: player.state.friend.x + 1, y: player.state.friend.y },
  ];
  player.state.friend.targetId = null;
  player.state.friend.order = "idle";
  player.state.workers.push({
    ...createActor(),
    id: 600,
    role: "builders",
    targetId: null,
  });
  player.discovered = [room.players[1].id];
  player.seen = {
    [room.players[1].state.modules[0].id]: structuredClone(
      room.players[1].state.modules[0],
    ),
  };
  room.revision = 70;
  await f.store.save(f.rooms.rooms);
  const disk = JSON.parse(await readFile(f.filename, "utf8"));
  assert.equal(disk.version, 1);
  assert.equal((await stat(f.filename)).mode & 0o777, 0o600);
  assert.equal((await stat(join(f.directory, "private"))).mode & 0o777, 0o700);
  f.setNow(1_030_000);
  const restored = (await f.store.load()).get(f.seat.code)!;
  assert.equal(restored.revision, 71);
  assert.equal(restored.players[0].token, f.seat.token);
  assert.equal(restored.players[0].state.time, 43.5);
  assert.equal(restored.players[0].state.paused, true);
  assert.deepEqual(
    restored.players[0].state.friend,
    JSON.parse(JSON.stringify(player.state.friend)),
  );
  assert.deepEqual(restored.players[0].state.workers, player.state.workers);
  assert.deepEqual(restored.players[0].discovered, player.discovered);
  assert.deepEqual(restored.players[0].seen, player.seen);
  assert.ok(restored.players.every((p) => !p.active));
  assert.equal(restored.players[0].lastSeen, 1_030_000);
  assert.equal(restored.players[0].state.monoliths, restored.monoliths);
  assert.equal(restored.players[0].state.hold, restored.hold);
  assert.ok(
    restored.players[0].state.terrain!.includes(
      restored.players[1].state.modules[0],
    ),
  );
  const recovered = new Rooms();
  recovered.rooms.set(restored.code, restored);
  recovered.advance(0.1, 1_030_100);
  assert.equal(
    restored.players[0].state.time,
    43.5,
    "custom room waits for a real active client",
  );
  assert.equal(
    recovered.access(restored.code, f.seat.token, 1_030_200).player.id,
    player.id,
  );
});

test("infirmary rest and medic assignments survive room recovery", async (t) => {
  const f = await fixture(t);
  const player = f.rooms.rooms.get(f.seat.code)!.players[0];
  const cell = { x: player.state.spawn!.x + 2, y: player.state.spawn!.y };
  player.state.modules.push({
    id: 900,
    type: "infirmary",
    cells: [cell],
    progress: 1,
    owner: player.id,
  });
  Object.assign(player.state.friend, {
    ...cell,
    targetId: 900,
    order: "work",
    task: "rest",
    working: true,
  });
  player.state.workers.push({
    ...createActor(),
    ...cell,
    id: 901,
    role: "medics",
    targetId: 900,
    order: "work",
    task: "medics",
    working: true,
  });
  await f.store.save(f.rooms.rooms);
  const restored = (await f.store.load()).get(f.seat.code)!.players[0].state;
  assert.equal(restored.friend.task, "rest");
  assert.equal(TASK_LABELS[restored.friend.task], "Resting at infirmary");
  assert.equal(restored.friend.targetId, 900);
  assert.equal(restored.workers[0].targetId, 900);
  assert.equal(workPower(restored, "medics", 900), 1);
});

test("recruitment progress and shortage survive restart without charging twice or advancing downtime", async (t) => {
  const f = await fixture(t);
  const state = f.rooms.rooms.get(f.seat.code)!.players[0].state;
  applyCommand(state, { type: "recruit", role: "builders" });
  for (let i = 0; i < 30; i++) tick(state, 0.1);
  state.foodShortage = 0.6;
  const order = structuredClone(state.recruitQueue![0]),
    alloy = state.alloy,
    food = state.food;
  await f.store.save(f.rooms.rooms);
  f.setNow(1_030_000);
  const restored = (await f.store.load()).get(f.seat.code)!.players[0].state;
  assert.deepEqual(restored.recruitQueue, [order]);
  assert.equal(restored.foodShortage, 0.6);
  assert.equal(restored.alloy, alloy);
  assert.equal(restored.food, food);
  for (let i = 0; i < 30; i++) tick(restored, 0.1);
  assert.equal(restored.workers.length, 1);
  assert.equal(restored.workers[0].id, order.id);
  assert.equal(restored.recruitQueue!.length, 0);
});
test("legacy snapshots initialize the economy fields and malformed queued orders are rejected", async (t) => {
  const f = await fixture(t);
  await f.store.save(f.rooms.rooms);
  const snapshot = JSON.parse(await readFile(f.filename, "utf8"));
  for (const player of snapshot.rooms[0].players) {
    delete player.state.recruitQueue;
    delete player.state.foodShortage;
  }
  await writeFile(f.filename, JSON.stringify(snapshot));
  const restored = (await f.store.load()).get(f.seat.code)!;
  for (const player of restored.players) {
    assert.deepEqual(player.state.recruitQueue, []);
    assert.equal(player.state.foodShortage, 0);
  }
  snapshot.rooms[0].players[0].state.recruitQueue = [
    { id: 42, role: "builders", moduleId: null, progress: 2 },
  ];
  await writeFile(f.filename, JSON.stringify(snapshot));
  await assert.rejects(f.store.load(), /recruitment order/);
});

test("restarted free online matches grant a fresh reconnect window", async (t) => {
  const f = await fixture(t);
  const room = f.rooms.rooms.get(f.seat.code)!;
  room.mode = "online";
  room.players[1].bot = false;
  room.players[1].token = "b".repeat(48);
  await f.store.save(f.rooms.rooms);
  f.setNow(1_300_000);
  const recovered = new Rooms();
  recovered.rooms = await f.store.load();
  const restored = recovered.rooms.get(room.code)!;
  recovered.advance(0.1, 1_359_000);
  assert.ok(restored.players.every((p) => p.state.phase === "playing"));
  assert.ok(
    restored.players[0].state.time < 1,
    "downtime did not fast-forward simulation",
  );
  recovered.advance(0.1, 1_361_000);
  assert.equal(
    restored.draw,
    true,
    "ordinary reconnect timeout still applies after the new grace period",
  );
});

test("expired rooms are excluded on save and load", async (t) => {
  const f = await fixture(t);
  const original = f.rooms.rooms.get(f.seat.code)!;
  const expired = structuredClone(original);
  expired.code = "AAAAAAAAAA";
  expired.touched -= 7_200_001;
  f.rooms.rooms.set(expired.code, expired);
  await f.store.save(f.rooms.rooms);
  const disk = JSON.parse(await readFile(f.filename, "utf8"));
  assert.deepEqual(
    disk.rooms.map((r: { code: string }) => r.code),
    [original.code],
  );
  disk.rooms.push(expired);
  await writeFile(f.filename, JSON.stringify(disk));
  assert.deepEqual([...(await f.store.load()).keys()], [original.code]);
});

test("corrupt JSON, unsupported versions and malformed engine state fail clearly and leave snapshots intact", async (t) => {
  const f = await fixture(t);
  await f.store.save(f.rooms.rooms);
  const valid = JSON.parse(await readFile(f.filename, "utf8"));
  const badState = structuredClone(valid);
  badState.rooms[0].players[0].state.friend.path = [null];
  for (const [payload, expected] of [
    ["{broken", /malformed JSON/],
    [JSON.stringify({ ...valid, version: 99 }), /unsupported version/],
    [JSON.stringify(badState), /point/],
    [JSON.stringify({ ...valid, rooms: [null] }), /room/],
  ] as const) {
    await writeFile(f.filename, payload);
    await assert.rejects(f.store.load(), expected);
    assert.equal(await readFile(f.filename, "utf8"), payload);
  }
});

test("concurrent saves are atomic, serialized in call order, and capture state at call time", async (t) => {
  const f = await fixture(t);
  const room = f.rooms.rooms.get(f.seat.code)!;
  await f.store.save(f.rooms.rooms);
  let reading = true;
  const reader = (async () => {
    while (reading) {
      const snapshot = JSON.parse(await readFile(f.filename, "utf8"));
      assert.equal(snapshot.version, 1);
      assert.equal(snapshot.rooms.length, 1);
    }
  })();
  const saves: Promise<void>[] = [];
  for (let revision = 1; revision <= 20; revision++) {
    room.revision = revision;
    saves.push(f.store.save(f.rooms.rooms));
  }
  room.revision = 999;
  try {
    await Promise.all(saves);
  } finally {
    reading = false;
    await reader;
  }
  const snapshot = JSON.parse(await readFile(f.filename, "utf8"));
  assert.equal(snapshot.rooms[0].revision, 20);
  assert.deepEqual(await readdir(join(f.directory, "private")), ["rooms.json"]);
});

test("unsafe web-root paths and failed writes are reported", async (t) => {
  const f = await fixture(t);
  assert.throws(() => new RoomStore("relative.json"), /absolute/);
  assert.throws(
    () =>
      new RoomStore(join(f.directory, "web", "secret.json"), {
        webRoot: join(f.directory, "web"),
      }),
    /outside/,
  );
  await writeFile(join(f.directory, "not-a-directory"), "occupied");
  const store = new RoomStore(
    join(f.directory, "not-a-directory", "rooms.json"),
  );
  await assert.rejects(store.save(f.rooms.rooms));
  await assert.rejects(
    store.save(f.rooms.rooms),
    "a failed write must not silently swallow subsequent failures",
  );
});
