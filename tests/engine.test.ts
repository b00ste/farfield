import test from "node:test";
import assert from "node:assert/strict";
import {
  createState,
  applyCommand,
  tick,
  rotated,
  placementError,
  key,
  type State,
  nextObjective,
  housing,
  workPower,
} from "../games/farfield/engine.ts";
import { Rooms } from "../server/rooms.ts";
const advance = (s: State, seconds: number) => {
  for (let i = 0; i < seconds * 10; i++) tick(s, 0.1);
};
test("starting station is connected with no overlapping cells", () => {
  const cells = createState().modules.flatMap((m) => m.cells);
  assert.equal(new Set(cells.map(key)).size, cells.length);
  const remaining = new Set(cells.map(key)),
    queue = [cells[0]];
  remaining.delete(key(cells[0]));
  while (queue.length) {
    const p = queue.shift()!;
    for (const n of [
      { x: p.x + 1, y: p.y },
      { x: p.x - 1, y: p.y },
      { x: p.x, y: p.y + 1 },
      { x: p.x, y: p.y - 1 },
    ])
      if (remaining.delete(key(n))) queue.push(n);
  }
  assert.equal(remaining.size, 0);
});
test("all tetromino rotations preserve four unique contiguous cells and normalize origin", () => {
  for (let s = 0; s < 7; s++)
    for (let r = 0; r < 4; r++) {
      const cells = rotated(s, r);
      assert.equal(new Set(cells.map(key)).size, 4);
      assert.equal(Math.min(...cells.map((p) => p.x)), 0);
      assert.equal(Math.min(...cells.map((p) => p.y)), 0);
    }
});
test("placements reject overlap, void, monolith footprint, bounds, and insufficient resources", () => {
  const s = createState();
  assert.match(placementError(s, "passage", 1, 0, 0, 0)!, /occupied/);
  assert.match(placementError(s, "passage", 1, 0, 10, 10)!, /Connect/);
  assert.match(placementError(s, "passage", 1, 0, 0, 18)!, /monolith/);
  assert.match(placementError(s, "passage", 1, 0, 41, 41)!, /boundary/);
  s.alloy = 0;
  assert.match(placementError(s, "passage", 2, 0, -1, 1)!, /enough/);
});
test("one station piece is charged once; a stale duplicate placement is rejected", () => {
  const s = createState();
  applyCommand(s, { type: "start" });
  const command = {
    type: "build",
    room: "passage",
    shape: s.nextShape,
    rotation: 0,
    x: -1,
    y: 1,
  } as const;
  assert.equal(applyCommand(s, command), null);
  assert.equal(s.alloy, 61);
  assert.equal(s.modules.length, 2);
  assert.notEqual(applyCommand(s, command), null);
  assert.equal(s.alloy, 61);
  advance(s, 5);
  assert.equal(s.modules.at(-1)!.progress, 1);
});
test("roles conserve crew and require completed capacity", () => {
  const s = createState();
  applyCommand(s, { type: "start" });
  assert.match(
    applyCommand(s, { type: "recruit", role: "scientists" })!,
    /workplace/,
  );
  assert.equal(
    applyCommand(s, {
      type: "build",
      room: "garden",
      shape: s.nextShape,
      rotation: 0,
      x: -1,
      y: 1,
    }),
    null,
  );
  advance(s, 5);
  assert.equal(applyCommand(s, { type: "recruit", role: "builders" }), null);
  assert.equal(
    applyCommand(s, { type: "assign", role: "farmers", delta: 1 }),
    null,
  );
  assert.equal(
    Object.values(s.roles).reduce((a, b) => a + b, 0),
    s.crew,
  );
  assert.equal(s.roles.builders, 0);
  assert.notEqual(
    applyCommand(s, { type: "assign", role: "farmers", delta: 100 }),
    null,
  );
});
test("quarters add worker beds without automatically spawning helpers", () => {
  const s = createState();
  applyCommand(s, { type: "start" });
  assert.equal(
    applyCommand(s, {
      type: "build",
      room: "habitat",
      shape: s.nextShape,
      rotation: 0,
      x: -1,
      y: 1,
    }),
    null,
  );
  assert.equal(s.food, 40);
  assert.equal(s.crew, 0);
  assert.equal(housing(s), 2);
  advance(s, 5);
  assert.equal(s.crew, 0);
  assert.equal(housing(s), 6);
  const food = s.food,
    alloy = s.alloy;
  assert.equal(applyCommand(s, { type: "recruit", role: "builders" }), null);
  assert.equal(s.crew, 1);
  assert.equal(s.food, food - 8);
  assert.equal(s.alloy, alloy - 6);
});
test("pause stops time, resources, attacks, construction, and rejects builds", () => {
  const s = createState();
  applyCommand(s, { type: "start" });
  applyCommand(s, { type: "pause" });
  const before = JSON.stringify(s);
  advance(s, 100);
  assert.equal(JSON.stringify(s), before);
  assert.match(
    applyCommand(s, {
      type: "build",
      room: "passage",
      shape: s.nextShape,
      rotation: 0,
      x: -1,
      y: 1,
    })!,
    /paused/,
  );
});
test("attacks spawn, guards shoot, and an undefended core can lose", () => {
  const s = createState();
  applyCommand(s, { type: "start" });
  advance(s, s.nextWave + 1);
  assert.equal(s.wave, 1);
  assert.ok(s.enemies.length > 0);
  s.modules.push({
    id: 100,
    type: "turret",
    cells: [{ x: -1, y: 1 }],
    progress: 1,
    owner: "test",
  });
  applyCommand(s, { type: "direct", x: -1, y: 1 });
  advance(s, 1);
  const e = s.enemies[0];
  e.x = -1;
  e.y = 8;
  const hp = e.hp;
  tick(s, 0.5);
  assert.ok(e.hp < hp);
  s.roles.guards = 0;
  s.enemies = [{ id: 500, x: 0, y: 0, hp: 1000, maxHp: 1000 }];
  advance(s, 40);
  assert.equal(s.phase, "lost");
  assert.equal(s.integrity, 0);
});
test("reaching all four monoliths and researching wins; reach alone does not", () => {
  const s = createState();
  applyCommand(s, { type: "start" });
  s.nextWave = 10000;
  s.monoliths.forEach((m, i) =>
    s.modules.push({
      id: 100 + i,
      type: "passage",
      cells: [{ x: m.x + 2, y: m.y }],
      progress: 1,
      owner: "test",
    }),
  );
  advance(s, 2);
  assert.ok(s.monoliths.every((m) => m.connected && m.progress === 0));
  s.modules.push({
    id: 200,
    type: "lab",
    cells: [{ x: 1, y: 0 }],
    progress: 1,
    owner: "test",
  });
  applyCommand(s, { type: "direct", x: 1, y: 0 });
  advance(s, 36);
  assert.equal(s.phase, "won");
  assert.ok(s.monoliths.every((m) => m.progress === 100));
});
test("repair respects cost and caps integrity", () => {
  const s = createState();
  applyCommand(s, { type: "start" });
  s.integrity = 95;
  assert.equal(applyCommand(s, { type: "repair" }), null);
  assert.equal(s.integrity, 100);
  assert.equal(s.alloy, 53);
  assert.notEqual(applyCommand(s, { type: "repair" }), null);
  assert.equal(s.alloy, 53);
});
test("PvP rooms keep stations and resources separate and restrict host commands", () => {
  const rooms = new Rooms(),
    a = rooms.create("10", Date.now(), "normal", "pvp"),
    b = rooms.join(a.code, "11");
  assert.throws(() => rooms.access(a.code, "invalid"), /expired/);
  assert.throws(
    () => rooms.command(a.code, b.token, { type: "start" }),
    /host/,
  );
  rooms.command(a.code, a.token, { type: "start" });
  const bs = rooms.access(a.code, b.token).player.state;
  const valid = bs.modules
    .flatMap((m) => m.cells)
    .flatMap((p) => [
      { x: p.x + 1, y: p.y },
      { x: p.x - 2, y: p.y },
      { x: p.x, y: p.y + 1 },
      { x: p.x, y: p.y - 2 },
    ])
    .find((p) => !placementError(bs, "passage", 1, 0, p.x, p.y))!;
  rooms.command(a.code, b.token, {
    type: "build",
    room: "passage",
    shape: a.state.nextShape,
    rotation: 0,
    x: valid.x,
    y: valid.y,
  });
  assert.equal(rooms.access(a.code, a.token).player.state.modules.length, 1);
  assert.equal(rooms.access(a.code, b.token).player.state.modules.length, 2);
  assert.ok(
    !JSON.stringify(rooms.view(rooms.rooms.get(a.code)!, a.token)).includes(
      b.token,
    ),
  );
});
test("rooms have four seats, expire, and sleep when all players are inactive", () => {
  const rooms = new Rooms(),
    a = rooms.create("10", 1000, "normal", "pvp");
  rooms.join(a.code, "11", 1000);
  rooms.join(a.code, "12", 1000);
  rooms.join(a.code, "13", 1000);
  assert.throws(() => rooms.join(a.code, "14", 1000), /slots/);
  rooms.command(a.code, a.token, { type: "start" }, 1000);
  rooms.advance(0.5, 1001);
  assert.equal(rooms.rooms.get(a.code)!.players[0].state.time, 0.5);
  rooms.advance(0.5, 10000);
  assert.equal(rooms.rooms.get(a.code)!.players[0].state.time, 0.5);
  rooms.clean(7_201_001);
  assert.equal(rooms.rooms.size, 0);
});
test("host privileges migrate when the original host is disconnected", () => {
  const rooms = new Rooms(),
    a = rooms.create("10", 1000, "normal", "pvp"),
    b = rooms.join(a.code, "11", 1000);
  rooms.access(a.code, b.token, 17000);
  assert.equal(rooms.rooms.get(a.code)!.host, b.token);
  assert.equal(
    rooms.command(a.code, b.token, { type: "start" }, 17000).state.phase,
    "playing",
  );
});
test("opening starts with only a core and guides production before combat", () => {
  const s = createState();
  assert.deepEqual(
    s.modules.map((m) => m.type),
    ["core"],
  );
  assert.equal(s.crew, 0);
  assert.equal(s.roles.builders, 0);
  assert.equal(nextObjective(s).module, "foundry");
  applyCommand(s, { type: "start" });
  assert.equal(
    applyCommand(s, {
      type: "build",
      room: "foundry",
      shape: s.nextShape,
      rotation: 0,
      x: -1,
      y: 1,
    }),
    null,
  );
  advance(s, 5);
  assert.equal(nextObjective(s).role, "miners");
  assert.equal(applyCommand(s, { type: "recruit", role: "miners" }), null);
  assert.equal(nextObjective(s).module, "solar");
  advance(s, 110);
  assert.equal(s.wave, 0);
  assert.ok(s.food > 0);
});
test("difficulty changes preparation time and enemy strength", () => {
  const easy = createState(1, "easy"),
    hard = createState(1, "hard");
  assert.ok(easy.nextWave > hard.nextWave);
  for (const s of [easy, hard]) {
    applyCommand(s, { type: "start" });
    advance(s, s.nextWave + 1);
  }
  assert.ok(hard.enemies.length > easy.enemies.length);
  assert.ok(hard.enemies[0].maxHp > easy.enemies[0].maxHp);
  const rooms = new Rooms();
  const room = rooms.create("1", 1000, "hard", "pvp");
  const joined = rooms.join(room.code, "2", 1000);
  assert.equal(joined.state.difficulty, "hard");
  const started = rooms.command(room.code, room.token, { type: "start" }, 1000);
  assert.ok(started.revision > room.revision);
});
test("players choose any tetromino; shapes remain selected and duplicates still cannot double-charge", () => {
  for (let shape = 0; shape < 7; shape++) {
    const s = createState();
    applyCommand(s, { type: "start" });
    const c = {
      type: "build" as const,
      room: "passage" as const,
      shape,
      rotation: 0,
      x: -1,
      y: 1,
    };
    assert.equal(applyCommand(s, c), null);
    assert.equal(s.nextShape, shape);
    assert.deepEqual(
      s.modules.at(-1)!.cells,
      rotated(shape, 0).map((p) => ({ x: p.x - 1, y: p.y + 1 })),
    );
    const alloy = s.alloy;
    assert.ok(applyCommand(s, c));
    assert.equal(s.alloy, alloy);
  }
  const s = createState();
  applyCommand(s, { type: "start" });
  for (const shape of [-1, 7, 1.5, NaN])
    assert.match(
      applyCommand(s, {
        type: "build",
        room: "passage",
        shape,
        rotation: 0,
        x: 1,
        y: 0,
      })!,
      /Invalid/,
    );
});
