import { floorTo } from "./floor-fixture.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { Rooms } from "../server/rooms.ts";
import { createState, applyCommand, tick } from "../games/farfield/engine.ts";
function advance(s: ReturnType<typeof createState>, seconds: number) {
  for (let i = 0; i < seconds * 10; i++) tick(s, 0.1);
}
test("custom matches mix humans and up to three AI, with host-only edits before launch", () => {
  const rooms = new Rooms();
  const a = rooms.create("1", 1000, "normal", "custom", [
    "easy",
    "hard",
    "normal",
  ]);
  assert.equal(a.players.length, 4);
  assert.equal(a.maxPlayers, 4);
  assert.throws(() => rooms.join(a.code, "2", 1000), /slots/);
  assert.throws(
    () => rooms.create("9", 1000, "normal", "custom", Array(4).fill("normal")),
    /up to three/,
  );
  assert.throws(
    () =>
      rooms.command(
        a.code,
        a.token,
        { type: "bot-add", difficulty: "normal" },
        1000,
      ),
    /Four commanders/,
  );
  rooms.command(
    a.code,
    a.token,
    { type: "bot-remove", target: a.opponents[0].id },
    1000,
  );
  const b = rooms.join(a.code, "2", 1000);
  assert.equal(b.players.length, 4);
  assert.throws(
    () =>
      rooms.command(
        a.code,
        b.token,
        { type: "bot-remove", target: a.opponents[1].id },
        1000,
      ),
    /host/,
  );
  rooms.command(a.code, a.token, { type: "start" }, 1000);
  assert.throws(
    () =>
      rooms.command(
        a.code,
        a.token,
        { type: "bot-add", difficulty: "normal" },
        1000,
      ),
    /before launch/,
  );
  assert.equal(
    rooms.view(rooms.rooms.get(a.code)!, b.token, 1000).state.phase,
    "playing",
  );
});
test("matchmaking pairs separate humans, starts atomically, blocks pause and settles forfeits", () => {
  const rooms = new Rooms();
  const a = rooms.matchmake("1", 1000);
  assert.equal(a.state.phase, "ready");
  assert.throws(() => rooms.matchmake("1", 1001), /already searching/);
  const b = rooms.matchmake("2", 1001);
  assert.equal(a.code, b.code);
  assert.equal(b.state.phase, "playing");
  assert.equal(b.economy.payoutsEnabled, false);
  assert.throws(
    () => rooms.command(a.code, a.token, { type: "pause" }, 1001),
    /cannot be paused/,
  );
  const lost = rooms.command(a.code, a.token, { type: "forfeit" }, 1001);
  assert.equal(lost.state.phase, "lost");
  assert.equal(lost.winnerId, b.selfId);
  assert.equal(
    rooms.view(rooms.rooms.get(a.code)!, b.token, 1001).state.phase,
    "won",
  );
});
test("cancelled or stale matchmaking seats cannot be paired and active disconnects forfeit", () => {
  const rooms = new Rooms();
  const cancelled = rooms.matchmake("1", 1000);
  rooms.leave(cancelled.code, cancelled.token, 1001);
  assert.equal(rooms.rooms.size, 0);
  const stale = rooms.matchmake("1", 2000);
  const a = rooms.matchmake("2", 11000);
  assert.notEqual(a.code, stale.code);
  const b = rooms.matchmake("3", 11001);
  rooms.access(b.code, b.token, 72000);
  rooms.advance(0.1, 72000);
  assert.equal(
    rooms.view(rooms.rooms.get(a.code)!, b.token, 72000).winnerId,
    b.selfId,
  );
});
test("starting cores no longer have bonus resource deposits", () => {
  const rooms = new Rooms(),
    a = rooms.create("1", 1000, "normal", "custom", ["normal", "hard"]);
  assert.ok(
    rooms.rooms
      .get(a.code)!
      .players.every((p) => p.state.deposits.length === 0),
  );
});

