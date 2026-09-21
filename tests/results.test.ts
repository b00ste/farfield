import test from "node:test";
import assert from "node:assert/strict";
import { Rooms } from "../server/rooms.ts";
import { matchResult } from "../games/farfield/results.ts";
function match(bots = 1) {
  const rooms = new Rooms(),
    a = rooms.create("1", 1000, "normal", "custom", Array(bots).fill("normal"));
  rooms.command(a.code, a.token, { type: "start" }, 1000);
  const room = rooms.rooms.get(a.code)!;
  return { rooms, a, room, view: () => rooms.view(room, a.token, 1000) };
}
test("core destruction result names the attacker and winner", () => {
  const { rooms, room, view } = match();
  room.players[0].state.integrity = 0.1;
  room.players[0].state.enemies.push({
    id: 999,
    x: 0,
    y: 0,
    hp: 100,
    maxHp: 100,
    sourceName: room.players[1].name,
  });
  rooms.advance(0.1, 1000);
  const result = matchResult(view());
  assert.equal(result.title, "Defeat");
  assert.equal(result.winner, `Winner: ${room.players[1].name}`);
  assert.equal(result.reason, `${room.players[1].name} destroyed your core.`);
});
test("monolith victory explains the objective and does not claim core destruction", () => {
  const { rooms, room, view } = match();
  room.monoliths!.forEach((m) => {
    m.ownerId = room.players[1].id;
    m.progress = 100;
  });
  room.hold = {
    ownerId: room.players[1].id,
    name: room.players[1].name,
    seconds: 59.95,
  };
  rooms.advance(0.1, 1000);
  assert.equal(view().state.integrity, 100);
  assert.equal(
    matchResult(view()).reason,
    `${room.players[1].name} held all four monoliths for 60 seconds.`,
  );
});
test("forfeit distinguishes elimination from a concluded multiplayer match", () => {
  for (const bots of [1, 2]) {
    const { rooms, a, view } = match(bots);
    rooms.command(a.code, a.token, { type: "forfeit" }, 1000);
    assert.equal(matchResult(view()).reason, "You forfeited the match.");
    assert.equal(
      matchResult(view()).title,
      bots === 1 ? "Defeat" : "Eliminated",
    );
    if (bots === 2)
      assert.equal(
        matchResult(view()).winner,
        "Match continues · no winner yet",
      );
  }
});
test("own victory and online disconnect state are explicit", () => {
  const { rooms, room, view } = match();
  room.monoliths!.forEach((m) => {
    m.ownerId = room.players[0].id;
    m.progress = 100;
  });
  room.hold = {
    ownerId: room.players[0].id,
    name: room.players[0].name,
    seconds: 59.95,
  };
  rooms.advance(0.1, 1000);
  assert.deepEqual(matchResult(view()), {
    title: "Victory",
    winner: "You won",
    reason: "You held all four monoliths for 60 seconds.",
  });
  const second = match();
  second.room.mode = "online";
  second.room.players[1].bot = false;
  second.room.players[1].lastSeen = 62001;
  second.rooms.advance(0.1, 62001);
  assert.equal(
    matchResult(second.view()).reason,
    "You were disconnected for more than 60 seconds.",
  );
});
