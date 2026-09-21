import test from "node:test";
import assert from "node:assert/strict";
import {
  createState,
  applyCommand,
  tick,
  rates,
  workPower,
  type BuildType,
  type Role,
  type State,
} from "../games/farfield/engine.ts";
import { routeTo, housing, TASK_LABELS } from "../games/farfield/actors.ts";
function advance(s: State, seconds: number) {
  for (let i = 0; i < seconds * 10; i++) tick(s, 0.1);
}
function started() {
  const s = createState();
  s.attackWaves = false;
  applyCommand(s, { type: "start" });
  return s;
}
function build(s: State, room: BuildType) {
  assert.equal(
    applyCommand(s, {
      type: "build",
      room,
      shape: s.nextShape,
      rotation: 0,
      x: -1,
      y: 1,
    }),
    null,
  );
}
test("Friend starts alone, walks to a blueprint and must actually work to construct it", () => {
  const s = started();
  assert.equal(s.workers.length, 0);
  build(s, "foundry");
  tick(s, 0.1);
  assert.ok(s.friend.y > -1 && s.friend.y < 0);
  assert.equal(s.friend.task, "move");
  assert.equal(s.modules[1].progress, 0);
  applyCommand(s, { type: "stop-friend" });
  advance(s, 3);
  assert.equal(s.modules[1].progress, 0, "No invisible passive construction");
  applyCommand(s, { type: "direct", x: -1, y: 1 });
  advance(s, 5);
  assert.equal(s.modules[1].progress, 1);
  assert.equal(s.friend.task, "miners");
  assert.equal(workPower(s, "miners"), 2);
  assert.ok(s.friend.y >= 1);
  assert.equal(rates(s).alloy, 0.6);
  assert.ok(s.friendWork.alloy > 0);
});
test("Friend can operate every specialist building without hiring workers", () => {
  for (const [module, role] of [
    ["foundry", "miners"],
    ["solar", "engineers"],
    ["garden", "farmers"],
    ["turret", "guards"],
    ["lab", "scientists"],
  ] as [BuildType, Exclude<Role, "builders">][]) {
    const s = started();
    build(s, module);
    advance(s, 5);
    assert.equal(s.friend.task, role);
    assert.equal(workPower(s, role), 2);
    assert.equal(s.crew, 0);
  }
});
test("the Friend rests at an infirmary without counting as a medic", () => {
  const s = started();
  build(s, "infirmary");
  advance(s, 5);
  assert.equal(s.modules[1].progress, 1);
  assert.equal(s.friend.task, "rest");
  assert.equal(TASK_LABELS[s.friend.task], "Resting at infirmary");
  assert.equal(workPower(s, "medics"), 0);
  assert.equal(s.crew, 0);
});
test("helpers spawn at the core and only produce after walking to their own workplace", () => {
  const s = started();
  build(s, "foundry");
  advance(s, 5);
  applyCommand(s, { type: "stop-friend" });
  assert.equal(
    applyCommand(s, {
      type: "recruit",
      role: "miners",
      moduleId: s.modules[1].id,
    }),
    null,
  );
  assert.equal(
    s.workers.length,
    0,
    "recruitment reserves a slot before spawning",
  );
  advance(s, 6);
  const worker = s.workers[0];
  assert.equal(worker.x, -1);
  assert.equal(worker.y, -1);
  assert.equal(workPower(s, "miners"), 0);
  advance(s, 0.2);
  assert.equal(worker.task, "move");
  assert.equal(workPower(s, "miners"), 0);
  advance(s, 3);
  assert.equal(workPower(s, "miners"), 1);
  assert.equal(worker.targetId, s.modules[1].id);
  assert.equal(rates(s).alloy, 0.3);
  assert.equal(s.roles.miners, 1);
  assert.equal(s.roles.builders, 0);
  assert.equal(
    applyCommand(s, { type: "assign", role: "miners", delta: -1 }),
    null,
  );
  advance(s, 0.1);
  assert.equal(workPower(s, "miners"), 0);
});
test("a recruited builder can finish work while the Friend is stopped", () => {
  const s = started();
  assert.equal(applyCommand(s, { type: "recruit", role: "builders" }), null);
  build(s, "solar");
  applyCommand(s, { type: "stop-friend" });
  advance(s, 14);
  assert.equal(s.modules[1].progress, 1);
  assert.equal(s.friend.task, "idle");
  assert.equal(s.roles.builders, 1);
});
test("Friend routes use connected floors and reject empty space or invalid orders", () => {
  const s = started();
  s.modules.push({
    id: 90,
    type: "passage",
    progress: 1,
    owner: "test",
    cells: [
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
    ],
  });
  const route = routeTo(s, s.friend, [{ x: 2, y: 2 }])!;
  assert.ok(route.length >= 5);
  const tiles = new Set(
    s.modules.flatMap((m) => m.cells.map((p) => `${p.x},${p.y}`)),
  );
  assert.ok(route.every((p) => tiles.has(`${p.x},${p.y}`)));
  assert.match(applyCommand(s, { type: "direct", x: 9, y: 9 })!, /passage/);
  assert.match(applyCommand(s, { type: "direct", x: 0.1, y: 0 })!, /tile/);
  assert.equal(
    applyCommand(s, { type: "direct", x: 2, y: 2, task: "move" }),
    null,
  );
  advance(s, 3);
  assert.equal(s.friend.x, 2);
  assert.equal(s.friend.y, 2);
  assert.equal(s.friend.working, false);
});
test("recruitment checks beds, resources, completed workplaces and per-building slots before charging", () => {
  const s = started();
  build(s, "garden");
  assert.match(
    applyCommand(s, { type: "recruit", role: "farmers" })!,
    /completed/,
  );
  advance(s, 5);
  assert.equal(housing(s), 2);
  assert.equal(applyCommand(s, { type: "recruit", role: "farmers" }), null);
  assert.equal(applyCommand(s, { type: "recruit", role: "farmers" }), null);
  const before = JSON.stringify(s);
  assert.match(applyCommand(s, { type: "recruit", role: "builders" })!, /beds/);
  assert.equal(JSON.stringify(s), before);
  s.modules.push({
    id: 90,
    type: "habitat",
    progress: 1,
    cells: [{ x: 1, y: 0 }],
    owner: "test",
  });
  assert.match(
    applyCommand(s, { type: "recruit", role: "farmers" })!,
    /free slot/,
  );
});
test("Friend repairs and fights personally; pause freezes actors and work", () => {
  const s = started();
  s.integrity = 70;
  assert.equal(
    applyCommand(s, { type: "direct", x: -1, y: -1, task: "repair" }),
    null,
  );
  advance(s, 2);
  assert.ok(s.integrity >= 75);
  assert.ok(s.alloy < 65);
  s.integrity = 99.9;
  advance(s, 0.3);
  assert.equal(s.integrity, 100);
  assert.equal(
    s.friend.task,
    "salvage",
    "Friend resumes useful work when hull is restored",
  );
  const enemy = { id: 100, x: -1, y: 2, hp: 100, maxHp: 100 };
  s.enemies.push(enemy);
  advance(s, 0.5);
  assert.ok(enemy.hp < 96, "Friend blaster adds to core defense");
  applyCommand(s, { type: "pause" });
  const before = JSON.stringify(s);
  advance(s, 5);
  assert.equal(JSON.stringify(s), before);
});