test("online play continues with backgrounded tabs and reconnects keep the same seat", () => {
  const rooms = new Rooms();
  const a = rooms.matchmake("1", 1000);
  const b = rooms.matchmake("2", 1001);
  const room = rooms.rooms.get(a.code)!;
  for (const p of room.players) p.active = false;
  rooms.advance(0.5, 2000);
  assert.ok(room.players.every((p) => p.state.time === 0.5));

  // Both connections can disappear briefly without freezing the simulation
  // or recreating either station on recovery.
  rooms.advance(0.5, 30_000);
  assert.ok(room.players.every((p) => p.state.time === 1));
  const recovered = rooms.access(a.code, a.token, 30_001);
  assert.equal(recovered.player.id, a.selfId);
  assert.equal(recovered.player.state.phase, "playing");
  assert.equal(recovered.player.state.time, 1);
  rooms.access(b.code, b.token, 30_001);
  rooms.advance(0.5, 61_002);
  assert.ok(room.players.every((p) => p.state.phase === "playing"));
});

test("online disconnect expiry settles even with no active viewers and a draw stays terminal", () => {
  const rooms = new Rooms();
  const a = rooms.matchmake("1", 1000);
  rooms.matchmake("2", 1001);
  const room = rooms.rooms.get(a.code)!;
  for (const p of room.players) p.active = false;
  rooms.advance(0.1, 61_002);
  assert.equal(room.draw, true);
  assert.equal(room.winnerId, null);
  assert.ok(
    room.players.every(
      (p) =>
        p.state.phase === "lost" &&
        p.state.elimination?.reason === "disconnect",
    ),
  );
  const revision = room.revision;
  const recovered = rooms.access(a.code, a.token, 62_000);
  recovered.player.active = true;
  assert.equal(rooms.view(room, a.token, 62_000).draw, true);
  rooms.advance(0.5, 62_001);
  assert.equal(room.revision, revision);
});

test("an online backgrounded opponent still wins when the other seat times out", () => {
  const rooms = new Rooms();
  const a = rooms.matchmake("1", 1000);
  const b = rooms.matchmake("2", 1001);
  const room = rooms.rooms.get(a.code)!;
  for (const p of room.players) p.active = false;
  rooms.access(b.code, b.token, 60_000);
  rooms.advance(0.1, 61_002);
  assert.equal(room.winnerId, b.selfId);
  assert.equal(
    rooms.view(room, a.token, 61_002).state.elimination?.reason,
    "disconnect",
  );
});

test("leaving an online match preserves the result for a backgrounded opponent", () => {
  const rooms = new Rooms();
  const a = rooms.matchmake("1", 1000);
  const b = rooms.matchmake("2", 1001);
  const room = rooms.rooms.get(a.code)!;
  rooms.access(b.code, b.token, 1002).player.active = false;
  rooms.leave(a.code, a.token, 1003);
  assert.equal(rooms.rooms.get(a.code), room);
  assert.throws(() => rooms.access(a.code, a.token, 1004), /expired/);
  rooms.access(b.code, b.token, 1004);
  const result = rooms.view(room, b.token, 1004);
  assert.equal(result.state.phase, "won");
  assert.equal(result.winnerId, b.selfId);
  assert.equal(result.players.find((p) => p.id === a.selfId)?.online, false);
  rooms.leave(b.code, b.token, 1005);
  assert.equal(rooms.rooms.has(a.code), false);
});

test("custom matches retain backgrounded commanders and transfer a departed host immediately", () => {
  const rooms = new Rooms();
  const a = rooms.create("1", 1000, "normal", "custom", ["easy"]);
  const b = rooms.join(a.code, "2", 1001);
  rooms.command(a.code, a.token, { type: "start" }, 1002);
  const room = rooms.rooms.get(a.code)!;
  rooms.access(b.code, b.token, 1003).player.active = false;
  rooms.leave(a.code, a.token, 1004);
  assert.equal(rooms.rooms.get(a.code), room);
  assert.equal(room.winnerId, null);
  rooms.access(b.code, b.token, 1005);
  assert.equal(room.host, b.token);
  assert.equal(
    rooms.command(b.code, b.token, { type: "pause" }, 1006).state.paused,
    true,
  );
});
