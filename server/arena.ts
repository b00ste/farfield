import {
  applyCommand,
  placementError,
  rotated,
  MODULES,
  capacity,
  housing,
  energyProduction,
  recruitmentError,
  WORKER_FOOD_UPKEEP,
  type State,
  type BuildType,
  type Role,
  type Command,
} from "../games/farfield/engine.ts";
import { routeTo } from "../games/farfield/actors.ts";
import {
  BUILDING_POWER_UPKEEP,
  ENGINEER_ENERGY_RATE,
  powerDemand,
} from "../games/farfield/economy.ts";
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
  const queued = s.recruitQueue ?? [];
  const roleTotal = (role: Role) =>
    s.roles[role] + queued.filter((entry) => entry.role === role).length;
  // Staff for the completed station AND construction already committed. Keep a
  // small surplus to recharge abilities rather than spending down stored power.
  const projectedDemand =
    powerDemand(s) +
    s.modules.reduce(
      (total, m) =>
        total +
        (m.progress < 1 && !m.wreck && !m.dismantling
          ? BUILDING_POWER_UPKEEP[m.type]
          : 0),
      0,
    );
  const engineerTarget = Math.max(
    1,
    Math.ceil((projectedDemand + 0.3) / ENGINEER_ENERGY_RATE),
  );
  const reactors = s.modules.filter(
    (m) => m.type === "solar" && !m.wreck && !m.dismantling,
  );
  const completedReactors = reactors.filter((m) => m.progress >= 1);
  const engineeringSlots = completedReactors.length * 2;
  const urgentPower =
    s.energy < 12 && energyProduction(s) < powerDemand(s) + 0.05;
  const needsMoreThanFriend =
    (s.roles.engineers + 2) * ENGINEER_ENERGY_RATE <= powerDemand(s);
  const powerExpansion = roleTotal("engineers") < engineerTarget;
  const constructing = s.modules.some((m) => m.progress < 1);

  // A free builder can staff an existing reactor without food, a recruitment
  // delay, or power. During an outage, move a mobile guard off combat duty too.
  if (
    powerExpansion &&
    s.roles.engineers < engineeringSlots &&
    s.roles.builders > (constructing && !urgentPower ? 1 : 0)
  ) {
    if (
      applyCommand(
        s,
        { type: "assign", role: "engineers", delta: 1 },
        bot.id,
      ) === null
    )
      return;
  }
  if (
    urgentPower &&
    powerExpansion &&
    s.roles.engineers < engineeringSlots &&
    !s.roles.builders
  ) {
    const spare = (
      ["guards", "scientists", "medics", "miners", "farmers"] as Role[]
    ).find(
      (role) =>
        s.roles[role] >
        ((role === "miners" || role === "farmers") && !needsMoreThanFriend
          ? 1
          : 0),
    );
    if (
      spare &&
      applyCommand(s, { type: "assign", role: spare, delta: -1 }, bot.id) ===
        null
    ) {
      applyCommand(s, { type: "assign", role: "engineers", delta: 1 }, bot.id);
      return;
    }
  }
  if (urgentPower && needsMoreThanFriend) {
    // Without any extra labor, another empty reactor cannot fix the deficit.
    // Shed nonessential load through ordinary safe dismantling first. The
    // engine rejects bridges/occupied enemy flooring and handles evacuation.
    if (s.crew === s.roles.engineers) {
      const expendable = s.modules
        .filter(
          (m) =>
            m.progress >= 1 &&
            !m.wreck &&
            !m.dismantling &&
            m.type !== "core" &&
            m.type !== "solar",
        )
        .sort(
          (a, b) =>
            // Preserve food/alloy workplaces until safe non-production load
            // (including long passage extensions) has been tried first.
            Number(a.type === "garden" || a.type === "foundry") -
              Number(b.type === "garden" || b.type === "foundry") ||
            BUILDING_POWER_UPKEEP[b.type] - BUILDING_POWER_UPKEEP[a.type],
        );
      for (const m of expendable) {
        if (
          applyCommand(
            s,
            { type: "demolish", moduleId: m.id },
            bot.id,
            rivals
              .filter((other) => other !== bot)
              .flatMap((other) => [other.state.friend, ...other.state.workers]),
          ) === null
        )
          return;
      }
    }
    const unfinishedReactor = reactors.find((m) => m.progress < 1);
    if (unfinishedReactor) {
      if (s.friend.targetId !== unfinishedReactor.id)
        applyCommand(
          s,
          { type: "direct", ...unfinishedReactor.cells[0] },
          bot.id,
        );
      return;
    }
    if (engineeringSlots < engineerTarget && !constructing) {
      const reactor = place(s, "solar");
      if (reactor) applyCommand(s, reactor, bot.id);
      else applyCommand(s, { type: "direct", ...core.cells[0] }, bot.id);
      return;
    }
  }
  if (urgentPower && completedReactors.length) {
    const reactor = completedReactors[0];
    if (s.friend.targetId !== reactor.id || s.friend.order !== "work")
      applyCommand(s, { type: "direct", ...reactor.cells[0] }, bot.id);
    return;
  }
  if (urgentPower && !reactors.length && !constructing) {
    const reactor = place(s, "solar");
    if (reactor) applyCommand(s, reactor, bot.id);
    else applyCommand(s, { type: "direct", ...core.cells[0] }, bot.id);
    return;
  }
  const farmerTarget = Math.max(
    1,
    Math.ceil(((s.crew + queued.length + 1) * WORKER_FOOD_UPKEEP) / 0.8),
  );
  const garden = s.modules.find(
    (m) => m.type === "garden" && m.progress >= 1 && !m.wreck && !m.dismantling,
  );
  // Fix the economy before expanding the army. Pending recruits reserve jobs too.
  if (s.food < 16 && garden && roleTotal("farmers") < farmerTarget) {
    if (s.roles.builders && s.roles.farmers < capacity(s, "farmers")) {
      if (
        applyCommand(
          s,
          { type: "assign", role: "farmers", delta: 1 },
          bot.id,
        ) === null
      )
        return;
    }
    if (s.food < 8) {
      if (s.friend.targetId !== garden.id || s.friend.task !== "farmers")
        applyCommand(s, { type: "direct", ...garden.cells[0] }, bot.id);
      return;
    }
  }
  if (s.friend.task === "farmers" && s.food < 24) return;
  const essential: BuildType[] = [
    "foundry",
    "garden",
    "habitat",
    "solar",
    "turret",
  ];
  const missing = essential.find(
    (t) => !s.modules.some((m) => m.type === t && !m.wreck),
  );
  for (const [role, count] of [
    ["farmers", farmerTarget],
    ["miners", 1],
    ["engineers", engineerTarget],
    ["builders", 1],
    ["guards", 2],
  ] as [Role, number][]) {
    if (roleTotal(role) < count && !recruitmentError(s, role)) {
      applyCommand(s, { type: "recruit", role }, bot.id);
      return;
    }
  }
  // Do not immediately abandon a recovery reactor for a new build at 1 energy.
  // Staffing/recruitment above still runs so this temporary job can be handed off.
  if (s.friend.task === "engineers" && s.energy < 35) return;
  // Construction capacity and beds must grow along with power staffing; do
  // this before the Friend leaves to capture an objective. Existing engineers
  // and queued recruits prevent repeated emergency orders while they walk in.
  if (
    !constructing &&
    reactors.length * 2 < engineerTarget &&
    (reactors.length > 0 || urgentPower)
  ) {
    const reactor = place(s, "solar");
    if (reactor) {
      applyCommand(s, reactor, bot.id);
      return;
    }
  }
  if (powerExpansion && s.crew + queued.length >= housing(s) && !constructing) {
    const quarters = place(s, "habitat");
    if (quarters) {
      applyCommand(s, quarters, bot.id);
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
    capacity(s, "farmers") < farmerTarget &&
    !s.modules.some((m) => m.type === "garden" && m.progress < 1)
      ? "garden"
      : s.crew + queued.length >= housing(s) && housing(s) < 10
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