test("connected blueprints queue ahead and are built from reachable floors in order", () => {
  for (const builder of [false, true]) {
    const s = started();
    if (builder)
      assert.equal(
        applyCommand(s, { type: "recruit", role: "builders" }),
        null,
      );
    for (const y of [1, 3, 5]) {
      s.nextShape = 1;
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
    }
    s.nextShape = 1;
    assert.match(
      applyCommand(s, {
        type: "build",
        room: "passage",
        shape: 1,
        rotation: 0,
        x: -1,
        y: 3,
      })!,
      /occupied/,
    );
    assert.match(
      applyCommand(s, {
        type: "build",
        room: "passage",
        shape: 1,
        rotation: 0,
        x: 9,
        y: 9,
      })!,
      /Connect/,
    );
    assert.match(
      applyCommand(s, { type: "direct", x: -1, y: 5, task: "move" })!,
      /Finish/,
    );
    if (builder) applyCommand(s, { type: "stop-friend" });
    for (let i = 0; i < 320; i++) {
      tick(s, 0.1);
      const floor = new Set(
        s.modules
          .filter((m) => m.progress >= 1)
          .flatMap((m) => m.cells.map((p) => `${p.x},${p.y}`)),
      );
      for (const actor of [s.friend, ...s.workers])
        assert.ok(floor.has(`${Math.round(actor.x)},${Math.round(actor.y)}`));
      if (s.modules[2].progress > 0) assert.equal(s.modules[1].progress, 1);
      if (s.modules[3].progress > 0) assert.equal(s.modules[2].progress, 1);
    }
    assert.ok(s.modules.every((m) => m.progress === 1));
  }
});

