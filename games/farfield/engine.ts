import {
  createActor,
  assignedRoles,
  housing,
  resetOrder,
  routeTo,
  routeBeside,
  updateActors,
  workplace,
  workPower,
  type Actor,
  type Worker,
} from "./actors.ts";
export { housing, workPower } from "./actors.ts";
export type Point = { x: number; y: number };
export type RoomType =
  | "core"
  | "passage"
  | "solar"
  | "garden"
  | "foundry"
  | "habitat"
  | "turret"
  | "lab"
  | "infirmary";
export type Role =
  | "builders"
  | "engineers"
  | "farmers"
  | "miners"
  | "guards"
  | "scientists"
  | "medics";
export type BuildType = Exclude<RoomType, "core">;
export const MODULES: Record<
  RoomType,
  {
    name: string;
    color: string;
    alloy: number;
    energy: number;
    description: string;
    glyph: string;
  }
> = {
  core: {
    name: "Command",
    color: "#ebe6c9",
    alloy: 0,
    energy: 0,
    description:
      "Your healing point. Rest nearby to recover after combat. Your Friend salvages alloy here; Friend and builders can repair the core. Two worker beds.",
    glyph: "◈",
  },
  passage: {
    name: "Passage",
    color: "#8a9aaf",
    alloy: 4,
    energy: 0,
    description: "Connect your station. Reach into the unknown.",
    glyph: "┼",
  },
  solar: {
    name: "Reactor",
    color: "#e7c66b",
    alloy: 12,
    energy: 0,
    description:
      "Powers your Friend’s Shield and EMP abilities. Your Friend can operate it, or recruit an engineer.",
    glyph: "ϟ",
  },
  garden: {
    name: "Garden",
    color: "#8ebba2",
    alloy: 10,
    energy: 0,
    description:
      "Grows food to recruit and feed workers. Your Friend can farm here, or recruit a farmer.",
    glyph: "♧",
  },
  foundry: {
    name: "Foundry",
    color: "#dba17e",
    alloy: 14,
    energy: 0,
    description:
      "Makes alloy for buildings, worker equipment and repairs. Your Friend can mine here, or recruit a miner.",
    glyph: "⬡",
  },
  habitat: {
    name: "Quarters",
    color: "#b4a0d5",
    alloy: 14,
    energy: 0,
    description:
      "Adds room for four workers. Recruit each worker separately for 6 alloy and 8 food.",
    glyph: "⌂",
  },
  turret: {
    name: "Defense",
    color: "#db8593",
    alloy: 16,
    energy: 0,
    description:
      "A staffed turret deals 8 damage per second within 5 tiles. EMP disables it temporarily. Guards can follow your Friend or hold ground.",
    glyph: "⊕",
  },
  infirmary: {
    name: "Infirmary",
    color: "#a8d9c5",
    alloy: 16,
    energy: 0,
    description:
      "Assign a medic to heal nearby allies out of combat. A forward retreat point.",
    glyph: "✚",
  },
  lab: {
    name: "Research",
    color: "#81bbc8",
    alloy: 18,
    energy: 0,
    description:
      "Scientists decode anomalies 25% faster each, up to twice as fast. Your Friend must still reach and hold the monolith in person.",
    glyph: "◇",
  },
};
export const SHAPES = [
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [3, 0],
  ],
  [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [2, 0],
    [1, 1],
  ],
  [
    [0, 0],
    [0, 1],
    [0, 2],
    [1, 2],
  ],
  [
    [1, 0],
    [1, 1],
    [1, 2],
    [0, 2],
  ],
  [
    [1, 0],
    [2, 0],
    [0, 1],
    [1, 1],
  ],
  [
    [0, 0],
    [1, 0],
    [1, 1],
    [2, 1],
  ],
] as const;
export const ROLES: Role[] = [
  "builders",
  "engineers",
  "farmers",
  "miners",
  "guards",
  "scientists",
  "medics",
];
export const BOUND = 40;
export type Module = {
  id: number;
  type: RoomType;
  cells: Point[];
  progress: number;
  owner: string;
  hp?: number;
  disabledUntil?: number;
  staffed?: boolean;
  wreck?: boolean;
  dismantling?: boolean;
};
export type Enemy = Point & {
  id: number;
  hp: number;
  maxHp: number;
  sourceName?: string;
};
export type Monolith = Point & {
  name: string;
  progress: number;
  connected: boolean;
  ownerId?: string | null;
  ownerName?: string;
  claimant?: string | null;
  contested?: boolean;
};
export type Difficulty = "easy" | "normal" | "hard";
export const DIFFICULTIES = {
  easy: { firstWave: 240, interval: 130, strength: 0.7, speed: 0.65 },
  normal: { firstWave: 180, interval: 110, strength: 1, speed: 0.85 },
  hard: { firstWave: 120, interval: 85, strength: 1.4, speed: 1.05 },
} as const;
export type ResourceNode = Point & {
  id: string;
  resource: "alloy" | "energy" | "food";
  amount: number;
};
export type State = {
  combatModes?: {
    friend: "aggressive" | "peaceful";
    workers: "aggressive" | "peaceful";
  };
  abilities?: {
    shieldUntil: number;
    shieldReady: number;
    empReady: number;
    empAt: number;
  };
  shared?: boolean;
  playerId?: string;
  spawn?: Point;
  terrain?: Module[];
  visibleUnits?: (Point & {
    id: string;
    playerId: string;
    name: string;
    hp: number;
    maxHp: number;
    hero: boolean;
    role?: string;
    color: string;
  })[];
  visibleCells?: string[];
  hold?: { ownerId: string | null; name: string; seconds: number };
  elimination?: {
    reason: "core-destroyed" | "forfeit" | "disconnect";
    by?: string;
  };
  deposits: ResourceNode[];
  difficulty: Difficulty;
  attackWaves: boolean;
  time: number;
  phase: "ready" | "playing" | "won" | "lost";
  paused: boolean;
  wave: number;
  nextWave: number;
  alloy: number;
  energy: number;
  food: number;
  integrity: number;
  crew: number;
  friend: Actor;
  workers: Worker[];
  friendWork: { alloy: number; energy: number; food: number };
  roles: Record<Role, number>;
  modules: Module[];
  enemies: Enemy[];
  monoliths: Monolith[];
  nextShape: number;
  placed: number;
  seed: number;
  nextId: number;
  log: string[];
  shots: {
    from: Point;
    to: Point;
    kind?: "friend" | "guard" | "turret";
    at?: number;
    hostile?: boolean;
  }[];
};
export type Command =
  | {
      type: "combat-mode";
      group: "friend" | "workers";
      mode: "aggressive" | "peaceful";
    }
  | { type: "ability"; ability: import("./combat.ts").Ability }
  | {
      type: "build";
      room: BuildType;
      x: number;
      y: number;
      rotation: number;
      shape: number;
    }
  | { type: "demolish"; moduleId: number }
  | { type: "capture"; index: number }
  | { type: "attack"; target: string; moduleId?: number; unitId?: number }
  | {
      type: "guards";
      stance: "follow" | "defend" | "station";
      x?: number;
      y?: number;
    }
  | { type: "assign"; role: Role; delta: number }
  | { type: "recruit"; role: Role; moduleId?: number }
  | { type: "direct"; x: number; y: number; task?: "work" | "move" | "repair" }
  | { type: "stop-friend" | "forfeit" }
  | { type: "bot-add"; difficulty: Difficulty }
  | { type: "bot-remove"; target: string }
  | { type: "gather"; nodeId: string }
  | { type: "raid" | "explore"; target: string }
  | { type: "start" | "pause" | "repair" };
