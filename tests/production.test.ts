import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  createState,
  rates,
  tick,
  WORKER_FOOD_UPKEEP,
  powerDemand,
  type BuildType,
  type Role,
  type State,
} from "../games/farfield/engine.ts";

const producers = [
  { room: "foundry", role: "miners", resource: "alloy", output: 0.3 },
  { room: "solar", role: "engineers", resource: "energy", output: 0.45 },
  { room: "garden", role: "farmers", resource: "food", output: 0.8 },
] as const satisfies readonly {
  room: BuildType;
  role: Role;
  resource: "alloy" | "energy" | "food";
  output: number;
}[];

function consumption(s: State, resource: "alloy" | "energy" | "food") {
  return resource === "energy"
    ? powerDemand(s)
    : resource === "food"
      ? s.workers.filter((worker) => worker.hp > 0).length * WORKER_FOOD_UPKEEP
      : 0;
}
function advance(s: State, seconds: number) {
  for (let i = 0; i < seconds * 10; i++) tick(s, 0.1);
}
function started() {
  const s = createState();
  s.attackWaves = false;
  assert.equal(applyCommand(s, { type: "start" }), null);
  return s;
}
function completed(room: BuildType) {
  const s = started();
  assert.equal(
    applyCommand(s, {
      type: "build",
      room,
      shape: 1,
      rotation: 0,
      x: -1,
      y: 1,
    }),
    null,
  );
  advance(s, 5);
  assert.equal(s.modules[1].progress, 1);
  return s;
}

test("an idle core and unstaffed production buildings generate no resources", () => {
  for (const room of [null, ...producers.map((p) => p.room)]) {
    const s = room ? completed(room) : started();
    assert.equal(applyCommand(s, { type: "stop-friend" }), null);
    const before = { alloy: s.alloy, energy: s.energy, food: s.food };
    assert.deepEqual(rates(s), { alloy: 0, energy: -powerDemand(s), food: 0 });
    advance(s, 10);
    assert.equal(s.alloy, before.alloy);
    assert.equal(s.food, before.food);
    assert.ok(
      Math.abs(s.energy - (before.energy - powerDemand(s) * 10)) < 1e-9,
    );
  }
});

test("queued and walking workers do not produce; on-site workers produce until unassigned", () => {
  for (const producer of producers) {
    const s = completed(producer.room);
    assert.equal(applyCommand(s, { type: "stop-friend" }), null);
    assert.equal(
      applyCommand(s, {
        type: "recruit",
        role: producer.role,
        moduleId: s.modules[1].id,
      }),
      null,
    );
    assert.equal(
      rates(s)[producer.resource],
      -consumption(s, producer.resource) || 0,
      "queued labor cannot produce",
    );
    advance(s, 6);
    assert.equal(s.workers.length, 1);
    const upkeep = () => consumption(s, producer.resource);
    assert.equal(
      rates(s)[producer.resource],
      -upkeep() || 0,
      "recruits start at the core, not at work",
    );
    advance(s, 0.2);
    assert.equal(s.workers[0].task, "move");
    assert.equal(
      rates(s)[producer.resource],
      -upkeep() || 0,
      "walking is not production",
    );
    advance(s, 3);
    assert.equal(s.workers[0].task, producer.role);
    assert.equal(rates(s)[producer.resource], producer.output - upkeep());
    assert.equal(
      applyCommand(s, { type: "assign", role: producer.role, delta: -1 }),
      null,
    );
    assert.equal(
      rates(s)[producer.resource],
      -upkeep() || 0,
      "unassignment stops output immediately",
    );
    const before = s[producer.resource];
    advance(s, 2);
    assert.ok(
      s[producer.resource] <= before,
      "an empty producer cannot increase resources",
    );
  }
});

test("dismantling a staffed production building stops output while its worker evacuates", () => {
  for (const producer of producers) {
    const s = completed(producer.room);
    assert.equal(applyCommand(s, { type: "stop-friend" }), null);
    assert.equal(
      applyCommand(s, { type: "recruit", role: producer.role }),
      null,
    );
    advance(s, 10);
    assert.equal(s.workers[0].working, true);
    const building = s.modules[1];
    assert.equal(
      applyCommand(s, { type: "demolish", moduleId: building.id }),
      null,
    );
    assert.equal(s.workers[0].evacuating, true);
    const upkeep = () => consumption(s, producer.resource);
    assert.equal(rates(s)[producer.resource], -upkeep() || 0);
    advance(s, 5);
    assert.ok(!s.modules.some((m) => m.id === building.id));
    assert.equal(rates(s)[producer.resource], -upkeep() || 0);
  }
});

test("the Friend remains valid on-site labor and core salvage stops when the Friend leaves work", () => {
  for (const producer of producers) {
    const s = completed(producer.room);
    assert.equal(s.workers.length, 0);
    assert.equal(s.friend.task, producer.role);
    assert.equal(
      rates(s)[producer.resource],
      producer.output * 2 - consumption(s, producer.resource),
    );
    const before = s[producer.resource];
    advance(s, 1);
    assert.ok(s[producer.resource] > before);
    assert.equal(
      applyCommand(s, { type: "direct", x: -1, y: -1, task: "move" }),
      null,
    );
    assert.equal(
      rates(s)[producer.resource],
      -consumption(s, producer.resource) || 0,
    );
    advance(s, 3);
    assert.deepEqual(rates(s), { alloy: 0, energy: -powerDemand(s), food: 0 });
  }
  const s = started();
  advance(s, 0.1);
  assert.equal(s.friend.task, "salvage");
  assert.deepEqual(rates(s), { alloy: 0.3, energy: -powerDemand(s), food: 0 });
  assert.equal(applyCommand(s, { type: "stop-friend" }), null);
  assert.deepEqual(rates(s), { alloy: 0, energy: -powerDemand(s), food: 0 });
});
