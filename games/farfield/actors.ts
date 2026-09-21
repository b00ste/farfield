import { workerEfficiency, powerEfficiency } from "./economy.ts";
import type { Module, Point, Role, State, RoomType } from "./engine.ts";
export type Facing = "up" | "down" | "left" | "right";
export type Task =
  | "idle"
  | "combat"
  | "gather-alloy"
  | "gather-energy"
  | "gather-food"
  | "move"
  | "build"
  | "salvage"
  | "repair"
  | "rest"
  | Exclude<Role, "builders">;
export type Actor = Point & {
  evacuating?: boolean;
  fighting?: boolean;
  // Temporary automatic combat preserves the assigned job and guard order.
  resumeJob?: {
    targetId: number | null;
    order: Actor["order"];
    destination: Point | null;
    nodeId: string | null;
  };
  nextCombatScan?: number;
  hp: number;
  maxHp: number;
  lastHit: number;
  respawnAt: number;
  attack?: { playerId: string; moduleId?: number; unitId?: number };
  stance?: "follow" | "defend";
  defendAt?: Point;
  nodeId: string | null;
  path: Point[];
  facing: Facing;
  sideFacing: "left" | "right";
  targetId: number | null;
  order: "work" | "move" | "repair" | "salvage" | "idle" | "gather";
  destination: Point | null;
  routeKey: string;
  task: Task;
  working: boolean;
};
export type Worker = Actor & { id: number; role: Role };
export const JOBS: Partial<Record<RoomType, Exclude<Role, "builders">>> = {
  foundry: "miners",
  solar: "engineers",
  garden: "farmers",
  turret: "guards",
  lab: "scientists",
  infirmary: "medics",
};
export const TASK_LABELS: Record<Task, string> = {
  "gather-alloy": "Collecting alloy",
  "gather-energy": "Collecting energy",
  "gather-food": "Collecting food",
  combat: "Fighting",
  medics: "Healing allies",
  rest: "Resting at infirmary",
  idle: "Ready for your command",
  move: "Walking to work",
  build: "Constructing",
  salvage: "Salvaging alloy",
  repair: "Repairing the core",
  miners: "Refining alloy",
  engineers: "Generating energy",
  farmers: "Growing food",
  guards: "Operating defenses",
  scientists: "Researching signals",
};
export const ROLE_NAMES: Record<Role, string> = {
  builders: "Builder",
  miners: "Miner",
  engineers: "Engineer",
  farmers: "Farmer",
  guards: "Guard",
  scientists: "Scientist",
  medics: "Medic",
};
export function createActor(): Actor {
  return {
    hp: 120,
    maxHp: 120,
    lastHit: -10,
    respawnAt: 0,
    nodeId: null,
    x: -1,
    y: -1,
    path: [],
    facing: "down",
    sideFacing: "right",
    targetId: 1,
    order: "salvage",
    destination: null,
    routeKey: "",
    task: "idle",
    working: false,
  };
}
export function housing(s: State) {
  return (
    2 +
    s.modules.filter((m) => m.type === "habitat" && m.progress >= 1 && !m.wreck)
      .length *
      4
  );
}
const key = (p: Point) => `${p.x},${p.y}`;
const neighbors = (p: Point) => [
  { x: p.x + 1, y: p.y },
  { x: p.x - 1, y: p.y },
  { x: p.x, y: p.y + 1 },
  { x: p.x, y: p.y - 1 },
];
/** Reused for an actor update; topology changes are picked up on the next update. */
function navigation(s: State) {
  const modules = [...s.modules, ...(s.terrain ?? [])];
  const byId = new Map(modules.map((m) => [m.id, m]));
  const floor = new Map(
    modules
      .filter((m) => m.progress >= 1)
      .flatMap((m) => m.cells.map((p) => [key(p), m] as const)),
  );
  const component = new Map<string, number>();
  let id = 0;
  for (const cell of floor.keys()) {
    if (component.has(cell)) continue;
    const [x, y] = cell.split(",").map(Number),
      queue = [{ x, y }];
    component.set(cell, ++id);
    for (let i = 0; i < queue.length; i++)
      for (const p of neighbors(queue[i])) {
        const k = key(p);
        if (floor.has(k) && !component.has(k)) {
          component.set(k, id);
          queue.push(p);
        }
      }
  }
  return { byId, floor, component };
}
type Navigation = ReturnType<typeof navigation>;
/** BFS stays on completed station tiles; unfinished modules are worked from an adjacent tile. */
export function routeTo(
  s: State,
  from: Point,
  goals: Point[],
  nav?: Navigation,
): Point[] | null {
  const walkable = nav?.floor ?? navigation(s).floor;
  const targets = new Set(goals.filter((p) => walkable.has(key(p))).map(key));
  const start = { x: Math.round(from.x), y: Math.round(from.y) };
  if (!targets.size || !walkable.has(key(start))) return null;
  const queue = [start],
    previous = new Map<string, Point | null>([[key(start), null]]);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    if (targets.has(key(p))) {
      const route: Point[] = [];
      let node: Point | null = p;
      while (node) {
        route.push(node);
        node = previous.get(key(node)) ?? null;
      }
      route.reverse();
      if (Math.hypot(route[0].x - from.x, route[0].y - from.y) < 0.001)
        route.shift();
      return route;
    }
    for (const n of neighbors(p))
      if (walkable.has(key(n)) && !previous.has(key(n))) {
        previous.set(key(n), p);
        queue.push(n);
      }
  }
  return null;
}
export function routeBeside(
  s: State,
  actor: Point,
  target: Point,
  includeTarget = false,
): Point[] | null {
  return routeTo(
    s,
    actor,
    includeTarget ? [target, ...neighbors(target)] : neighbors(target),
  );
}
export function nextConstruction(s: State, actor: Actor, nav = navigation(s)) {
  const component = nav.component.get(
    key({ x: Math.round(actor.x), y: Math.round(actor.y) }),
  );
  if (component === undefined) return undefined;
  return s.modules.find(
    (m) =>
      m.progress < 1 &&
      m.cells.some((p) =>
        neighbors(p).some((n) => nav.component.get(key(n)) === component),
      ),
  );
}
export function resetOrder(
  actor: Actor,
  targetId: number | null,
  order: Actor["order"] = "work",
  destination: Point | null = null,
) {
  actor.evacuating = false;
  actor.resumeJob = undefined;
  actor.attack = undefined;
  actor.nodeId = null;
  actor.targetId = targetId;
  actor.order = order;
  actor.destination = destination;
  actor.routeKey = "";
  actor.path = [];
  actor.working = false;
}
export function workplace(
  s: State,
  role: Role,
  preferred?: number,
): Module | undefined {
  if (role === "builders") return s.modules.find((m) => m.type === "core");
  return s.modules.find(
    (m) =>
      (preferred === undefined || m.id === preferred) &&
      JOBS[m.type] === role &&
      !m.dismantling &&
      m.progress >= 1 &&
      s.workers.filter(
        (w) =>
          w.role === role && (w.resumeJob?.targetId ?? w.targetId) === m.id,
      ).length +
        (s.recruitQueue ?? []).filter(
          (order) => order.role === role && order.moduleId === m.id,
        ).length <
        2,
  );
}
export function assignedRoles(s: State) {
  for (const role of Object.keys(s.roles) as Role[])
    s.roles[role] = s.workers.filter((w) => w.role === role).length;
  s.crew = s.workers.length;
}
export function workPower(s: State, task: Task, moduleId?: number) {
  const atWork = (a: Actor) =>
    a.hp > 0 &&
    a.working &&
    !a.fighting &&
    a.task === task &&
    (moduleId === undefined || a.targetId === moduleId);
  const efficiency =
    task === "miners" || task === "build" ? workerEfficiency(s) : 1;
  const powered =
    task === "miners" ||
    task === "farmers" ||
    task === "scientists" ||
    task === "medics" ||
    task === "guards"
      ? powerEfficiency(s)
      : 1;
  return (
    (s.workers.filter(atWork).length * efficiency +
      (atWork(s.friend) ? 2 : 0)) *
    powered
  );
}
export function defenseEfficiency(s: State, moduleId: number) {
  const friend = s.friend;
  return (
    powerEfficiency(s) *
    (friend.hp > 0 &&
    friend.working &&
    !friend.fighting &&
    friend.task === "guards" &&
    friend.targetId === moduleId
      ? 1
      : workerEfficiency(s))
  );
}
function step(
  s: State,
  actor: Actor,
  dt: number,
  speed: number,
  nav: Navigation,
) {
  actor.working = false;
  const node =
    actor.order === "gather"
      ? s.deposits.find((n) => n.id === actor.nodeId && n.amount > 0)
      : undefined;
  if (actor.hp <= 0) {
    actor.path = [];
    actor.task = "idle";
    return;
  }
  // A demolished tile invalidates cached movement, including paths across rival stations.
  if (actor.path.some((p) => !nav.floor.has(key(p)))) {
    actor.path = [];
    actor.routeKey = "";
  }
  const module = nav.byId.get(actor.targetId!);
  if ((!module && !node) || actor.order === "idle") {
    actor.path = [];
    actor.task = "idle";
    return;
  }
  const pending = !!module && module.progress < 1;
  if (module) {
    const signature = `${module.id}:${pending}:${actor.order}:${actor.destination ? key(actor.destination) : ""}`;
    if (signature !== actor.routeKey) {
      const goals = pending
        ? module.cells.flatMap(neighbors)
        : actor.destination
          ? [actor.destination]
          : module.cells;
      const path = routeTo(s, actor, goals, nav);
      if (path === null) {
        actor.task = "idle";
        actor.path = [];
        return;
      }
      actor.path = path;
      actor.routeKey = signature;
    }
  }
  if (node && actor.routeKey !== `deposit:${node.id}`) {
    const route = routeBeside(s, actor, node);
    if (!route) {
      actor.path = [];
      actor.task = "idle";
      return;
    }
    actor.path = route;
    actor.routeKey = `deposit:${node.id}`;
  }
  let remaining = dt * speed;
  while (actor.path.length && remaining > 0) {
    const next = actor.path[0],
      dx = next.x - actor.x,
      dy = next.y - actor.y,
      distance = Math.hypot(dx, dy);
    if (distance < 0.001) {
      actor.path.shift();
      continue;
    }
    actor.facing =
      Math.abs(dx) > Math.abs(dy)
        ? dx > 0
          ? "right"
          : "left"
        : dy > 0
          ? "down"
          : "up";
    if (actor.facing === "left" || actor.facing === "right")
      actor.sideFacing = actor.facing;
    const travel = Math.min(remaining, distance);
    actor.x += (dx / distance) * travel;
    actor.y += (dy / distance) * travel;
    remaining -= travel;
    if (travel >= distance) actor.path.shift();
  }
  if (actor.path.length) {
    actor.task = "move";
    return;
  }
  if (node) {
    actor.task = `gather-${node.resource}`;
    actor.working = true;
    return;
  }
  if (!module) return;
  if (actor.order === "move") {
    actor.task = "idle";
    return;
  }
  actor.task = pending
    ? "build"
    : actor.order === "repair"
      ? "repair"
      : module.type === "core"
        ? "salvage"
        : actor === s.friend && module.type === "infirmary"
          ? "rest"
          : (JOBS[module.type] ?? "idle");
  actor.working = actor.task !== "idle";
}
export function updateActors(s: State, dt: number) {
  const nav = navigation(s);
  for (const worker of s.workers) {
    if (!worker.evacuating && !worker.resumeJob && worker.role === "builders") {
      const pending = nextConstruction(s, worker, nav);
      const core =
        !pending && s.integrity < 100
          ? s.modules.find((m) => m.type === "core")
          : undefined;
      if (worker.targetId !== (pending?.id ?? core?.id ?? null))
        resetOrder(
          worker,
          pending?.id ?? core?.id ?? null,
          core ? "repair" : "work",
        );
    }
    if (
      !worker.evacuating &&
      !worker.resumeJob &&
      worker.role === "guards" &&
      worker.stance
    ) {
      const target = worker.stance === "follow" ? s.friend : worker.defendAt!;
      const floor = [...s.modules, ...(s.terrain ?? [])].find(
        (m) =>
          m.progress >= 1 &&
          m.cells.some(
            (p) => p.x === Math.round(target.x) && p.y === Math.round(target.y),
          ),
      );
      if (floor) {
        const destination = {
          x: Math.round(target.x),
          y: Math.round(target.y),
        };
        if (!worker.destination || key(worker.destination) !== key(destination))
          resetOrder(worker, floor.id, "move", destination);
      }
    }
    step(s, worker, dt, 2, nav);
    if (
      worker.evacuating &&
      !worker.path.length &&
      worker.destination &&
      Math.hypot(
        worker.x - worker.destination.x,
        worker.y - worker.destination.y,
      ) < 0.01
    ) {
      resetOrder(worker, null, "idle");
    }
  }
  const target = s.modules.find((m) => m.id === s.friend.targetId);
  if (
    !s.friend.resumeJob &&
    s.friend.order === "work" &&
    target &&
    ((target.progress >= 1 && s.friend.task === "build") ||
      (target.progress < 1 &&
        nextConstruction({ ...s, modules: [target] }, s.friend, nav) ===
          undefined))
  ) {
    const next = nextConstruction(s, s.friend, nav);
    if (next) resetOrder(s.friend, next.id);
  }
  step(s, s.friend, dt, 3.5, nav);
  if (
    s.friend.evacuating &&
    !s.friend.path.length &&
    s.friend.destination &&
    Math.hypot(
      s.friend.x - s.friend.destination.x,
      s.friend.y - s.friend.destination.y,
    ) < 0.01
  )
    resetOrder(s.friend, null, "idle");
}
/** Rendering only: fill the short gap between authoritative movement snapshots. */
export function visualPosition(
  actor: Actor,
  elapsed: number,
  speed: number,
): Point {
  let x = actor.x,
    y = actor.y,
    remaining = Math.max(0, Math.min(elapsed, 0.3)) * speed;
  for (const next of actor.path) {
    const distance = Math.hypot(next.x - x, next.y - y);
    if (!distance) continue;
    const travel = Math.min(remaining, distance);
    x += ((next.x - x) / distance) * travel;
    y += ((next.y - y) / distance) * travel;
    remaining -= travel;
    if (remaining <= 0) break;
  }
  return { x, y };
}