export function rotated(shape: number, rotation: number): Point[] {
  let cells: Point[] = SHAPES[shape].map(([x, y]) => ({ x, y }));
  for (let i = 0; i < ((rotation % 4) + 4) % 4; i++)
    cells = cells.map(({ x, y }) => ({ x: -y, y: x }));
  const minX = Math.min(...cells.map((p) => p.x)),
    minY = Math.min(...cells.map((p) => p.y));
  return cells.map((p) => ({ x: p.x - minX, y: p.y - minY }));
}
export const key = (p: Point) => `${p.x},${p.y}`;
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function createState(
  seed = 4821,
  difficulty: Difficulty = "normal",
): State {
  const state: State = {
    combatModes: { friend: "aggressive", workers: "peaceful" },
    difficulty,
    deposits: [],
    attackWaves: true,
    time: 0,
    phase: "ready",
    paused: false,
    wave: 0,
    nextWave: DIFFICULTIES[difficulty].firstWave,
    alloy: 65,
    energy: 45,
    food: 40,
    integrity: 100,
    crew: 0,
    friend: createActor(),
    workers: [],
    friendWork: { alloy: 0, energy: 0, food: 0 },
    roles: {
      builders: 0,
      engineers: 0,
      farmers: 0,
      miners: 0,
      guards: 0,
      scientists: 0,
      medics: 0,
    },
    modules: [],
    enemies: [],
    monoliths: [
      { x: 0, y: -18, name: "The Listener", progress: 0, connected: false },
      { x: 18, y: 0, name: "The Keeper", progress: 0, connected: false },
      { x: 0, y: 18, name: "The Dreamer", progress: 0, connected: false },
      { x: -18, y: 0, name: "The Wanderer", progress: 0, connected: false },
    ],
    nextShape: 1,
    placed: 0,
    seed: seed >>> 0,
    nextId: 1,
    log: ["One core. Four signals. A sector to claim."],
    shots: [],
  };
  const add = (
    type: RoomType,
    x: number,
    y: number,
    shape: number,
    rotation = 0,
  ) =>
    state.modules.push({
      id: state.nextId++,
      type,
      cells: rotated(shape, rotation).map((p) => ({ x: p.x + x, y: p.y + y })),
      progress: 1,
      owner: "Station",
    });
  add("core", -1, -1, 1);
  return state;
}
export function capacity(s: State, role: Role) {
  if (role === "builders") return s.crew;
  const type: Record<Exclude<Role, "builders">, RoomType> = {
    engineers: "solar",
    farmers: "garden",
    miners: "foundry",
    guards: "turret",
    scientists: "lab",
    medics: "infirmary",
  };
  return (
    s.modules.filter((m) => m.type === type[role] && m.progress >= 1).length * 2
  );
}
export function placementError(
  s: State,
  type: BuildType,
  shape: number,
  rotation: number,
  x: number,
  y: number,
): string | null {
  if (
    !Number.isInteger(x) ||
    !Number.isInteger(y) ||
    !Number.isInteger(rotation) ||
    rotation < 0 ||
    rotation > 3 ||
    !Number.isInteger(shape) ||
    shape < 0 ||
    shape >= SHAPES.length
  )
    return "Invalid grid position.";
  if (!Object.hasOwn(MODULES, type) || (type as string) === "core")
    return "Choose a module.";
  if (s.placed >= 180) return "Station module limit reached.";
  const def = MODULES[type],
    cells = rotated(shape, rotation).map((p) => ({ x: p.x + x, y: p.y + y }));
  if (cells.some((p) => Math.abs(p.x) > BOUND || Math.abs(p.y) > BOUND))
    return "Beyond the sector boundary.";
  if (
    cells.some((p) =>
      s.monoliths.some(
        (m) => Math.abs(m.x - p.x) <= 1 && Math.abs(m.y - p.y) <= 1,
      ),
    )
  )
    return "Leave space around the monolith.";
  if (
    cells.some((p) =>
      s.deposits.some((n) => n.amount > 0 && n.x === p.x && n.y === p.y),
    )
  )
    return "Collect this resource deposit before building here.";
  const occupied = new Set(
    [...s.modules, ...(s.terrain ?? [])].flatMap((m) => m.cells.map(key)),
  );
  const connected = new Set(
    s.modules.filter((m) => !m.dismantling).flatMap((m) => m.cells.map(key)),
  );
  if (s.shared) {
    const floor = new Set(
      [
        ...s.modules.filter((m) => !m.dismantling),
        ...(s.terrain ?? []).filter((m) => m.progress >= 1 && !m.dismantling),
      ].flatMap((m) => m.cells.map(key)),
    );
    const queue = [...s.modules.find((m) => m.type === "core")!.cells];
    connected.clear();
    queue.forEach((p) => connected.add(key(p)));
    for (let i = 0; i < queue.length; i++)
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const n = { x: queue[i].x + dx, y: queue[i].y + dy };
        if (floor.has(key(n)) && !connected.has(key(n))) {
          connected.add(key(n));
          queue.push(n);
        }
      }
  }
  if (cells.some((p) => occupied.has(key(p))))
    return "That space is already occupied.";
  if (
    !cells.some((p) =>
      [
        { x: p.x + 1, y: p.y },
        { x: p.x - 1, y: p.y },
        { x: p.x, y: p.y + 1 },
        { x: p.x, y: p.y - 1 },
      ].some((n) => connected.has(key(n))),
    )
  )
    return "Connect an edge to your station or a queued blueprint.";
  if (s.alloy < def.alloy || s.energy < def.energy) return "Not enough alloy.";

  return null;
}
function log(s: State, text: string) {
  s.log = [text, ...s.log].slice(0, 5);
}
export function applyCommand(
  s: State,
  c: Command,
  owner = "Commander",
  otherActors: Actor[] = [],
): string | null {
  if (c.type === "start") {
    if (s.phase !== "ready") return "Mission already launched.";
    s.phase = "playing";
    log(s, "Mission underway. Build your station. Watch your rivals.");
    return null;
  }
  if (s.phase !== "playing") return "Launch a mission first.";
  if (c.type === "pause") {
    s.paused = !s.paused;
    return null;
  }
  if (s.paused) return "The mission is paused.";
  if (c.type === "gather") {
    const node = s.deposits.find((n) => n.id === c.nodeId && n.amount > 0);
    if (!node) return "This resource deposit is empty.";
    const path = routeBeside(s, s.friend, node);
    if (!path) return "Build completed passages beside this deposit first.";
    resetOrder(s.friend, null, "gather", node);
    s.friend.nodeId = node.id;
    s.friend.path = path;
    return null;
  }
  if (c.type === "demolish") {
    const module = s.modules.find((m) => m.id === c.moduleId);
    if (!module || module.type === "core" || module.wreck)
      return "Choose your own building or blueprint.";
    if (module.progress >= 1) {
      const onFloor = (a: Actor) =>
        a.hp > 0 &&
        module.cells.some(
          (p) => Math.abs(p.x - a.x) < 1 && Math.abs(p.y - a.y) < 1,
        );
      if (otherActors.some(onFloor))
        return "An enemy is on this building. Clear them before dismantling.";
      const remaining = s.modules.filter((m) => m !== module && !m.dismantling);
      const floor = new Set(
        [...remaining, ...(s.terrain ?? [])]
          .filter((m) => m.progress >= 1)
          .flatMap((m) => m.cells.map(key)),
      );
      const queue = [
        ...(remaining.find((m) => m.type === "core")?.cells ?? []),
      ];
      const connected = new Set(queue.map(key));
      for (let i = 0; i < queue.length; i++) {
        const p = queue[i];
        for (const n of [
          { x: p.x + 1, y: p.y },
          { x: p.x - 1, y: p.y },
          { x: p.x, y: p.y + 1 },
          { x: p.x, y: p.y - 1 },
        ])
          if (floor.has(key(n)) && !connected.has(key(n))) {
            connected.add(key(n));
            queue.push(n);
          }
      }
      if (
        remaining.some(
          (m) => m.progress >= 1 && m.cells.some((p) => !connected.has(key(p))),
        )
      )
        return "This would disconnect your station. Build another path first.";
      const occupants = [s.friend, ...s.workers].filter(onFloor);
      if (occupants.length) {
        module.dismantling = true;
        const core = s.modules.find((m) => m.type === "core")!;
        for (const a of [s.friend, ...s.workers]) {
          if (
            !a.evacuating &&
            (onFloor(a) ||
              a.targetId === module.id ||
              a.resumeJob?.targetId === module.id)
          ) {
            resetOrder(a, core.id, "move", core.cells[0]);
            a.evacuating = true;
            if ("role" in a) {
              (a as Worker).role = "builders";
              a.stance = undefined;
            }
          }
        }
        assignedRoles(s);
        return null;
      }
    }
    const refund = (m: Module) => {
      s.alloy += MODULES[m.type].alloy * (m.progress < 1 ? 1 : 0.75);
      s.energy += MODULES[m.type].energy * (m.progress < 1 ? 1 : 0.75);
      for (const a of [s.friend, ...s.workers])
        if (a.targetId === m.id || a.resumeJob?.targetId === m.id)
          resetOrder(a, null, "idle");
      for (const w of s.workers) if (w.targetId === null) w.role = "builders";
    };
    refund(module);
    {
      s.modules = s.modules.filter((m) => m !== module);
      for (const a of [s.friend, ...s.workers]) {
        a.path = [];
        a.routeKey = "";
      }
      // Refund dependent blueprints that no longer connect to any completed flooring.
      const reachable = new Set(
        [...s.modules, ...(s.terrain ?? [])]
          .filter((m) => m.progress >= 1)
          .flatMap((m) => m.cells.map(key)),
      );
      let changed = true;
      while (changed) {
        changed = false;
        for (const m of s.modules.filter((m) => m.progress < 1)) {
          if (m.cells.some((p) => reachable.has(key(p)))) continue;
          if (
            m.cells.some((p) =>
              [
                [1, 0],
                [-1, 0],
                [0, 1],
                [0, -1],
              ].some(([x, y]) =>
                reachable.has(key({ x: p.x + x, y: p.y + y })),
              ),
            )
          ) {
            m.cells.forEach((p) => reachable.add(key(p)));
            changed = true;
          }
        }
      }
      s.modules = s.modules.filter((m) => {
        if (m.progress >= 1 || m.cells.some((p) => reachable.has(key(p))))
          return true;
        refund(m);
        return false;
      });
    }
    assignedRoles(s);
    log(
      s,
      "Refund returned · blueprints 100%, completed buildings 75%. Dismantled tiles removed.",
    );
    return null;
  }
  if (c.type === "build") {
    const error = placementError(s, c.room, c.shape, c.rotation, c.x, c.y);
    if (error) return error;
    const def = MODULES[c.room];
    s.alloy -= def.alloy;
    s.energy -= def.energy;

    s.modules.push({
      id: s.nextId++,
      type: c.room,
      cells: rotated(c.shape, c.rotation).map((p) => ({
        x: p.x + c.x,
        y: p.y + c.y,
      })),
      progress: 0,
      owner,
      hp: 100,
    });
    if (
      !s.roles.builders &&
      !(
        s.friend.order === "work" &&
        s.modules.some((m) => m.id === s.friend.targetId && m.progress < 1)
      )
    )
      resetOrder(s.friend, s.modules.at(-1)!.id);
    s.placed++;
    s.nextShape = c.shape;
    log(s, `Commissioned a ${def.name.toLowerCase()}.`);
    return null;
  }
  if (c.type === "direct") {
    if (
      !Number.isInteger(c.x) ||
      !Number.isInteger(c.y) ||
      ![undefined, "work", "move", "repair"].includes(c.task)
    )
      return "Choose a station tile.";
    const module = [...s.modules, ...(s.terrain ?? [])].find((m) =>
      m.cells.some((p) => p.x === c.x && p.y === c.y),
    );
    if (!module)
      return "Your Friend walks on the station. Build a passage to reach that spot.";
    if (
      (c.task === "move" || !s.modules.includes(module)) &&
      module.progress < 1
    )
      return "Finish construction before walking on this tile.";
    if (module.progress >= 1 && !routeTo(s, s.friend, [{ x: c.x, y: c.y }]))
      return "No completed path to this tile.";
    if (c.task === "repair" && module.type !== "core")
      return "Repair the hull from the command core.";
    resetOrder(
      s.friend,
      module.id,
      s.modules.includes(module) ? (c.task ?? "work") : "move",
      module.progress >= 1 ? { x: c.x, y: c.y } : null,
    );
    return null;
  }
  if (c.type === "stop-friend") {
    resetOrder(s.friend, null, "idle");
    s.friend.task = "idle";
    return null;
  }
  if (c.type === "recruit") {
    if (
      !ROLES.includes(c.role) ||
      (c.moduleId !== undefined && !Number.isSafeInteger(c.moduleId))
    )
      return "Choose a worker job.";
    if (s.crew >= housing(s))
      return "No worker beds available. Build Quarters for four more.";
    const destination = workplace(s, c.role, c.moduleId);
    if (!destination)
      return "Build a completed workplace with a free slot for this worker.";
    if (s.alloy < 6 || s.food < 8)
      return "Recruiting a worker needs 6 alloy and 8 food.";
    s.alloy -= 6;
    s.food -= 8;
    const worker: Worker = {
      ...createActor(),
      ...(s.spawn ?? {}),
      hp: 60,
      maxHp: 60,
      id: s.nextId++,
      role: c.role,
    };
    resetOrder(
      worker,
      c.role === "builders" ? null : destination.id,
      "work",
      c.role === "builders"
        ? null
        : destination.cells[worker.id % destination.cells.length],
    );
    s.workers.push(worker);
    assignedRoles(s);
    log(
      s,
      `A ${c.role === "builders" ? "builder" : c.role.slice(0, -1)} arrived at the core.`,
    );
    return null;
  }
  if (c.type === "assign") {
    if (
      !ROLES.includes(c.role) ||
      ![1, -1].includes(c.delta) ||
      c.role === "builders"
    )
      return "Choose a specialist assignment.";
    const worker = s.workers.find(
      (w) => w.role === (c.delta > 0 ? "builders" : c.role),
    );
    if (!worker)
      return c.delta > 0
        ? "No free builders. Recruit a worker for this job."
        : "No worker assigned here.";
    const destination = c.delta > 0 ? workplace(s, c.role) : undefined;
    if (c.delta > 0 && !destination)
      return "No completed workplace with a free slot.";
    worker.role = c.delta > 0 ? c.role : "builders";
    resetOrder(
      worker,
      destination?.id ?? null,
      "work",
      destination
        ? destination.cells[worker.id % destination.cells.length]
        : null,
    );
    assignedRoles(s);
    return null;
  }
  if (c.type === "repair") {
    if (s.integrity >= 100) return "Hull is already intact.";
    if (s.alloy < 12) return "Repairs need 12 alloy.";
    s.alloy -= 12;
    s.integrity = Math.min(100, s.integrity + 20);
    return null;
  }
  return "Unknown command.";
}
export function rates(s: State) {
  const efficiency = s.food > 0 ? 1 : 0.35;
  return {
    alloy:
      (0.12 + workPower(s, "miners") * 0.55 + workPower(s, "salvage") * 0.35) *
      efficiency,
    energy: 0.25 + workPower(s, "engineers") * 0.7,
    food: workPower(s, "farmers") * 0.8 - (s.crew + 1) * 0.045,
  };
}
export function tick(s: State, dt: number, otherActors: Actor[] = []) {
  if (s.phase !== "playing" || s.paused || !Number.isFinite(dt) || dt <= 0)
    return;
  dt = Math.min(dt, 0.5);
  s.time += dt;
  s.shots = [];
  updateActors(s, dt);
  for (const m of s.modules.filter((m) => m.dismantling))
    applyCommand(s, { type: "demolish", moduleId: m.id }, m.owner, otherActors);
  if (s.friend.working && s.friend.order === "gather") {
    const node = s.deposits.find((n) => n.id === s.friend.nodeId);
    if (node) {
      const amount = Math.min(node.amount, dt * 2.5, 300 - s[node.resource]);
      s[node.resource] += amount;
      node.amount -= amount;
      s.friendWork[node.resource] += dt;
      if (node.amount <= 0) {
        resetOrder(
          s.friend,
          s.modules.find((m) => m.type === "core")!.id,
          "salvage",
        );
        log(s, "Deposit collected. Returning to your station.");
      }
    }
  }
  if (s.friend.working) {
    if (s.friend.task === "miners" || s.friend.task === "salvage")
      s.friendWork.alloy += dt;
    if (s.friend.task === "engineers") s.friendWork.energy += dt;
    if (s.friend.task === "farmers") s.friendWork.food += dt;
    if (s.friend.task === "repair" && s.integrity >= 100) {
      resetOrder(
        s.friend,
        s.modules.find((m) => m.type === "core")!.id,
        "salvage",
      );
      log(s, "Hull restored. Your Friend is returning to salvage.");
    }
  }
  const repairPower = workPower(s, "repair");
  if (repairPower && s.integrity < 100 && s.alloy >= dt * 0.5 * repairPower) {
    s.integrity = Math.min(100, s.integrity + dt * 1.5 * repairPower);
    s.alloy -= dt * 0.5 * repairPower;
  }
  const r = rates(s);
  s.alloy = Math.min(Math.max(300, s.alloy), s.alloy + r.alloy * dt);
  s.energy = Math.min(Math.max(300, s.energy), s.energy + r.energy * dt);
  s.food = Math.max(0, Math.min(300, s.food + r.food * dt));
  const pending = s.modules.filter((m) => m.progress < 1);
  for (const m of pending) {
    m.progress = Math.min(
      1,
      m.progress +
        dt * workPower(s, "build", m.id) * 0.16 * (s.food > 0 ? 1 : 0.35),
    );
    if (m.progress >= 1) {
      log(s, `${MODULES[m.type].name} online.`);
    }
  }
  if (s.attackWaves && s.time >= s.nextWave) {
    s.wave++;
    const difficulty = DIFFICULTIES[s.difficulty];
    s.nextWave = s.time + Math.max(45, difficulty.interval - s.wave * 5);
    const count = Math.max(
      2,
      Math.round((1 + s.wave * 2) * difficulty.strength),
    );
    for (let i = 0; i < count; i++) {
      const angle = s.wave * 0.87 + (i / count) * Math.PI * 2;
      const hp = (12 + s.wave * 5) * difficulty.strength;
      s.enemies.push({
        id: s.nextId++,
        x: Math.cos(angle) * 25,
        y: Math.sin(angle) * 25,
        hp,
        maxHp: hp,
      });
    }
    log(s, `Wave ${s.wave}. Incoming from the outer dark.`);
  }
  const turrets = s.modules.filter(
    (m) => m.type === "turret" && m.progress >= 1,
  );
  for (let i = 0; i < turrets.length; i++) {
    const guard = workPower(s, "guards", turrets[i].id);
    if (!guard || s.energy < dt * 0.5) continue;
    const from = turrets[i].cells[0];
    const target = s.enemies
      .filter((e) => e.hp > 0 && dist(e, from) < 8)
      .sort((a, b) => dist(a, from) - dist(b, from))[0];
    if (target) {
      target.hp -= guard * 9 * dt;
      s.energy -= dt * 0.5;
      s.shots.push({ from, to: { x: target.x, y: target.y } });
    }
  }
  // The core's modest point defense gives new crews time to learn; it cannot hold later waves alone.
  const near = s.enemies.find((e) => e.hp > 0 && dist(e, { x: 0, y: 0 }) < 4);
  if (near) {
    near.hp -= 6 * dt;
    s.shots.push({ from: { x: 0, y: 0 }, to: { x: near.x, y: near.y } });
  }
  const friendTarget = s.enemies.find((e) => e.hp > 0 && dist(e, s.friend) < 4);
  if (friendTarget) {
    friendTarget.hp -= 8 * dt;
    s.shots.push({
      from: { x: s.friend.x, y: s.friend.y },
      to: { x: friendTarget.x, y: friendTarget.y },
    });
  }
  for (const e of s.enemies) {
    if (e.hp <= 0) continue;
    const d = Math.hypot(e.x, e.y);
    if (d > 1.3) {
      e.x -= (e.x / d) * dt * DIFFICULTIES[s.difficulty].speed;
      e.y -= (e.y / d) * dt * DIFFICULTIES[s.difficulty].speed;
    } else {
      s.integrity -= dt * 3.5;
      if (s.integrity <= 0 && !s.elimination)
        s.elimination = { reason: "core-destroyed", by: e.sourceName };
    }
  }
  s.enemies = s.enemies.filter((e) => e.hp > 0);
  if (!s.shared)
    for (const m of s.monoliths) {
      m.connected = s.modules.some(
        (mod) => mod.progress >= 1 && mod.cells.some((p) => dist(p, m) <= 3),
      );
      if (
        m.connected &&
        m.progress < 100 &&
        workPower(s, "scientists") > 0 &&
        s.energy > dt * 0.25
      ) {
        m.progress = Math.min(
          100,
          m.progress + workPower(s, "scientists") * 1.5 * dt,
        );
        s.energy -= dt * 0.25;
        if (m.progress === 100) log(s, `${m.name} awakened. A signal answers.`);
      }
    }
  if (s.integrity <= 0) {
    s.integrity = 0;
    s.phase = "lost";
    log(s, "The station fell silent. Your next expedition awaits.");
  } else if (!s.shared && s.monoliths.every((m) => m.progress >= 100)) {
    s.phase = "won";
    log(s, "Four signals, one constellation. You found your way home.");
  }
}

