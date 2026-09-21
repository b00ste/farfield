import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  createState,
  MODULES,
  placementError,
  rotated,
  tick,
  type Module,
} from "../games/farfield/engine.ts";
import { createActor } from "../games/farfield/actors.ts";

function fixture() {
  const state = createState();
  state.attackWaves = false;
  applyCommand(state, { type: "start" });
  const wreck: Module = {
    id: 900,
    type: "passage",
    cells: rotated(1, 0).map((p) => ({ x: p.x + 1, y: p.y - 1 })),
    progress: 1,
    owner: "Commander",
    hp: 0,
    wreck: true,
  };
  state.modules.push(wreck);
  return { state, wreck };
}
const rebuild = {
  type: "build",
  room: "turret",
  shape: 1,
  rotation: 0,
  x: 1,
  y: -1,
} as const;

test("own wreckage clears with no refund and its empty footprint accepts a normal building", () => {
  const { state, wreck } = fixture();
  const before = state.alloy;
  assert.equal(
    applyCommand(state, { type: "demolish", moduleId: wreck.id }),
    null,
  );
  assert.equal(state.modules.includes(wreck), false);
  assert.equal(state.alloy, before);
  assert.match(
    applyCommand(state, { type: "demolish", moduleId: wreck.id })!,
    /Choose your own/,
  );
  assert.equal(state.alloy, before);
  assert.equal(applyCommand(state, rebuild), null);
  assert.equal(state.alloy, before - MODULES.turret.alloy);
  assert.equal(state.modules.at(-1)!.type, "turret");
});

test("clearing occupied wreckage evacuates own units before removing walkable floor", () => {
  const { state, wreck } = fixture();
  Object.assign(state.friend, { x: 2, y: -1 });
  state.workers.push({
    ...createActor(),
    id: 901,
    role: "builders",
    x: 1,
    y: 0,
  });
  assert.equal(
    applyCommand(state, { type: "demolish", moduleId: wreck.id }),
    null,
  );
  assert.equal(wreck.dismantling, true);
  assert.equal(state.modules.includes(wreck), true);
  assert.equal(state.friend.evacuating, true);
  assert.equal(state.workers[0].evacuating, true);
  for (let i = 0; i < 80; i++) tick(state, 0.1);
  assert.equal(state.modules.includes(wreck), false);
  for (const actor of [state.friend, ...state.workers])
    assert.ok(
      state.modules.some(
        (m) =>
          m.progress >= 1 &&
          m.cells.some((p) => Math.hypot(p.x - actor.x, p.y - actor.y) < 0.01),
      ),
    );
});

test("rebuilding an entire safe own wreck footprint replaces flooring with a paid blueprint", () => {
  const { state, wreck } = fixture();
  state.friend.path = [{ x: 1, y: -1 }];
  const before = state.alloy;
  assert.equal(placementError(state, "turret", 1, 0, 1, -1), null);
  assert.equal(applyCommand(state, rebuild), null);
  assert.equal(state.modules.includes(wreck), false);
  const replacement = state.modules.at(-1)!;
  assert.equal(replacement.progress, 0);
  assert.equal(replacement.wreck, undefined);
  assert.deepEqual(replacement.cells, wreck.cells);
  assert.equal(state.alloy, before - MODULES.turret.alloy);
  assert.equal(state.friend.path.length, 0);
  assert.equal(
    new Set(state.modules.flatMap((m) => m.cells.map((p) => `${p.x},${p.y}`)))
      .size,
    8,
  );
});

test("reclaim rejects occupied floors, partial overlaps and insufficient alloy without mutating wreckage", () => {
  const { state, wreck } = fixture();
  const before = state.alloy;
  Object.assign(state.friend, { x: 1, y: -1 });
  assert.match(applyCommand(state, rebuild)!, /Move units off wreckage/);
  Object.assign(state.friend, { x: -1, y: -1 });
  assert.match(applyCommand(state, { ...rebuild, x: 2 })!, /occupied/);
  const enemy = { ...createActor(), x: 1, y: -1 };
  assert.match(applyCommand(state, rebuild, "Commander", [enemy])!, /enemy/);
  assert.match(
    applyCommand(state, { type: "demolish", moduleId: wreck.id }, "Commander", [
      enemy,
    ])!,
    /enemy/,
  );
  assert.equal(state.alloy, before);
  state.alloy = 0;
  assert.equal(applyCommand(state, rebuild), "Not enough alloy.");
  assert.equal(state.modules.includes(wreck), true);
  assert.equal(wreck.dismantling, undefined);
});

test("wreckage clearance and reclaim cannot sever completed station paths", () => {
  const { state, wreck } = fixture();
  state.modules.push({
    id: 901,
    type: "garden",
    cells: rotated(1, 0).map((p) => ({ x: p.x + 3, y: p.y - 1 })),
    progress: 1,
    owner: "Commander",
  });
  assert.match(
    applyCommand(state, { type: "demolish", moduleId: wreck.id })!,
    /disconnect/,
  );
  assert.match(applyCommand(state, rebuild)!, /disconnect/);
  assert.equal(state.modules.includes(wreck), true);
  assert.equal(wreck.dismantling, undefined);
});

test("rival and neutral wreckage remains protected from clearance and replacement", () => {
  for (const owner of ["Enemy", "neutral"]) {
    const { state, wreck } = fixture();
    state.modules = state.modules.filter((m) => m !== wreck);
    state.terrain = [{ ...wreck, owner }];
    assert.match(
      applyCommand(state, { type: "demolish", moduleId: wreck.id })!,
      /Choose your own/,
    );
    assert.match(applyCommand(state, rebuild)!, /occupied/);
    assert.equal(state.terrain.length, 1);
  }
});
