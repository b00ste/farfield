import test from "node:test";
import assert from "node:assert/strict";
import { Rooms } from "../server/rooms.ts";
import { routeTo, resetOrder } from "../games/farfield/actors.ts";
import { floorTo } from "./floor-fixture.ts";
import { syncTerrain } from "../server/battlefield.ts";
test("shared battlefield hides enemy coordinates and does not reveal a full base after contact", () => {
  const rooms = new Rooms(),
    a = rooms.create("1", 1000, "normal", "custom", []),
    b = rooms.join(a.code, "2", 1000);
  rooms.command(a.code, a.token, { type: "start" }, 1000);
  const room = rooms.rooms.get(a.code)!,
    [own, enemy] = room.players;
  const view = () => rooms.view(room, a.token, 1000);
  assert.equal(view().opponents[0].state, null);
  assert.equal(view().opponents[0].discovered, false);
  assert.equal(
    view().state.terrain!.some((m) => m.owner === enemy.id),
    false,
  );
  assert.equal(view().state.visibleUnits!.length, 0);
  assert.throws(
    () =>
      rooms.command(
        a.code,
        a.token,
        {
          type: "attack",
          target: enemy.id,
          moduleId: enemy.state.modules[0].id,
        },
        1000,
      ),
    /Explore/,
  );
  assert.throws(
    () => rooms.command(a.code, a.token, { type: "capture", index: 0 }, 1000),
    /completed path/,
  );
  floorTo(own.state, enemy.state.spawn!);
  syncTerrain(room);
  rooms.command(
    a.code,
    a.token,
    { type: "direct", ...enemy.state.spawn!, task: "move" },
    1000,
  );
  for (let i = 0; i < 600 && !own.discovered.includes(enemy.id); i++)
    rooms.advance(0.1, 1000);
  assert.ok(own.discovered.includes(enemy.id));
  assert.ok(view().state.terrain!.some((m) => m.owner === enemy.id));
  assert.equal(
    view().opponents[0].state,
    null,
    "discovery never reveals full live enemy economy or layout",
  );
  resetOrder(own.state.friend, null, "idle");
  Object.assign(own.state.friend, own.state.spawn);
  enemy.state.modules.push({
    id: enemy.state.nextId++,
    type: "foundry",
    cells: [{ x: enemy.state.spawn!.x, y: enemy.state.spawn!.y + 2 }],
    progress: 1,
    owner: enemy.id,
  });
  assert.ok(
    !view().state.terrain!.some((m) => m.type === "foundry"),
    "new hidden construction remains private",
  );
  assert.equal(
    view().state.visibleUnits!.length,
    0,
    "moving units disappear outside current sight",
  );
});
test("AI builds real paths and captures shared monoliths in person without flying raids", () => {
  const rooms = new Rooms(),
    a = rooms.create("1", 1000, "normal", "custom", ["hard"]);
  rooms.command(a.code, a.token, { type: "start" }, 1000);
  const room = rooms.rooms.get(a.code)!,
    bot = room.players[1];
  let captured = false;
  for (let i = 0; i < 1800; i++) {
    rooms.advance(0.5, 1000);
    assert.ok(
      routeTo(bot.state, bot.state.spawn!, [
        {
          x: Math.round(bot.state.friend.x),
          y: Math.round(bot.state.friend.y),
        },
      ]),
      "AI stays on connected flooring",
    );
    assert.ok(
      bot.state.alloy >= 0 && bot.state.energy >= 0 && bot.state.food >= 0,
    );
    if (room.monoliths!.some((m) => m.ownerId === bot.id)) {
      captured = true;
      break;
    }
  }
  assert.ok(captured, "AI must reach and capture an actual shared objective");
  assert.equal(room.players[0].state.enemies.length, 0);
  assert.ok(bot.state.modules.length > 5);
});