/** The opening teaches direct Friend control, then deliberate worker recruitment. */
export function nextObjective(s: State): {
  title: string;
  detail: string;
  module?: BuildType;
  role?: Role;
  inspectId?: number;
} {
  const foundry = s.modules.find((m) => m.type === "foundry");
  if (!foundry)
    return {
      title: "1 / 7 · Give your Friend a first job",
      detail:
        "Choose a block shape, then Foundry, then click or tap beside the core to place its four tiles. Your Friend will walk over and construct it.",
      module: "foundry",
    };
  if (foundry.progress < 1)
    return {
      title: "1 / 7 · Your Friend is building",
      detail: `Foundry ${Math.floor(foundry.progress * 100)}% complete. Watch your Friend walk to the blueprint and use their tools.`,
      inspectId: foundry.id,
    };
  if (!s.roles.miners)
    return {
      title: "2 / 7 · Let a miner take over",
      detail:
        "Your Friend can make alloy here. Recruit a miner for 6 alloy + 8 food to keep it running while you explore.",
      inspectId: foundry.id,
      role: "miners",
    };
  const steps: {
    type: BuildType;
    role?: Role;
    title: string;
    detail: string;
  }[] = [
    {
      type: "solar",
      role: "engineers",
      title: "3 / 7 · Power your tools",
      detail:
        "Build a Reactor. Your Friend generates energy here; recruit an engineer to automate it.",
    },
    {
      type: "habitat",
      title: "4 / 7 · Make room for helpers",
      detail:
        "Build Quarters for four extra worker beds. Workers arrive only when you recruit them.",
    },
    {
      type: "garden",
      role: "farmers",
      title: "5 / 7 · Grow food",
      detail:
        "Build a Garden. Work here with your Friend, then recruit a farmer to feed and grow your crew.",
    },
    {
      type: "turret",
      role: "guards",
      title: "6 / 7 · Defend your home",
      detail:
        "Build Defense. Assign guards to operate it, follow your Friend, or defend a contested approach.",
    },
    {
      type: "lab",
      title: "7 / 7 · Investigate the signals",
      detail:
        "Extend completed passages to the central monoliths. Click a monolith to send your Friend to capture it.",
    },
  ];
  for (const step of steps) {
    const module = s.modules.find(
      (m) => m.type === step.type && m.progress >= 1,
    );
    if (!module) {
      const pending = s.modules.find((m) => m.type === step.type);
      if (pending)
        return {
          title: step.title,
          detail: `${MODULES[step.type].name} ${Math.floor(pending.progress * 100)}% complete. Your Friend or a builder must work on the blueprint.`,
          inspectId: pending.id,
        };
      return { title: step.title, detail: step.detail, module: step.type };
    }
    if (step.role && !s.roles[step.role])
      return {
        title: step.title,
        detail: step.detail,
        inspectId: module.id,
        role: step.role,
      };
  }
  return {
    title: "Your Friend leads the expedition",
    detail:
      "Tap a station building to walk there and work. Recruit specialists to automate it. Destroy rival cores or hold all four shared monoliths for 60 seconds.",
  };
}
