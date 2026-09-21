import test from "node:test";
import assert from "node:assert/strict";
import {
  applyCommand,
  createState,
  rotated,
  type RoomType,
} from "../games/farfield/engine.ts";
import { createActor, assignedRoles } from "../games/farfield/actors.ts";
import { decide, type Rival } from "../server/arena.ts";
function fixture() {
  const state = createState(4821, "hard");
  state.attackWaves = false;
  applyCommand(state, { type: "start" });
  const add = (type: RoomType, x: number, y: number) =>
    state.modules.push({
      id: state.nextId++,
      type,
      owner: "bot",
      progress: 1,
      cells: rotated(1, 0).map((p) => ({ x: p.x + x, y: p.y + y })),
      hp: 100,
    });
  add("garden", 1, -1);
  add("habitat", 1, 1);
  add("foundry", -1, 1);
  const bot: Rival = {
    id: "bot",
    name: "AI",
    state,
    raidReadyAt: 0,
    nextDecision: 0,
    discovered: [],
  };
  return bot;
}
test("AI counts pending specialists rather than repeatedly filling the same job", () => {
  const bot = fixture();
  decide(bot, [bot]);
  assert.deepEqual(
    bot.state.recruitQueue!.map((q) => q.role),
    ["farmers"],
  );
  bot.state.time = 1.5;
  decide(bot, [bot]);
  assert.deepEqual(
    bot.state.recruitQueue!.map((q) => q.role),
    ["farmers", "miners"],
  );
  assert.equal(
    bot.state.workers.length,
    0,
    "AI obeys the same recruitment delay",
  );
});
test("hungry AI reassigns a free builder to farming before recruiting more", () => {
  const bot = fixture(),
    s = bot.state;
  s.workers.push({
    ...createActor(),
    id: s.nextId++,
    role: "builders",
    hp: 60,
    maxHp: 60,
  });
  assignedRoles(s);
  s.food = 2;
  decide(bot, [bot]);
  assert.equal(s.roles.farmers, 1);
  assert.equal(s.recruitQueue!.length, 0);
  assert.equal(
    s.workers[0].targetId,
    s.modules.find((m) => m.type === "garden")!.id,
  );
});
