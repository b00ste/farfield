import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  createState,
  rates,
  tick,
  workPower,
  workerEfficiency,
  RECRUIT_SECONDS,
  MAX_RECRUIT_QUEUE,
  type State,
} from "../games/farfield/engine.ts";
import {
  createActor,
  assignedRoles,
  defenseEfficiency,
  type Worker,
} from "../games/farfield/actors.ts";
import { Rooms } from "../server/rooms.ts";
import { advanceBattlefield } from "../server/battlefield.ts";
function start() {
  const s = createState();
  s.phase = "playing";
  s.attackWaves = false;
  applyCommand(s, { type: "stop-friend" });
  return s;
}
function advance(s: State, seconds: number) {
  for (let i = 0; i < Math.round(seconds * 10); i++) tick(s, 0.1);
}
function worker(id: number, role: Worker["role"] = "builders"): Worker {
  return {
    ...createActor(),
    id,
    role,
    hp: 60,
    maxHp: 60,
    targetId: null,
    order: "work",
  };
}
function quarters(s: State) {
  s.modules.push({
    id: 100,
    type: "habitat",
    cells: [{ x: 1, y: 0 }],
    progress: 1,
    owner: "test",
  });
}
function production(
  s: State,
  type: "garden" | "foundry",
  role: "farmers" | "miners",
) {
  s.modules.push({
    id: 200,
    type,
    cells: [{ x: 0, y: 1 }],
    progress: 1,
    owner: "test",
  });
  const w = worker(201, role);
  Object.assign(w, { x: 0, y: 1, targetId: 200, task: role, working: true });
  s.workers.push(w);
  assignedRoles(s);
  return w;
}
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} != ${expected}`);

test("recruitment is serial, charges once, and cannot produce instant workers", () => {
  const s = start();
  const food = s.food,
    alloy = s.alloy;
  for (let i = 0; i < 2; i++)
    assert.equal(applyCommand(s, { type: "recruit", role: "builders" }), null);
  assert.equal(s.workers.length, 0);
  assert.equal(s.recruitQueue!.length, 2);
  assert.equal(s.food, food - 16);
  assert.equal(s.alloy, alloy - 12);
  advance(s, RECRUIT_SECONDS - 0.1);
  assert.equal(s.workers.length, 0);
  assert.equal(s.recruitQueue![1].progress, 0);
  advance(s, 0.1);
  assert.equal(s.workers.length, 1);
  assert.equal(s.recruitQueue!.length, 1);
  advance(s, RECRUIT_SECONDS);
  assert.equal(s.workers.length, 2);
  assert.equal(s.recruitQueue!.length, 0);
});
test("queue reserves beds and specialty slots, caps at five, and rejected requests do not charge", () => {
  const s = start();
  quarters(s);
  s.alloy = s.food = 500;
  production(s, "foundry", "miners");
  assert.equal(
    applyCommand(s, { type: "recruit", role: "miners", moduleId: 200 }),
    null,
  );
  const snapshot = JSON.stringify(s);
  assert.match(
    applyCommand(s, { type: "recruit", role: "miners", moduleId: 200 })!,
    /free slot/,
  );
  assert.equal(JSON.stringify(s), snapshot);
  for (let i = 1; i < MAX_RECRUIT_QUEUE; i++)
    assert.equal(applyCommand(s, { type: "recruit", role: "builders" }), null);
  const capped = JSON.stringify(s);
  assert.match(
    applyCommand(s, { type: "recruit", role: "builders" })!,
    /queue is full/,
  );
  assert.equal(JSON.stringify(s), capped);
  const two = start();
  for (let i = 0; i < 2; i++)
    applyCommand(two, { type: "recruit", role: "builders" });
  assert.match(
    applyCommand(two, { type: "recruit", role: "builders" })!,
    /beds/,
  );
});
test("queued jobs cannot be stolen by assigning an existing free worker", () => {
  const s = start();
  quarters(s);
  production(s, "foundry", "miners");
  s.workers.push(worker(202));
  assignedRoles(s);
  assert.equal(
    applyCommand(s, { type: "recruit", role: "miners", moduleId: 200 }),
    null,
  );
  assert.match(
    applyCommand(s, { type: "assign", role: "miners", delta: 1 })!,
    /free slot/,
  );
  advance(s, 6);
  assert.equal(s.roles.miners, 2);
  assert.equal(s.roles.builders, 1);
});
test("canceling a queued worker refunds exactly once, including above storage capacity", () => {
  const s = start();
  s.alloy = s.food = 400;
  applyCommand(s, { type: "recruit", role: "builders" });
  const id = s.recruitQueue![0].id;
  advance(s, 2);
  const alloy = s.alloy,
    food = s.food;
  assert.equal(applyCommand(s, { type: "cancel-recruit", id }), null);
  near(s.alloy, alloy + 6);
  near(s.food, food + 8);
  const before = JSON.stringify(s);
  assert.match(
    applyCommand(s, { type: "cancel-recruit", id })!,
    /queued worker/,
  );
  assert.equal(JSON.stringify(s), before);
  advance(s, 0.1);
  assert.ok(s.food >= 400);
});
test("lost housing holds recruitment safely and cancellation releases the reserved slot", () => {
  const s = start();
  quarters(s);
  for (let i = 0; i < 3; i++)
    applyCommand(s, { type: "recruit", role: "builders" });
  s.modules = s.modules.filter((m) => m.type !== "habitat");
  advance(s, 20);
  assert.equal(s.workers.length, 2);
  assert.equal(s.recruitQueue!.length, 1);
  assert.equal(s.recruitQueue![0].progress, 1);
  const id = s.recruitQueue![0].id;
  assert.equal(applyCommand(s, { type: "cancel-recruit", id }), null);
  assert.equal(s.recruitQueue!.length, 0);
});
test("a destroyed queued workplace produces a free builder instead of losing the recruit", () => {
  const s = start();
  production(s, "foundry", "miners");
  s.workers = [];
  assignedRoles(s);
  applyCommand(s, { type: "recruit", role: "miners", moduleId: 200 });
  s.modules.find((m) => m.id === 200)!.type = "passage";
  s.modules.find((m) => m.id === 200)!.wreck = true;
  advance(s, 6);
  assert.equal(s.workers.length, 1);
  assert.equal(s.workers[0].role, "builders");
  assert.equal(s.workers[0].targetId, null);
});
test("pause freezes recruitment and shortage, and legacy states acquire safe defaults", () => {
  const s = start();
  delete s.recruitQueue;
  delete s.foodShortage;
  applyCommand(s, { type: "recruit", role: "builders" });
  advance(s, 1);
  s.paused = true;
  const before = JSON.stringify(s);
  advance(s, 30);
  assert.equal(JSON.stringify(s), before);
  s.paused = false;
  advance(s, 5);
  assert.equal(s.workers.length, 1);
  assert.equal(s.foodShortage, 0);
});
test("one farmer sustains six total workers and the Friend has no food upkeep", () => {
  const s = start();
  assert.equal(rates(s).food, 0);
  production(s, "garden", "farmers");
  for (let i = 0; i < 5; i++) s.workers.push(worker(300 + i));
  assignedRoles(s);
  near(rates(s).food, 0.02);
  s.workers.push(worker(306));
  assignedRoles(s);
  near(rates(s).food, -0.11);
  s.foodShortage = 1;
  near(rates(s).food, -0.11);
});
test("shortage and recovery ramp gradually; farming and Friend work remain productive", () => {
  const s = start();
  production(s, "foundry", "miners");
  s.food = 0;
  advance(s, 15);
  near(s.foodShortage!, 0.5);
  near(workerEfficiency(s), 0.75);
  near(workPower(s, "miners"), 0.75);
  advance(s, 15);
  near(workerEfficiency(s), 0.5);
  near(workPower(s, "miners"), 0.5);
  s.food = 20;
  advance(s, 15);
  near(workerEfficiency(s), 0.75);
  advance(s, 15);
  near(workerEfficiency(s), 1);
  s.foodShortage = 1;
  Object.assign(s.friend, { task: "miners", working: true, hp: 120 });
  near(workPower(s, "miners"), 2.5);
  near(rates(s).alloy, 0.12 + 2.5 * 0.55);
  const farm = start();
  production(farm, "garden", "farmers");
  farm.food = 0;
  farm.foodShortage = 1;
  near(workPower(farm, "farmers"), 1);
  advance(farm, 15);
  assert.ok(farm.food > 0);
  near(workerEfficiency(farm), 0.75);
  const build = start();
  build.foodShortage = 1;
  build.workers.push({ ...worker(1), task: "build", working: true });
  near(workPower(build, "build"), 0.5);
  Object.assign(build.friend, { task: "build", working: true });
  near(workPower(build, "build"), 2.5);
});
test("food shortage halves worker-staffed turret damage while Friend staffing stays full strength", () => {
  const rooms = new Rooms(),
    seat = rooms.create("1", 1000, "normal", "custom", []);
  rooms.join(seat.code, "2", 1000);
  rooms.command(seat.code, seat.token, { type: "start" }, 1000);
  const room = rooms.rooms.get(seat.code)!,
    [p, q] = room.players;
  p.state.foodShortage = 1;
  p.state.modules.push({
    id: 900,
    type: "turret",
    cells: [{ x: 10, y: 10 }],
    progress: 1,
    owner: p.id,
  });
  p.state.workers.push({
    ...worker(901, "guards"),
    x: 10,
    y: 10,
    targetId: 900,
    task: "guards",
    working: true,
  });
  Object.assign(q.state.friend, { x: 14, y: 10 });
  q.state.combatModes!.friend = "peaceful";
  const before = q.state.friend.hp;
  advanceBattlefield(room, 1);
  near(before - q.state.friend.hp, 4);
  Object.assign(p.state.friend, {
    x: 10,
    y: 10,
    targetId: 900,
    task: "guards",
    working: true,
  });
  near(defenseEfficiency(p.state, 900), 1);
  const after = q.state.friend.hp;
  advanceBattlefield(room, 1);
  near(after - q.state.friend.hp, 8);
});

test("shortage scales mobile worker and guard attacks without reducing the Friend's attack", () => {
  for (const role of ["builders", "guards", "friend"] as const) {
    const rooms = new Rooms(),
      seat = rooms.create("1", 1000, "normal", "custom", []);
    rooms.join(seat.code, "2", 1000);
    rooms.command(seat.code, seat.token, { type: "start" }, 1000);
    const room = rooms.rooms.get(seat.code)!,
      [p, q] = room.players;
    p.state.foodShortage = 1;
    p.state.combatModes!.workers = "aggressive";
    q.state.combatModes!.friend = "peaceful";
    Object.assign(q.state.friend, { x: 1, y: 0 });
    p.state.modules.push({
      id: 900,
      type: "passage",
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
      progress: 1,
      owner: p.id,
    });
    const actor = role === "friend" ? p.state.friend : worker(901, role);
    Object.assign(actor, {
      x: 0,
      y: 0,
      attack: { playerId: q.id },
      stance: "follow",
    });
    if (role !== "friend") p.state.workers.push(actor as Worker);
    const before = q.state.friend.hp;
    advanceBattlefield(room, 1);
    near(
      before - q.state.friend.hp,
      role === "friend" ? 12 : role === "guards" ? 3.5 : 1.5,
    );
  }
});

test("empty food without living workers does not accumulate a shortage penalty", () => {
  const s = start();
  s.food = 0;
  advance(s, 30);
  assert.equal(s.foodShortage, 0);
  assert.equal(workerEfficiency(s), 1);
});
