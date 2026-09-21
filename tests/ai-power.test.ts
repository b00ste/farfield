import assert from "node:assert/strict";
import test from "node:test";
import { decide, type Rival } from "../server/arena.ts";
import {
  createState,
  tick,
  type RoomType,
  type Role,
  type State,
} from "../games/farfield/engine.ts";
import {
  createActor,
  assignedRoles,
  resetOrder,
} from "../games/farfield/actors.ts";
import { powerDemand } from "../games/farfield/economy.ts";

function fixture(types: RoomType[], roles: Role[]) {
  const s = createState(123, "hard");
  s.phase = "playing";
  s.attackWaves = false;
  s.alloy = s.food = 200;
  s.energy = 60;
  types.forEach((type, index) =>
    s.modules.push({
      id: s.nextId++,
      type,
      owner: "bot",
      progress: 1,
      cells: [
        { x: index * 2 + 1, y: -1 },
        { x: index * 2 + 2, y: -1 },
        { x: index * 2 + 1, y: 0 },
        { x: index * 2 + 2, y: 0 },
      ],
    }),
  );
  const workplace: Record<Role, RoomType> = {
    builders: "core",
    engineers: "solar",
    miners: "foundry",
    farmers: "garden",
    guards: "turret",
    scientists: "lab",
    medics: "infirmary",
  };
  for (const role of roles) {
    const module = s.modules.find((m) => m.type === workplace[role])!;
    const worker = {
      ...createActor(),
      ...module.cells[0],
      id: s.nextId++,
      role,
    };
    resetOrder(worker, module.id);
    s.workers.push(worker);
  }
  assignedRoles(s);
  resetOrder(s.friend, null, "idle");
  const bot: Rival = {
    id: "bot",
    name: "AI",
    state: s,
    raidReadyAt: 0,
    nextDecision: 0,
    discovered: [],
  };
  return { s, bot };
}

function step(s: State, seconds: number) {
  for (let i = 0; i < seconds * 10; i++) tick(s, 0.1);
}

test("AI grows reactor capacity and engineer recruitment beyond two for a larger station", () => {
  const { s, bot } = fixture(
    [
      "solar",
      "foundry",
      "garden",
      "habitat",
      "habitat",
      "habitat",
      "turret",
      "turret",
      "turret",
      "turret",
    ],
    [
      "engineers",
      "engineers",
      "miners",
      "farmers",
      "farmers",
      "builders",
      "guards",
      "guards",
    ],
  );
  assert.ok(powerDemand(s) > 0.9);
  decide(bot, [bot]);
  assert.equal(s.modules.filter((m) => m.type === "solar").length, 2);
  assert.equal(s.modules.at(-1)!.progress, 0);
  step(s, 2);
  decide(bot, [bot]);
  assert.equal(
    s.modules.filter((m) => m.type === "solar").length,
    2,
    "Pending reactor capacity prevents duplicate expansion",
  );
  for (let i = 0; i < 600; i++) {
    tick(s, 0.1);
    decide(bot, [bot]);
    if (
      s.roles.engineers +
        (s.recruitQueue ?? []).filter((q) => q.role === "engineers").length >
      2
    )
      break;
  }
  assert.ok(
    s.roles.engineers +
      (s.recruitQueue ?? []).filter((q) => q.role === "engineers").length >
      2,
    "The expanded reactor must be staffed, not just constructed",
  );
});

test("an unpowered AI uses its Friend at a reactor and fills a reserve before leaving", () => {
  const { s, bot } = fixture(
    ["solar", "foundry", "garden"],
    ["miners", "farmers"],
  );
  s.energy = 0;
  const reactor = s.modules.find((m) => m.type === "solar")!;
  decide(bot, [bot]);
  assert.equal(s.friend.targetId, reactor.id);
  assert.equal(
    s.recruitQueue!.length,
    0,
    "Outage recovery cannot depend on powered recruitment",
  );
  step(s, 6);
  assert.ok(s.energy > 0, "Manual reactor work must restore power");
  assert.equal(s.friend.task, "engineers");
  decide(bot, [bot]);
  assert.equal(
    s.friend.targetId,
    reactor.id,
    "Do not abandon recovery at a tiny positive energy balance",
  );
  assert.equal(
    s.modules.length,
    4,
    "Wait for a reserve before adding more powered demand",
  );
});

