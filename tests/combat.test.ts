import { battle } from "./combat-fixture.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { Rooms } from "../server/rooms.ts";
import { syncTerrain } from "../server/battlefield.ts";
import {
  createActor,
  resetOrder,
  assignedRoles,
  housing,
} from "../games/farfield/actors.ts";
import {
  applyCommand,
  createState,
  MODULES,
  type Module,
} from "../games/farfield/engine.ts";

test("buildings use alloy only and Quarters allow recruitment beyond 24", () => {
  const s = createState();
  s.phase = "playing";
  s.energy = 0;
  assert.ok(Object.values(MODULES).every((m) => m.energy === 0));
  assert.equal(
    applyCommand(s, {
      type: "build",
      room: "foundry",
      shape: 1,
      rotation: 0,
      x: -1,
      y: 1,
    }),
    null,
  );
  assert.equal(s.energy, 0);
  for (let i = 0; i < 7; i++)
    s.modules.push({
      id: 100 + i,
      type: "habitat",
      owner: "test",
      progress: 1,
      cells: [{ x: i, y: 10 }],
    });
  assert.equal(housing(s), 30);
  s.alloy = s.food = 1000;
  for (let i = 0; i < 30; i++)
    assert.equal(applyCommand(s, { type: "recruit", role: "builders" }), null);
  assert.equal(s.workers.length, 30);
  assert.match(
    applyCommand(s, { type: "recruit", role: "builders" })!,
    /Quarters/,
  );
});
test("Shield and EMP charge once, enforce cooldowns, pause and range, and reject invalid input", () => {
  const { rooms, a, p, turret } = battle();
  const energy = p.state.energy;
  rooms.command(a.code, a.token, { type: "ability", ability: "shield" }, 1000);
  assert.equal(p.state.energy, energy - 20);
  assert.throws(
    () =>
      rooms.command(
        a.code,
        a.token,
        { type: "ability", ability: "shield" },
        1000,
      ),
    /recharging/,
  );
  rooms.command(a.code, a.token, { type: "ability", ability: "emp" }, 1000);
  assert.equal(p.state.energy, energy - 35);
  assert.equal(turret.disabledUntil, 6);
  assert.throws(
    () =>
      rooms.command(
        a.code,
        a.token,
        { type: "ability", ability: "__proto__" } as any,
        1000,
      ),
    /Choose/,
  );
  rooms.command(a.code, a.token, { type: "pause" }, 1000);
  rooms.advance(0.5, 1000);
  assert.equal(p.state.time, 0);
  assert.throws(
    () =>
      rooms.command(
        a.code,
        a.token,
        { type: "ability", ability: "shield" },
        1000,
      ),
    /active/,
  );
  const fresh = battle();
  Object.assign(fresh.p.state.friend, fresh.p.state.spawn);
  assert.throws(
    () =>
      fresh.rooms.command(
        fresh.a.code,
        fresh.a.token,
        { type: "ability", ability: "emp" },
        1000,
      ),
    /No visible/,
  );
  assert.equal(fresh.p.state.energy, 45);
  fresh.p.state.energy = 0;
  assert.throws(
    () =>
      fresh.rooms.command(
        fresh.a.code,
        fresh.a.token,
        { type: "ability", ability: "shield" },
        1000,
      ),
    /20 energy/,
  );
});
test("Friend can approach and destroy a two-guard turret with abilities, keeping the selected target", () => {
  const { rooms, a, p, q, turret } = battle();
  rooms.command(a.code, a.token, { type: "ability", ability: "shield" }, 1000);
  rooms.command(a.code, a.token, { type: "ability", ability: "emp" }, 1000);
  rooms.command(
    a.code,
    a.token,
    { type: "attack", target: q.id, moduleId: turret.id },
    1000,
  );
  for (let i = 0; i < 100 && !turret.wreck; i++) rooms.advance(0.1, 1000);
  assert.equal(turret.wreck, true);
  assert.ok(p.state.friend.hp > 0);
  assert.ok(
    q.state.workers.length === 2,
    "Friend attacked selected turret instead of switching to its guards",
  );
});
test("Research accelerates only on-site anomaly decoding", () => {
  const { rooms, room, p, q } = battle();
  q.state.workers = [];
  q.state.modules = q.state.modules.filter((m) => m.type !== "turret");
  const m = room.monoliths![0];
  Object.assign(m, { x: 0, y: 0 });
  p.state.modules.push({
    id: 800,
    type: "lab",
    progress: 1,
    cells: [{ x: 8, y: 0 }],
    owner: p.id,
  });
  p.state.workers = [0, 1].map((i) => {
    const w = {
      ...createActor(),
      id: 810 + i,
      role: "scientists" as const,
      x: 8,
      y: 0,
    };
    resetOrder(w, 800);
    return w;
  });
  syncTerrain(room);
  for (let i = 0; i < 10; i++) rooms.advance(0.1, 1000);
  assert.ok(m.progress >= 14.9 && m.progress <= 15.1);
  Object.assign(p.state.friend, p.state.spawn);
  rooms.advance(0.1, 1000);
  assert.equal(m.progress, 0);
});