test("recalling and reassigning a mobile guard clears its previous squad order", () => {
  for (const stance of ["follow", "defend"] as const) {
    const s = started();
    build(s, "turret");
    advance(s, 5);
    assert.equal(applyCommand(s, { type: "recruit", role: "guards" }), null);
    advance(s, 6);
    const guard = s.workers[0];
    guard.stance = stance;
    guard.defendAt = { x: -1, y: -1 };
    assert.equal(
      applyCommand(s, { type: "assign", role: "guards", delta: -1 }),
      null,
    );
    assert.equal(guard.stance, undefined);
    assert.equal(guard.defendAt, undefined);
    assert.equal(
      applyCommand(s, { type: "assign", role: "guards", delta: 1 }),
      null,
    );
    assert.equal(
      applyCommand(s, { type: "direct", x: -1, y: -1, task: "move" }),
      null,
    );
    advance(s, 4);
    assert.equal(guard.targetId, s.modules[1].id);
    assert.equal(guard.task, "guards");
    assert.equal(workPower(s, "guards", s.modules[1].id), 1);
  }
});

test("workers clearing a dismantled building cannot be reassigned before reaching safety", () => {
  const s = started();
  build(s, "garden");
  advance(s, 5);
  assert.equal(applyCommand(s, { type: "recruit", role: "farmers" }), null);
  advance(s, 10);
  const garden = s.modules[1];
  s.modules.push({
    id: 99,
    type: "garden",
    progress: 1,
    owner: "Commander",
    cells: [{ x: -2, y: -1 }],
  });
  assert.equal(
    applyCommand(s, { type: "demolish", moduleId: garden.id }),
    null,
  );
  assert.equal(s.workers[0].evacuating, true);
  const before = JSON.stringify(s.workers[0]);
  assert.match(
    applyCommand(s, { type: "assign", role: "farmers", delta: 1 })!,
    /clearing/i,
  );
  assert.equal(JSON.stringify(s.workers[0]), before);
  advance(s, 5);
  assert.equal(s.workers[0].evacuating, false);
  assert.ok(!s.modules.includes(garden));
});

test("a work command cannot send the Friend back onto a dismantling building", () => {
  const s = started();
  build(s, "garden");
  advance(s, 5);
  const garden = s.modules[1];
  assert.equal(
    applyCommand(s, { type: "demolish", moduleId: garden.id }),
    null,
  );
  const before = JSON.stringify(s.friend);
  assert.match(
    applyCommand(s, { type: "direct", ...garden.cells[0] })!,
    /dismantled/,
  );
  assert.equal(JSON.stringify(s.friend), before);
  advance(s, 5);
  assert.ok(!s.modules.includes(garden));
});
