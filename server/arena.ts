import {
  applyCommand,
  placementError,
  rotated,
  MODULES,
  capacity,
  housing,
  workPower,
  type State,
  type BuildType,
  type Role,
  type Command,
} from "../games/farfield/engine.ts";
import { routeBeside, routeTo } from "../games/farfield/actors.ts";
export type Rival = {
  id: string;
  name: string;
  state: State;
  raidReadyAt: number;
  nextDecision: number;
  discovered: string[];
};
export function place(
  s: State,
  type: BuildType,
  toward?: { x: number; y: number },
): Command | null {
  if (s.alloy < MODULES[type].alloy || s.energy < MODULES[type].energy)
    return null;
  const objective = s.monoliths.find((m) => !m.connected) ?? s.monoliths[0];
  const destination =
    type === "passage" ? (toward ?? objective) : (s.spawn ?? { x: 0, y: 0 });
  const cells = s.modules
    .filter((m) => m.progress >= 1)
    .flatMap((m) => m.cells);
  const occupied = new Set(
    s.modules.flatMap((m) => m.cells.map((p) => `${p.x},${p.y}`)),
  );
  for (let rotation = 0; rotation < 4; rotation++) {
    const shape = rotated(s.nextShape, rotation),
      candidates = new Map<string, { x: number; y: number }>();
    for (const cell of cells)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const x = cell.x + dx,
          y = cell.y + dy;
        if (occupied.has(`${x},${y}`)) continue;
        for (const offset of shape)
          candidates.set(`${x - offset.x},${y - offset.y}`, {
            x: x - offset.x,
            y: y - offset.y,
          });
      }
    const sorted = [...candidates.values()].sort(
      (a, b) =>
        Math.hypot(a.x - destination.x, a.y - destination.y) -
        Math.hypot(b.x - destination.x, b.y - destination.y),
    );
    for (const p of sorted)
      if (!placementError(s, type, s.nextShape, rotation, p.x, p.y))
        return {
          type: "build",
          room: type,
          shape: s.nextShape,
          rotation,
          ...p,
        };
  }
  return null;
}
export function decide(bot: Rival, rivals: Rival[], _combatAt = 0) {
  const s = bot.state;
  if (
    s.phase !== "playing" ||
    s.paused ||
    s.time < bot.nextDecision ||
    s.friend.hp <= 0
  )
    return;
  bot.nextDecision = s.time + { easy: 6, normal: 3, hard: 1.5 }[s.difficulty];
  const core = s.modules.find((m) => m.type === "core")!;
  if (s.friend.hp < 35) {
    applyCommand(s, { type: "direct", ...core.cells[0], task: "move" }, bot.id);
    return;
  }
  const objective = [...s.monoliths]
    .filter((m) => m.ownerId !== bot.id)
    .sort(
      (a, b) =>
        Math.hypot(a.x - s.friend.x, a.y - s.friend.y) -
        Math.hypot(b.x - s.friend.x, b.y - s.friend.y),
    )[0];
  const essential: BuildType[] = [
    "foundry",
    "solar",
    "habitat",
    "garden",
    "turret",
  ];
  const missing = essential.find(
    (t) => !s.modules.some((m) => m.type === t && !m.wreck),
  );
  for (const [role, count] of [
    ["miners", 1],
    ["engineers", 1],
    ["farmers", 1],
    ["builders", 1],
    ["guards", 2],
  ] as [Role, number][]) {
    if (
      s.roles[role] < count &&
      (role === "builders" || capacity(s, role) > s.roles[role]) &&
      s.crew < housing(s) &&
      s.alloy >= 6 &&
      s.food >= 8
    ) {
      applyCommand(s, { type: "recruit", role }, bot.id);
      return;
    }
  }
  for (const w of s.workers.filter((w) => w.role === "guards"))
    w.stance = "follow";
  const enemy = rivals
    .filter((o) => o.id !== bot.id && o.state.phase === "playing")
    .find(
      (o) =>
        Math.hypot(
          o.state.friend.x - s.friend.x,
          o.state.friend.y - s.friend.y,
        ) <= 5 && o.state.friend.hp > 0,
    );
  if (enemy && !s.friend.path.length) {
    const path = routeTo(
      s,
      s.friend,
      [...s.modules, ...(s.terrain ?? [])]
        .filter((m) => m.progress >= 1)
        .flatMap((m) => m.cells)
        .filter(
          (t) =>
            Math.hypot(
              t.x - enemy.state.friend.x,
              t.y - enemy.state.friend.y,
            ) <= 2,
        ),
    );
    if (path?.length)
      applyCommand(
        s,
        { type: "direct", ...path.at(-1)!, task: "move" },
        bot.id,
      );
    return;
  }
  // Only personally observed enemy cores are valid siege objectives.
  const base = rivals
    .filter(
      (o) =>
        o.id !== bot.id &&
        bot.discovered.includes(o.id) &&
        o.state.phase === "playing",
    )
    .map((o) => ({ o, m: o.state.modules.find((m) => m.type === "core")! }))
    .find(({ m }) =>
      m.cells.some((t) => Math.hypot(t.x - s.friend.x, t.y - s.friend.y) <= 5),
    );
  if (base && s.roles.guards >= 2) {
    const path = routeTo(
      s,
      s.friend,
      [...s.modules, ...(s.terrain ?? [])]
        .filter((m) => m.progress >= 1)
        .flatMap((m) => m.cells)
        .filter((t) =>
          base.m.cells.some((v) => Math.hypot(t.x - v.x, t.y - v.y) <= 2),
        ),
    );
    if (path) {
      if (path.length)
        applyCommand(
          s,
          { type: "direct", ...path.at(-1)!, task: "move" },
          bot.id,
        );
      s.friend.attack = { playerId: base.o.id, moduleId: base.m.id };
      return;
    }
  }
  if (!missing && objective) {
    const path = routeTo(
      s,
      s.friend,
      [...s.modules, ...(s.terrain ?? [])]
        .filter((m) => m.progress >= 1)
        .flatMap((m) => m.cells)
        .filter((t) => Math.hypot(t.x - objective.x, t.y - objective.y) <= 2.5),
    );
    if (path) {
      if (path.length && !s.friend.path.length)
        applyCommand(
          s,
          { type: "direct", ...path.at(-1)!, task: "move" },
          bot.id,
        );
      return;
    }
  }
  if (s.modules.some((m) => m.progress < 1)) return;
  const type: BuildType =
    s.crew >= housing(s) && housing(s) < 10
      ? "habitat"
      : (missing ?? "passage");
  const command = place(s, type, objective);
  if (command) applyCommand(s, command, bot.id);
  else {
    const m = s.modules.find(
      (m) =>
        m.type ===
          (s.food < 10 ? "garden" : s.alloy < 18 ? "foundry" : "solar") &&
        m.progress >= 1,
    );
    if (m) applyCommand(s, { type: "direct", ...m.cells[0] }, bot.id);
  }
}