test("turret damage is fixed per turret, Shield mitigates it, and EMP expires", () => {
  for (const crew of [1, 2]) {
    const { rooms, p, q } = battle();
    q.state.workers.length = crew;
    rooms.advance(0.1, 1000);
    assert.ok(Math.abs(120 - p.state.friend.hp - 0.8) < 0.001);
  }
  const shield = battle();
  shield.rooms.command(
    shield.a.code,
    shield.a.token,
    { type: "ability", ability: "shield" },
    1000,
  );
  shield.rooms.advance(0.1, 1000);
  assert.ok(Math.abs(120 - shield.p.state.friend.hp - 0.28) < 0.001);
  const emp = battle();
  emp.rooms.command(
    emp.a.code,
    emp.a.token,
    { type: "ability", ability: "emp" },
    1000,
  );
  for (let i = 0; i < 59; i++) emp.rooms.advance(0.1, 1000);
  assert.equal(emp.p.state.friend.hp, 120);
  for (let i = 0; i < 3; i++) emp.rooms.advance(0.1, 1000);
  assert.ok(emp.p.state.friend.hp < 120, "turret resumes after EMP expires");
});

test("aggression mobilizes only free workers; building staff keep producing even with an enemy in range", () => {
  const { rooms, a, room, p, q, turret } = battle();
  p.state.combatModes!.friend = q.state.combatModes!.friend = "peaceful";
  turret.disabledUntil = 100;
  const foundry: Module = {
    id: 800,
    type: "foundry",
    owner: p.id,
    progress: 1,
    cells: [{ x: 0, y: 0 }],
  };
  p.state.modules.push(foundry);
  const miner = {
    ...createActor(),
    id: 801,
    role: "miners" as const,
    hp: 60,
    maxHp: 60,
    x: 0,
    y: 0,
  };
  resetOrder(miner, foundry.id);
  p.state.workers.push(miner);
  Object.assign(q.state.workers[0], { x: 1, y: 0 });
  resetOrder(q.state.workers[0], null, "idle");
  assignedRoles(p.state);
  syncTerrain(room);
  rooms.command(
    a.code,
    a.token,
    { type: "combat-mode", group: "workers", mode: "aggressive" },
    1000,
  );
  for (let i = 0; i < 20; i++) rooms.advance(0.1, 1000);
  assert.equal(miner.resumeJob, undefined);
  assert.equal(miner.attack, undefined);
  assert.equal(miner.targetId, foundry.id);
  assert.equal(miner.x, 0);
  assert.equal(miner.working, true);
  assert.equal(
    q.state.workers[0].hp,
    60,
    "staff must not stop production to autoattack at close range",
  );
  const free = {
    ...createActor(),
    id: 802,
    role: "builders" as const,
    hp: 60,
    maxHp: 60,
    x: 0,
    y: 0,
  };
  resetOrder(free, null, "idle");
  p.state.workers.push(free);
  assignedRoles(p.state);
  for (let i = 0; i < 10; i++) rooms.advance(0.1, 1000);
  assert.ok(free.attack, "new free workers inherit aggression");
  assert.ok(q.state.workers[0].hp < 60);
  rooms.command(
    a.code,
    a.token,
    { type: "assign", role: "miners", delta: 1 },
    1000,
  );
  assert.equal(
    free.attack,
    undefined,
    "assigning a fighter to a building cancels combat",
  );
  for (let i = 0; i < 20; i++) rooms.advance(0.1, 1000);
  assert.equal(free.targetId, foundry.id);
  assert.equal(free.working, true);
  assert.equal(free.attack, undefined);
  const hp = q.state.workers[0].hp;
  for (let i = 0; i < 10; i++) rooms.advance(0.1, 1000);
  assert.equal(q.state.workers[0].hp, hp);
});

