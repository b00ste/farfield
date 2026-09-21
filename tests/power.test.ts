import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  createState,
  energyProduction,
  rates,
  tick,
  type RoomType,
  type State,
  workPower,
  housing,
} from "../games/farfield/engine.ts";
import {
  BUILDING_POWER_UPKEEP,
  powerDemand,
  powerEfficiency,
} from "../games/farfield/economy.ts";
import {
  createActor,
  defenseEfficiency,
  routeTo,
} from "../games/farfield/actors.ts";
const near = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
function started() {
  const s = createState();
  s.attackWaves = false;
  applyCommand(s, { type: "start" });
  applyCommand(s, { type: "stop-friend" });
  return s;
}
function advance(s: State, seconds: number) {
  for (let i = 0; i < seconds * 10; i++) tick(s, 0.1);
}
test("power upkeep charges each completed own module once, including idle modules", () => {
  const s = started();
  for (const type of Object.keys(BUILDING_POWER_UPKEEP) as RoomType[]) {
    const module = { ...s.modules[0], id: s.nextId++, type };
    s.modules = [module];
    near(powerDemand(s), BUILDING_POWER_UPKEEP[type]);
    s.modules.push({ ...module, id: s.nextId++ });
    near(powerDemand(s), BUILDING_POWER_UPKEEP[type] * 2);
    s.terrain = [{ ...module, id: 999 }];
    near(powerDemand(s), BUILDING_POWER_UPKEEP[type] * 2);
  }
});
test("blueprints, wreckage and dismantling modules consume no power", () => {
  const s = started();
  const core = s.modules[0];
  s.modules.push(
    { ...core, id: s.nextId++, type: "foundry", progress: 0.9 },
    { ...core, id: s.nextId++, type: "turret", wreck: true },
    { ...core, id: s.nextId++, type: "garden", dismantling: true },
  );
  near(powerDemand(s), 0.02);
  s.modules[1].progress = 1;
  near(powerDemand(s), 0.14);
});
test("an unstaffed reactor has zero gross generation while station upkeep drains stored energy", () => {
  const s = started();
  s.modules.push({
    id: s.nextId++,
    type: "solar",
    cells: [
      { x: -1, y: 1 },
      { x: 0, y: 1 },
      { x: -1, y: 2 },
      { x: 0, y: 2 },
    ],
    progress: 1,
    owner: "Commander",
  });
  assert.equal(energyProduction(s), 0);
  near(rates(s).energy, -0.05);
  const before = s.energy;
  advance(s, 10);
  near(s.energy, before - 0.5);
  s.energy = 0.001;
  advance(s, 1);
  assert.equal(s.energy, 0, "upkeep cannot create a negative energy balance");
  assert.equal(applyCommand(s, { type: "direct", x: -1, y: 1 }), null);
  advance(s, 2);
  near(energyProduction(s), 0.9);
  near(rates(s).energy, 0.85);
  assert.ok(
    s.energy > 0,
    "the Friend can recover an empty energy reserve at the reactor",
  );
});

test("zero stored energy shuts staffed production, research, medical and turret work off immediately", () => {
  for (const role of [
    "miners",
    "farmers",
    "scientists",
    "medics",
    "guards",
  ] as const) {
    const s = started();
    s.workers.push({
      ...createActor(),
      id: 90,
      role,
      task: role,
      targetId: 1,
      working: true,
    });
    Object.assign(s.friend, { task: role, targetId: 1, working: true });
    assert.equal(workPower(s, role), 3);
    s.energy = 0;
    assert.equal(powerEfficiency(s), 0);
    assert.equal(workPower(s, role), 0);
    assert.equal(
      defenseEfficiency(s, 1),
      0,
      "even a Friend-operated turret is unpowered",
    );
    s.energy = 0.1;
    assert.equal(powerEfficiency(s), 1);
    assert.equal(
      workPower(s, role),
      3,
      "staff return to full work immediately when power returns",
    );
  }
});

test("reactors, construction, manual repair and core salvage remain available during an outage", () => {
  const s = started();
  s.energy = 0;
  for (const task of ["engineers", "build", "repair", "salvage"] as const) {
    Object.assign(s.friend, { task, working: true });
    assert.equal(workPower(s, task), 2);
  }
  s.workers.push({
    ...createActor(),
    id: 90,
    role: "engineers",
    task: "engineers",
    working: true,
  });
  Object.assign(s.friend, { task: "engineers", working: true });
  assert.equal(energyProduction(s), 1.35);
  assert.equal(
    applyCommand(s, {
      type: "build",
      room: "solar",
      shape: 1,
      rotation: 0,
      x: -1,
      y: 1,
    }),
    null,
  );
  s.workers = [];
  advance(s, 5);
  assert.equal(
    s.modules[1].progress,
    1,
    "the Friend can construct a reactor with no energy",
  );
  assert.ok(s.energy > 0);
});

test("recruitment freezes without power and resumes without recharging its cost", () => {
  const s = started();
  assert.equal(applyCommand(s, { type: "recruit", role: "builders" }), null);
  advance(s, 2);
  const progress = s.recruitQueue![0].progress;
  const alloy = s.alloy,
    food = s.food;
  s.energy = 0;
  advance(s, 10);
  assert.equal(s.recruitQueue![0].progress, progress);
  assert.equal(s.workers.length, 0);
  assert.equal(s.alloy, alloy);
  assert.equal(s.food, food);
  s.energy = 1;
  advance(s, 4);
  assert.equal(s.recruitQueue!.length, 0);
  assert.equal(s.workers.length, 1);
  assert.equal(s.alloy, alloy);
});

test("an outage retains floor paths and worker beds while upkeep stays fixed", () => {
  const s = started();
  s.modules.push({
    id: s.nextId++,
    type: "habitat",
    cells: [
      { x: -1, y: 1 },
      { x: 0, y: 1 },
      { x: -1, y: 2 },
      { x: 0, y: 2 },
    ],
    progress: 1,
    owner: "Commander",
  });
  const demand = powerDemand(s);
  s.energy = 0;
  assert.equal(housing(s), 6);
  assert.ok(routeTo(s, s.friend, [{ x: 0, y: 2 }]));
  near(powerDemand(s), demand);
  advance(s, 10);
  assert.equal(housing(s), 6);
  near(rates(s).energy, -demand);
});

test("a defensive expansion outgrows one staffed reactor and scales with more reactors", () => {
  const s = started();
  for (const [type, count] of [
    ["solar", 1], ["foundry", 2], ["garden", 3],
    ["habitat", 5], ["turret", 4], ["lab", 1],
  ] as const) {
    for (let i = 0; i < count; i++) {
      s.modules.push({ ...s.modules[0], id: s.nextId++, type });
    }
  }
  const reactor = s.modules.find((m) => m.type === "solar")!;
  for (let i = 0; i < 2; i++) s.workers.push({
    ...createActor(), id: s.nextId++, role: "engineers", task: "engineers",
    targetId: reactor.id, working: true,
  });
  near(energyProduction(s), 0.9);
  near(powerDemand(s), 1.93);
  assert.ok(rates(s).energy < -1, "a single reactor cannot maintain a defensive base");
  for (let i = 0; i < 2; i++) {
    const extra = { ...reactor, id: s.nextId++ };
    s.modules.push(extra);
    for (let j = 0; j < 2; j++) s.workers.push({
      ...createActor(), id: s.nextId++, role: "engineers", task: "engineers",
      targetId: extra.id, working: true,
    });
  }
  near(energyProduction(s), 2.7);
  near(rates(s).energy, 0.71);
});
