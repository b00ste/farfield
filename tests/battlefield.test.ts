import test from "node:test";
import assert from "node:assert/strict";
import { Rooms } from "../server/rooms.ts";
import {
  CORNER_SPAWNS,
  plaza,
  positionPlayers,
  objectives,
  advanceBattlefield,
  syncTerrain,
} from "../server/battlefield.ts";
import {
  applyCommand,
  createState,
  tick,
  MODULES,
  type Module,
} from "../games/farfield/engine.ts";
import { createActor, resetOrder, routeTo } from "../games/farfield/actors.ts";
function match() {
  const rooms = new Rooms(),
    a = rooms.create("1", 1000, "normal", "custom", []);
  const b = rooms.join(a.code, "2", 1000);
  rooms.command(a.code, a.token, { type: "start" }, 1000);
  const room = rooms.rooms.get(a.code)!;
  return { rooms, a, b, room, p: room.players[0], q: room.players[1] };
}
function wait(room: ReturnType<typeof match>["room"], seconds: number) {
  for (let i = 0; i < seconds * 10; i++) {
    room.players.forEach((p) => (p.state.time += 0.1));
    advanceBattlefield(room, 0.1);
  }
}
test("predefined spawns retain equal opening resources", () => {
  for (let n = 2; n <= 4; n++) {
    const rooms = new Rooms(),
      a = rooms.create(
        "1",
        1000,
        "normal",
        "custom",
        Array(n - 1).fill("hard"),
      ),
      room = rooms.rooms.get(a.code)!;
    assert.equal(
      new Set(
        room.players.map((p) => `${p.state.spawn!.x},${p.state.spawn!.y}`),
      ).size,
      n,
    );
    room.players.forEach((p) => {
      assert.deepEqual(
        [p.state.alloy, p.state.energy, p.state.food],
        [65, 45, 40],
      );
      assert.equal(p.state.modules.length, 1);
      assert.deepEqual(p.state.deposits, []);
    });
  }
});
test("capture requires a living Friend present for ten seconds, guards contest, all-four hold can be interrupted", () => {
  const { room, p, q } = match(),
    m = room.monoliths![0];
  Object.assign(p.state.friend, { x: m.x + 2, y: m.y });
  resetOrder(p.state.friend, null, "idle");
  wait(room, 5);
  assert.ok(m.progress >= 49 && m.progress < 51);
  assert.equal(m.ownerId, null);
  q.state.workers.push({
    ...createActor(),
    id: 999,
    role: "guards",
    x: m.x,
    y: m.y + 2,
    hp: 999,
    maxHp: 999,
  });
  const progress = m.progress;
  wait(room, 1);
  assert.equal(m.contested, true);
  assert.equal(m.progress, progress);
  q.state.workers = [];
  wait(room, 5.1);
  assert.equal(m.ownerId, p.id);
  Object.assign(p.state.friend, p.state.spawn);
  room.monoliths!.forEach((m) => {
    m.ownerId = p.id;
    m.claimant = null;
    m.progress = 100;
  });
  wait(room, 59);
  assert.equal(p.state.phase, "playing");
  assert.ok(room.hold!.seconds >= 59);
  Object.assign(q.state.friend, { x: m.x + 2, y: m.y });
  wait(room, 0.2);
  assert.equal(
    room.hold!.seconds,
    0,
    "enemy capture interrupts the hold before victory",
  );
  Object.assign(q.state.friend, q.state.spawn);
  m.claimant = null;
  wait(room, 60.1);
  assert.equal(p.state.phase, "won");
});
test("remote scientists cannot capture monoliths or win a shared match", () => {
  const { room, p } = match();
  p.state.modules.push({
    id: 999,
    type: "lab",
    cells: [{ ...p.state.spawn! }],
    progress: 1,
    owner: p.id,
  });
  resetOrder(p.state.friend, 999);
  for (let i = 0; i < 1200; i++) {
    tick(p.state, 0.5);
    advanceBattlefield(room, 0.5);
  }
  assert.ok(room.monoliths!.every((m) => m.ownerId === null));
  assert.equal(p.state.phase, "playing");
});
test("healing requires an out-of-combat core or staffed infirmary; Friend respawns, workers do not", () => {
  const { room, p } = match();
  p.state.friend.hp = 30;
  p.state.friend.lastHit = p.state.time;
  wait(room, 3);
  assert.equal(p.state.friend.hp, 30);
  wait(room, 2);
  assert.ok(p.state.friend.hp > 30);
  Object.assign(p.state.friend, { x: 10, y: 10 });
  p.state.friend.hp = 30;
  wait(room, 2);
  assert.equal(p.state.friend.hp, 30);
  p.state.modules.push({
    id: 900,
    type: "infirmary",
    cells: [{ x: 10, y: 10 }],
    progress: 1,
    owner: p.id,
  });
  p.state.workers.push({
    ...createActor(),
    id: 901,
    role: "medics",
    x: 10,
    y: 10,
    targetId: 900,
    task: "medics",
    working: true,
  });
  wait(room, 2);
  assert.ok(p.state.friend.hp > 30);
  p.state.friend.hp = 0;
  p.state.workers[0].hp = 0;
  wait(room, 0.1);
  assert.equal(p.state.workers.length, 0);
  wait(room, 14);
  assert.equal(p.state.friend.hp, 0);
  wait(room, 1.2);
  assert.equal(p.state.friend.hp, 120);
  assert.deepEqual({ x: p.state.friend.x, y: p.state.friend.y }, p.state.spawn);
});
test("an infirmary needs an assigned medic at its post; the Friend cannot power self-healing", () => {
  const { room, p } = match();
  const hospital: Module = {
    id: 900,
    type: "infirmary",
    cells: [{ x: 10, y: 10 }],
    progress: 1,
    owner: p.id,
  };
  p.state.modules.push(hospital);
  Object.assign(p.state.friend, {
    x: 10,
    y: 10,
    hp: 20,
    targetId: hospital.id,
    task: "medics",
    working: true,
  });
  wait(room, 1);
  assert.equal(
    p.state.friend.hp,
    20,
    "Friend working alone cannot activate an infirmary",
  );
  const medic = {
    ...createActor(),
    id: 901,
    role: "medics" as const,
    x: 9,
    y: 10,
    targetId: hospital.id,
    task: "medics" as const,
    working: true,
  };
  p.state.workers.push(medic);
  wait(room, 1);
  assert.equal(p.state.friend.hp, 20, "assigned medic must arrive at the post");
  medic.x = 10;
  medic.targetId = 999;
  wait(room, 1);
  assert.equal(
    p.state.friend.hp,
    20,
    "a nearby worker assigned elsewhere cannot staff it",
  );
  medic.targetId = hospital.id;
  medic.working = false;
  wait(room, 1);
  assert.equal(p.state.friend.hp, 20, "idle assigned worker does not heal");
  medic.working = true;
  medic.evacuating = true;
  wait(room, 1);
  assert.equal(p.state.friend.hp, 20, "evacuating workers do not heal");
  medic.evacuating = false;
  hospital.progress = 0.5;
  wait(room, 1);
  assert.equal(p.state.friend.hp, 20, "unfinished infirmary does not heal");
  hospital.progress = 1;
  hospital.dismantling = true;
  wait(room, 1);
  assert.equal(p.state.friend.hp, 20, "dismantling infirmary does not heal");
  hospital.dismantling = false;
  wait(room, 1);
  assert.ok(
    Math.abs(p.state.friend.hp - 28) < 1e-6,
    "one working medic heals 8 HP/s",
  );
  medic.hp = 0;
  wait(room, 1);
  assert.ok(
    Math.abs(p.state.friend.hp - 28) < 1e-6,
    "healing stops when its medic dies",
  );
});
test("a second medic doubles infirmary healing without stacking hospitals or exceeding maximum HP", () => {
  const { room, p } = match();
  Object.assign(p.state.friend, { x: 10, y: 10, hp: 20 });
  for (const id of [900, 910]) {
    p.state.modules.push({
      id,
      type: "infirmary",
      cells: [{ x: id === 900 ? 10 : 11, y: 10 }],
      progress: 1,
      owner: p.id,
    });
  }
  const medic = (id: number, targetId: number, x: number) => ({
    ...createActor(),
    id,
    role: "medics" as const,
    x,
    y: 10,
    targetId,
    task: "medics" as const,
    working: true,
  });
  p.state.workers.push(medic(901, 900, 10), medic(902, 900, 10));
  wait(room, 1);
  assert.ok(Math.abs(p.state.friend.hp - 36) < 1e-6, "two medics heal 16 HP/s");
  p.state.workers.push(medic(911, 910, 11), medic(912, 910, 11));
  wait(room, 1);
  assert.ok(
    Math.abs(p.state.friend.hp - 52) < 1e-6,
    "overlapping infirmaries do not multiply healing",
  );
  p.state.friend.lastHit = p.state.time;
  wait(room, 3);
  assert.ok(
    Math.abs(p.state.friend.hp - 52) < 1e-6,
    "staffing does not bypass combat recovery delay",
  );
  p.state.friend.lastHit = -10;
  p.state.friend.hp = p.state.friend.maxHp - 1;
  wait(room, 1);
  assert.equal(p.state.friend.hp, p.state.friend.maxHp);
});
test("Friend sieges buildings and core over connected paths; kills have no refund and retain flooring", () => {
  const { rooms, a, room, p, q } = match();
  const core = q.state.modules[0];
  // Isolate siege: the defender must not automatically counter-siege the other core.
  q.state.combatModes!.friend = "peaceful";
  Object.assign(p.state.friend, q.state.spawn);
  Object.assign(q.state.friend, p.state.spawn);
  resetOrder(q.state.friend, null, "idle");
  syncTerrain(room);
  const module: Module = {
    id: q.state.nextId++,
    type: "foundry",
    cells: [{ x: q.state.spawn!.x + 1, y: q.state.spawn!.y }],
    progress: 1,
    owner: q.id,
    hp: 5,
  };
  q.state.modules.push(module);
  syncTerrain(room);
  const alloy = q.state.alloy;
  rooms.command(
    a.code,
    a.token,
    { type: "attack", target: q.id, moduleId: module.id },
    1000,
  );
  wait(room, 1);
  assert.equal(module.wreck, true);
  assert.equal(module.type, "passage");
  assert.equal(q.state.alloy, alloy);
  assert.ok(routeTo(p.state, p.state.friend, module.cells));
  rooms.command(
    a.code,
    a.token,
    { type: "attack", target: q.id, moduleId: core.id },
    1000,
  );
  wait(room, 10);
  assert.equal(q.state.phase, "lost");
  assert.equal(q.state.integrity, 0);
  assert.equal(q.state.elimination?.by, p.name);
});
test("unit damage resolves simultaneously and only fighters autoattack", () => {
  const { room, p, q } = match();
  Object.assign(p.state.friend, { x: 0, y: 0, hp: 50 });
  Object.assign(q.state.friend, { x: 1, y: 0, hp: 50 });
  const worker = {
    ...createActor(),
    id: 99,
    role: "builders" as const,
    x: 0,
    y: 1,
    hp: 60,
  };
  p.state.workers.push(worker);
  wait(room, 1);
  assert.ok(Math.abs(p.state.friend.hp - q.state.friend.hp) < 0.0001);
  assert.ok(p.state.friend.hp < 50);
});
test("unfinished cancellation refunds 100%, finished dismantling 75%, dependent blueprints cancel safely", () => {
  const s = createState();
  applyCommand(s, { type: "start" });
  const start = [s.alloy, s.energy];
  applyCommand(s, {
    type: "build",
    room: "foundry",
    shape: 1,
    rotation: 0,
    x: -1,
    y: 1,
  });
  const first = s.modules.at(-1)!;
  first.progress = 0.9;
  applyCommand(s, {
    type: "build",
    room: "passage",
    shape: 1,
    rotation: 0,
    x: -1,
    y: 3,
  });
  assert.equal(s.modules.length, 3);
  assert.equal(applyCommand(s, { type: "demolish", moduleId: first.id }), null);
  assert.deepEqual([s.alloy, s.energy], start);
  assert.equal(s.modules.length, 1);
  assert.ok(applyCommand(s, { type: "demolish", moduleId: first.id }));
  assert.deepEqual([s.alloy, s.energy], start);
  applyCommand(s, {
    type: "build",
    room: "foundry",
    shape: 1,
    rotation: 0,
    x: -1,
    y: 1,
  });
  const built = s.modules.at(-1)!;
  built.progress = 1;
  applyCommand(s, { type: "demolish", moduleId: built.id });
  assert.deepEqual(
    [s.alloy, s.energy],
    [
      start[0] - MODULES.foundry.alloy * 0.25,
      start[1] - MODULES.foundry.energy * 0.25,
    ],
  );
  assert.ok(!s.modules.includes(built));
  assert.equal(routeTo(s, s.friend, built.cells), null);
  assert.ok(applyCommand(s, { type: "demolish", moduleId: built.id }));
  assert.ok(applyCommand(s, { type: "demolish", moduleId: s.modules[0].id }));
});
test("old raid clients are rejected, pauses freeze shared capture and combat", () => {
  const { rooms, a, b, room, p } = match();
  assert.throws(
    () =>
      rooms.command(a.code, a.token, { type: "raid", target: b.selfId }, 1000),
    /shared battlefield/,
  );
  Object.assign(p.state.friend, { x: -3, y: -5 });
  rooms.command(a.code, a.token, { type: "pause" }, 1000);
  const before = JSON.stringify(room.monoliths);
  wait(room, 20);
  assert.equal(JSON.stringify(room.monoliths), before);
});
test("guards follow on flooring, hold a position, and can return to staff turrets", () => {
  const { rooms, a, room, p } = match(),
    s = p.state,
    spawn = s.spawn!;
  const cells = [
    { x: spawn.x, y: spawn.y },
    { x: spawn.x + Math.sign(spawn.x), y: spawn.y },
  ];
  s.modules.push({
    id: s.nextId++,
    type: "turret",
    cells,
    progress: 1,
    owner: p.id,
  });
  assert.equal(applyCommand(s, { type: "recruit", role: "guards" }), null);
  for (let step = 0; step < 60; step++) tick(s, 0.1);
  assert.equal(
    rooms.command(a.code, a.token, { type: "guards", stance: "follow" }, 1000)
      .state.workers[0].stance,
    "follow",
  );
  const to = cells[1];
  rooms.command(a.code, a.token, { type: "direct", ...to, task: "move" }, 1000);
  for (let i = 0; i < 30; i++) rooms.advance(0.1, 1000);
  assert.ok(Math.hypot(s.workers[0].x - to.x, s.workers[0].y - to.y) < 0.01);
  rooms.command(
    a.code,
    a.token,
    { type: "guards", stance: "defend", ...spawn },
    1000,
  );
  for (let i = 0; i < 20; i++) rooms.advance(0.1, 1000);
  assert.ok(
    Math.hypot(s.workers[0].x - spawn.x, s.workers[0].y - spawn.y) < 0.01,
  );
  rooms.command(a.code, a.token, { type: "guards", stance: "station" }, 1000);
  for (let i = 0; i < 20; i++) rooms.advance(0.1, 1000);
  assert.equal(s.workers[0].stance, undefined);
  assert.equal(s.workers[0].task, "guards");
  assert.equal(s.workers[0].working, true);
});
test("refunds preserve the full amount even when production storage is full", () => {
  const s = createState();
  applyCommand(s, { type: "start" });
  applyCommand(s, {
    type: "build",
    room: "foundry",
    shape: 1,
    rotation: 0,
    x: -1,
    y: 1,
  });
  s.alloy = s.energy = 300;
  applyCommand(s, { type: "demolish", moduleId: s.modules.at(-1)!.id });
  assert.equal(s.alloy, 314);
  assert.equal(s.energy, 300);
  tick(s, 0.1);
  assert.equal(s.alloy, 314);
  assert.equal(s.energy, 300);
});
test("fixed corner seats keep opening routes balanced and never overlap", () => {
  for (let n = 2; n <= 4; n++)
    for (let seed = 0; seed < 64; seed++) {
      const rooms = new Rooms(),
        a = rooms.create(
          "1",
          1000,
          "normal",
          "custom",
          Array(n - 1).fill("normal"),
        ),
        room = rooms.rooms.get(a.code)!;
      room.seed = seed;
      room.monoliths = undefined;
      positionPlayers(room);
      const nearest = room.players.map((p) =>
        Math.min(
          ...room.monoliths!.map(
            (m) =>
              Math.abs(m.x - p.state.spawn!.x) +
              Math.abs(m.y - p.state.spawn!.y),
          ),
        ),
      );
      assert.ok(Math.max(...nearest) === Math.min(...nearest));
      for (const p of room.players) {
        assert.ok(
          CORNER_SPAWNS.some(
            (s) => s.x === p.state.spawn!.x && s.y === p.state.spawn!.y,
          ),
        );
        assert.equal(
          new Set(p.state.modules[0].cells.map((c) => `${c.x},${c.y}`)).size,
          4,
        );
      }
      if (n <= 4) {
        const d = room.players.map((p) =>
          room
            .monoliths!.map(
              (m) =>
                Math.abs(m.x - p.state.spawn!.x) +
                Math.abs(m.y - p.state.spawn!.y),
            )
            .sort((a, b) => a - b),
        );
        d.forEach((v) => assert.deepEqual(v, d[0]));
        assert.ok(
          room.players.every((p) =>
            CORNER_SPAWNS.some(
              (s) => s.x === p.state.spawn!.x && s.y === p.state.spawn!.y,
            ),
          ),
        );
      }
    }
});
test("simultaneous final core destruction is a draw instead of a false ongoing match", () => {
  const { rooms, a, b, room, p, q } = match();
  Object.assign(p.state.friend, q.state.spawn);
  Object.assign(q.state.friend, p.state.spawn);
  p.state.integrity = q.state.integrity = 0.1;
  syncTerrain(room);
  rooms.command(
    a.code,
    a.token,
    { type: "attack", target: q.id, moduleId: q.state.modules[0].id },
    1000,
  );
  rooms.command(
    a.code,
    b.token,
    { type: "attack", target: p.id, moduleId: p.state.modules[0].id },
    1000,
  );
  rooms.advance(0.1, 1000);
  assert.equal(room.draw, true);
  assert.equal(room.winnerId, null);
  assert.ok(room.players.every((p) => p.state.phase === "lost"));
});
test("seeded monoliths vary between matches, have separate platforms, and stay clear of boundaries", () => {
  const layouts = new Set<string>();
  for (let seed = 0; seed < 128; seed++) {
    const m = objectives(seed);
    assert.deepEqual(m, objectives(seed));
    const islands = plaza(m);
    assert.equal(islands.length, 4);
    assert.ok(islands.every((p) => p.cells.length === 16));
    assert.equal(
      new Set(islands.flatMap((p) => p.cells.map((c) => `${c.x},${c.y}`))).size,
      64,
    );
    layouts.add(JSON.stringify(m.map(({ x, y }) => ({ x, y }))));
    assert.equal(new Set(m.map((p) => `${p.x},${p.y}`)).size, 4);
    for (const a of m) {
      assert.ok(Math.abs(a.x) <= 22 && Math.abs(a.y) <= 22);
      for (const b of m)
        if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) >= 14);
    }
  }
  assert.ok(
    layouts.size > 100,
    "match seeds produce substantially different layouts",
  );
});