test("staffed guards stay at turrets while mobile guards can respond to aggression", () => {
  const { rooms, a, room, p, q, turret } = battle();
  turret.disabledUntil = 100;
  p.state.combatModes!.friend = "peaceful";
  const own: Module = {
    id: 850,
    type: "turret",
    owner: p.id,
    progress: 1,
    cells: [{ x: 0, y: 0 }],
  };
  p.state.modules.push(own);
  const guard = {
    ...createActor(),
    id: 851,
    role: "guards" as const,
    x: 0,
    y: 0,
  };
  resetOrder(guard, own.id);
  p.state.workers.push(guard);
  syncTerrain(room);
  rooms.command(
    a.code,
    a.token,
    { type: "combat-mode", group: "workers", mode: "aggressive" },
    1000,
  );
  for (let i = 0; i < 10; i++) rooms.advance(0.1, 1000);
  assert.equal(guard.attack, undefined);
  assert.equal(guard.working, true);
  assert.equal(guard.x, 0);
  assert.ok(
    q.state.workers.some((w) => w.hp < 60),
    "staffed turret still fires",
  );
  rooms.command(a.code, a.token, { type: "guards", stance: "follow" }, 1000);
  rooms.advance(0.1, 1000);
  assert.ok(guard.attack, "explicitly mobilized guards may fight");
});

test("aggression cannot cross empty space, and a Friend's manual movement overrides automatic combat", () => {
  const { rooms, a, room, p, q, turret } = battle();
  turret.disabledUntil = 100;
  const worker = {
    ...createActor(),
    id: 800,
    role: "builders" as const,
    x: 0,
    y: 0,
  };
  resetOrder(worker, null, "idle");
  p.state.workers.push(worker);
  p.state.combatModes!.friend = "peaceful";
  room.floor![0].cells = [{ x: 0, y: 0 }];
  syncTerrain(room);
  rooms.command(
    a.code,
    a.token,
    { type: "combat-mode", group: "workers", mode: "aggressive" },
    1000,
  );
  for (let i = 0; i < 20; i++) rooms.advance(0.1, 1000);
  assert.equal(worker.attack, undefined);
  assert.equal(worker.x, 0);
  assert.ok(q.state.workers.every((w) => w.hp === 60));
  assert.throws(
    () =>
      rooms.command(
        a.code,
        a.token,
        { type: "combat-mode", group: "__proto__", mode: "aggressive" } as any,
        1000,
      ),
    /Choose/,
  );
  const fresh = battle();
  fresh.turret.disabledUntil = 100;
  fresh.rooms.command(
    fresh.a.code,
    fresh.a.token,
    { type: "direct", x: 0, y: 2, task: "move" },
    1000,
  );
  fresh.rooms.advance(0.1, 1000);
  assert.equal(fresh.p.state.friend.attack, undefined);
  assert.equal(fresh.p.state.friend.destination?.y, 2);
});

test("peaceful Friend stops automatic combat, explicit attacks still work, new workers inherit the group mode", () => {
  const { rooms, a, p, q, turret } = battle();
  turret.disabledUntil = 100;
  rooms.advance(0.1, 1000);
  assert.ok(p.state.friend.resumeJob);
  rooms.command(
    a.code,
    a.token,
    { type: "combat-mode", group: "friend", mode: "peaceful" },
    1000,
  );
  assert.equal(p.state.friend.attack, undefined);
  assert.equal(p.state.friend.resumeJob, undefined);
  rooms.command(
    a.code,
    a.token,
    { type: "attack", target: q.id, moduleId: turret.id },
    1000,
  );
  assert.deepEqual(p.state.friend.attack, {
    playerId: q.id,
    moduleId: turret.id,
  });
  rooms.advance(0.1, 1000);
  assert.deepEqual(p.state.friend.attack, {
    playerId: q.id,
    moduleId: turret.id,
  });
  rooms.command(
    a.code,
    a.token,
    { type: "combat-mode", group: "workers", mode: "aggressive" },
    1000,
  );
  // Recruit at the local core, move onto the fixture floor to test inherited behavior.
  rooms.command(a.code, a.token, { type: "recruit", role: "builders" }, 1000);
  Object.assign(p.state.workers[0], { x: 0, y: 0 });
  rooms.advance(0.1, 1000);
  assert.ok(p.state.workers[0].attack);
});