test("AI reassigns an existing free worker to power without food or a recruitment delay", () => {
  const { s, bot } = fixture(["solar", "garden"], ["builders", "farmers"]);
  s.energy = s.food = s.alloy = 0;
  decide(bot, [bot]);
  assert.equal(s.roles.engineers, 1);
  assert.equal(s.roles.builders, 0);
  assert.equal(s.recruitQueue!.length, 0);
  assert.equal(s.food, 0);
});

test("AI replaces a missing reactor during an outage or salvages alloy to afford it", () => {
  const { s, bot } = fixture(["foundry", "garden"], []);
  s.energy = 0;
  decide(bot, [bot]);
  assert.equal(s.modules.at(-1)!.type, "solar");
  assert.equal(s.modules.at(-1)!.progress, 0);

  const poor = fixture(["foundry", "garden"], []);
  poor.s.energy = poor.s.alloy = 0;
  decide(poor.bot, [poor.bot]);
  assert.equal(poor.s.friend.targetId, poor.s.modules[0].id);
  step(poor.s, 3);
  assert.equal(poor.s.friend.task, "salvage");
  assert.ok(poor.s.alloy > 0, "Core salvage must still fund outage recovery");
  assert.equal(poor.s.modules.length, 3);
});

test("AI expands a full reactor when even the Friend cannot cover station demand", () => {
  const types: RoomType[] = [
    "solar",
    "garden",
    "foundry",
    "habitat",
    ...Array<RoomType>(10).fill("turret"),
  ];
  const { s, bot } = fixture(types, [
    "engineers",
    "engineers",
    "builders",
    "miners",
    "farmers",
    "guards",
  ]);
  s.energy = 0;
  assert.ok(powerDemand(s) > (s.roles.engineers + 2) * 0.45);
  decide(bot, [bot]);
  assert.equal(s.modules.at(-1)!.type, "solar");
  assert.equal(s.modules.at(-1)!.progress, 0);
  for (let i = 0; i < 1200 && s.energy === 0; i++) {
    tick(s, 0.1);
    decide(bot, [bot]);
  }
  assert.ok(
    s.energy > 0,
    "Adding capacity and reassigning staff must break the blackout",
  );
  assert.ok(s.roles.engineers > 2);

  const poor = fixture(types, [
    "engineers",
    "engineers",
    "builders",
    "miners",
    "farmers",
    "guards",
  ]);
  poor.s.energy = poor.s.alloy = 0;
  decide(poor.bot, [poor.bot]);
  assert.equal(poor.s.friend.targetId, poor.s.modules[0].id);
  step(poor.s, 3);
  assert.ok(
    poor.s.alloy > 0,
    "An empty alloy reserve must trigger core salvage, not an unproductive reactor vigil",
  );
});

test("a labor-wiped AI sheds safe noncritical load before rebuilding its power workforce", () => {
  const { s, bot } = fixture(
    ["solar", ...Array<RoomType>(8).fill("turret")],
    [],
  );
  s.energy = 0;
  const before = s.modules.length;
  for (let i = 0; i < 1200 && s.energy === 0; i++) {
    decide(bot, [bot]);
    tick(s, 0.1);
  }
  assert.ok(
    s.modules.length < before,
    "Remove excessive upkeep through normal dismantling",
  );
  assert.ok(s.modules.some((m) => m.type === "core"));
  assert.ok(s.modules.some((m) => m.type === "solar"));
  assert.ok(
    s.energy > 0,
    "The remaining reactor and Friend must restore positive power",
  );
});

test("load shedding can peel a safe passage extension when no optional room remains", () => {
  const { s, bot } = fixture(["solar"], []);
  // Four rows form a contiguous serpentine extension within the map bounds.
  for (let i = 0; i < 90; i++) {
    const row = Math.floor(i / 30),
      column = i % 30;
    s.modules.push({
      id: s.nextId++,
      owner: "bot",
      type: "passage",
      progress: 1,
      cells: [{ x: row % 2 ? 32 - column : column + 3, y: row - 1 }],
    });
  }
  s.energy = 0;
  assert.ok(powerDemand(s) > 0.9);
  const before = s.modules.length;
  decide(bot, [bot]);
  assert.ok(
    s.modules.length < before,
    "Connected passage leaves are a legitimate last-resort load reduction",
  );
  assert.ok(s.modules.some((m) => m.type === "solar"));
});
