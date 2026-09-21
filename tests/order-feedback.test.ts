import test from "node:test";
import assert from "node:assert/strict";
import { createState, MODULES } from "../games/farfield/engine.ts";
import {
  attackTarget,
  commandPoint,
  friendOrder,
  workIsUnpowered,
} from "../games/farfield/order-feedback.ts";

test("attack feedback identifies the target owner even when module IDs collide", () => {
  const s = createState();
  s.terrain = [
    { ...s.modules[0], id: 2, owner: "other", type: "solar" },
    { ...s.modules[0], id: 2, owner: "enemy", type: "turret" },
  ];
  s.friend.attack = { playerId: "enemy", moduleId: 2 };
  assert.equal(attackTarget(s)?.label, "Defense");
  s.friend.path = [{ x: 1, y: 1 }];
  assert.equal(friendOrder(s), "Approaching · Defense");
  s.terrain = s.terrain.filter((m) => m.owner !== "enemy");
  assert.equal(attackTarget(s), null);
  assert.equal(
    commandPoint(s, { type: "attack", target: "enemy", moduleId: 2 }),
    null,
  );
  assert.equal(friendOrder(s), "Target out of sight");
});

test("enemy worker feedback does not fall back to its commander or a hidden target", () => {
  const s = createState();
  s.visibleUnits = [
    {
      id: "enemy:friend",
      playerId: "enemy",
      hero: true,
      x: 5,
      y: 5,
      hp: 120,
      maxHp: 120,
      color: "red",
      name: "Rival",
    },
  ];
  const attack = { playerId: "enemy", unitId: 3 };
  assert.equal(attackTarget(s, attack), null);
  s.visibleUnits.push({
    ...s.visibleUnits[0],
    id: "enemy:3",
    hero: false,
    x: 2,
    y: 2,
  });
  assert.deepEqual(attackTarget(s, attack), {
    point: { x: 2, y: 2 },
    label: "Enemy worker",
  });
});

test("stationary work reports power off while reactor and manual recovery tasks stay available", () => {
  const s = createState();
  s.energy = 0;
  s.friend.working = true;
  for (const [task, building] of [
    ["miners", "foundry"],
    ["farmers", "garden"],
    ["scientists", "lab"],
    ["medics", "infirmary"],
    ["guards", "turret"],
  ] as const) {
    s.modules[0].type = building;
    s.friend.task = task;
    assert.equal(workIsUnpowered(s, s.friend), true);
    assert.equal(friendOrder(s), `Power off · ${MODULES[building].name}`);
    s.friend.path = [{ x: 0, y: 0 }];
    assert.equal(friendOrder(s), `Moving · ${MODULES[building].name}`);
    s.friend.path = [];
    s.energy = 1;
    assert.equal(workIsUnpowered(s, s.friend), false);
    assert.ok(!friendOrder(s).includes("Power off"));
    s.energy = 0;
  }
  for (const task of ["engineers", "build", "repair", "salvage"] as const) {
    s.friend.task = task;
    assert.equal(workIsUnpowered(s, s.friend), false);
    assert.ok(!friendOrder(s).includes("Power off"));
  }
});