test("lobby refreshes preserve seeded objectives and active matches never relocate", () => {
  const lobby = new Rooms();
  const created = lobby.create("9", 1000, "normal", "custom", ["normal"]);
  const waiting = lobby.rooms.get(created.code)!;
  const before = JSON.stringify(waiting.monoliths);
  positionPlayers(waiting);
  assert.equal(JSON.stringify(waiting.monoliths), before);
  const { room, rooms, a } = match();
  const positions = JSON.stringify(room.monoliths),
    spawn = JSON.stringify(room.players.map((p) => p.state.spawn));
  positionPlayers(room);
  assert.equal(JSON.stringify(room.monoliths), positions);
  assert.equal(JSON.stringify(room.players.map((p) => p.state.spawn)), spawn);
  assert.equal(
    rooms.view(room, a.token, 1000).state.seed,
    0,
    "private placement seed is not exposed to clients",
  );
});

test("dismantling evacuates own units, refunds once, and rejects station bridges", () => {
  const s = createState();
  applyCommand(s, { type: "start" });
  for (const y of [1, 3]) {
    assert.equal(
      applyCommand(s, {
        type: "build",
        room: "passage",
        shape: 1,
        rotation: 0,
        x: -1,
        y,
      }),
      null,
    );
    s.modules.at(-1)!.progress = 1;
  }
  const bridge = s.modules[1],
    edge = s.modules[2],
    alloy = s.alloy;
  assert.match(
    applyCommand(s, { type: "demolish", moduleId: bridge.id })!,
    /disconnect/,
  );
  Object.assign(s.friend, edge.cells[0]);
  s.workers.push({
    ...createActor(),
    id: 900,
    role: "builders",
    ...edge.cells[1],
  });
  assert.equal(applyCommand(s, { type: "demolish", moduleId: edge.id }), null);
  assert.equal(s.alloy, alloy, "refund waits until flooring is removed");
  assert.equal(edge.dismantling, true);
  assert.ok(s.friend.evacuating && s.workers[0].evacuating);
  for (let i = 0; i < 100; i++) tick(s, 0.1);
  assert.ok(!s.modules.includes(edge));
  assert.ok(routeTo(s, s.friend, s.modules[0].cells));
  assert.ok(routeTo(s, s.workers[0], s.modules[0].cells));
  const refunded = s.alloy;
  assert.ok(refunded >= alloy + MODULES.passage.alloy * 0.75);
  assert.ok(applyCommand(s, { type: "demolish", moduleId: edge.id }));
  assert.equal(s.alloy, refunded);
  assert.equal(
    applyCommand(s, { type: "demolish", moduleId: bridge.id }),
    null,
  );
  assert.equal(s.modules.length, 1);
});
test("a player cannot dismantle flooring underneath a rival", () => {
  const { rooms, a, p, q, room } = match();
  const c = p.state.modules[0].cells[0];
  const m: Module = {
    id: 999,
    type: "passage",
    progress: 1,
    hp: 100,
    owner: p.id,
    cells: [{ x: c.x + 1, y: c.y }],
  };
  p.state.modules.push(m);
  Object.assign(q.state.friend, m.cells[0]);
  syncTerrain(room);
  assert.throws(
    () =>
      rooms.command(
        a.code,
        a.token,
        { type: "demolish", moduleId: m.id },
        1000,
      ),
    /enemy is on/,
  );
  assert.ok(p.state.modules.includes(m));
});
