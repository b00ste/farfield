import { ABILITIES, COMBAT } from "../games/farfield/combat.ts";
import {
  applyCommand,
  key,
  type State,
  type Point,
  type Module,
  type Monolith,
  type Command,
} from "../games/farfield/engine.ts";
import {
  assignedRoles,
  ROLE_NAMES,
  resetOrder,
  routeTo,
  workPower,
  workplace,
  type Actor,
} from "../games/farfield/actors.ts";
import type { Room, Player } from "./rooms.ts";
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export const CAPTURE_SECONDS = 10,
  HOLD_SECONDS = 60;
export const CORNER_SPAWNS: Point[] = [
  { x: -32, y: -32 },
  { x: 32, y: -32 },
  { x: 32, y: 32 },
  { x: -32, y: 32 },
];
/** Independent seeded streams keep objective placement stable as the lobby changes. */
function random(seed: number) {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = Math.imul(value ^ (value >>> 15), value | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function objectives(seed = 0): Monolith[] {
  const rand = random(seed ^ 0x4d4f4e4f);
  const x = 7 + Math.floor(rand() * 16),
    y = 7 + Math.floor(rand() * 16);
  const locations = [
    { x, y },
    { x: -y, y: x },
    { x: -x, y: -y },
    { x: y, y: -x },
  ];
  // Random shape and orientation, with one objective per quadrant.
  for (let i = locations.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [locations[i], locations[j]] = [locations[j], locations[i]];
  }
  return locations.map((p, i) => ({
    ...p,
    name: ["The Listener", "The Keeper", "The Dreamer", "The Wanderer"][i],
    progress: 0,
    connected: false,
    ownerId: null,
    claimant: null,
    contested: false,
  }));
}
export function plaza(monoliths: Monolith[]): Module[] {
  return monoliths.map((m, i) => {
    const cells: Point[] = [];
    for (let dx = -2; dx <= 2; dx++)
      for (let dy = -2; dy <= 2; dy++)
        if (Math.max(Math.abs(dx), Math.abs(dy)) === 2)
          cells.push({ x: m.x + dx, y: m.y + dy });
    return {
      id: -1 - i,
      type: "passage",
      cells,
      progress: 1,
      owner: "neutral",
      wreck: true,
    };
  });
}
export function positionPlayers(room: Room) {
  if (
    room.players.some((p) => p.state.phase !== "ready") ||
    room.players.some((p) => p.state.time > 0)
  )
    return;
  const n = room.players.length,
    rand = random(room.seed ^ 0x53504157);
  const rotation = Math.floor(rand() * 4),
    corners = CORNER_SPAWNS.map((_, i) => CORNER_SPAWNS[(i + rotation) % 4]);
  const seats = n === 2 ? [corners[0], corners[2]] : corners.slice(0, n);
  for (let i = seats.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [seats[i], seats[j]] = [seats[j], seats[i]];
  }
  // Keep the same objectives through lobby edits.
  if (!room.monoliths) {
    room.monoliths = objectives(room.seed);
    room.floor = plaza(room.monoliths);
  }
  room.hold ??= { ownerId: null, name: "", seconds: 0 };
  room.players.forEach((p, i) => {
    const spawn = seats[i],
      s = p.state;
    s.shared = true;
    s.playerId = p.id;
    s.spawn = { ...spawn };
    s.deposits = [];
    const core = s.modules[0];
    core.id = (i + 1) * 100000;
    core.owner = p.id;
    core.hp = 100;
    core.cells = [
      { x: spawn.x, y: spawn.y },
      { x: spawn.x + (Math.sign(spawn.x) || 1), y: spawn.y },
      { x: spawn.x, y: spawn.y + (Math.sign(spawn.y) || 1) },
      {
        x: spawn.x + (Math.sign(spawn.x) || 1),
        y: spawn.y + (Math.sign(spawn.y) || 1),
      },
    ];
    s.nextId = core.id + 1;
    Object.assign(s.friend, spawn);
    resetOrder(s.friend, core.id, "salvage");
    s.monoliths = room.monoliths!;
    p.seen = {};
    p.discovered = [];
  });
  syncTerrain(room);
}
export function syncTerrain(room: Room) {
  for (const p of room.players) {
    p.state.terrain = [
      ...(room.floor ?? []),
      ...room.players.filter((o) => o !== p).flatMap((o) => o.state.modules),
    ];
    p.state.monoliths = room.monoliths ?? p.state.monoliths;
    p.state.hold = room.hold;
  }
}
export function vision(player: Player): Set<string> {
  const s = player.state,
    cells = new Set<string>();
  const sources = [
    ...s.modules
      .filter((m) => m.type === "core" && !m.wreck)
      .flatMap((m) => m.cells)
      .map((p) => ({ ...p, r: 5 })),
    ...(s.friend.hp > 0 ? [{ ...s.friend, r: 6 }] : []),
    ...s.workers.filter((w) => w.hp > 0).map((w) => ({ ...w, r: 3 })),
  ];
  for (const p of sources)
    for (let x = Math.floor(p.x - p.r); x <= Math.ceil(p.x + p.r); x++)
      for (let y = Math.floor(p.y - p.r); y <= Math.ceil(p.y + p.r); y++)
        if (distance(p, { x, y }) <= p.r) cells.add(key({ x, y }));
  return cells;
}
export function visibleState(room: Room, p: Player): State {
  const visible = vision(p),
    visibleAt = (v: Point) =>
      visible.has(key({ x: Math.round(v.x), y: Math.round(v.y) }));
  p.seen ??= {};
  const others = room.players.filter((o) => o !== p);
  for (const o of others) {
    for (const m of o.state.modules) {
      const cells = m.cells.filter(visibleAt);
      if (!cells.length) continue;
      const previous = p.seen[m.id];
      const known = new Map((previous?.cells ?? []).map((c) => [key(c), c]));
      cells.forEach((c) => known.set(key(c), c));
      p.seen[m.id] = {
        ...m,
        ...(m.type === "turret"
          ? { staffed: workPower(o.state, "guards", m.id) > 0 }
          : {}),
        cells: [...known.values()],
      };
      if (
        m.type === "core" &&
        !p.discovered.includes(o.id) &&
        distance(p.state.friend, m.cells[0]) <= 6
      ) {
        p.discovered.push(o.id);
        p.state.log = [`Discovered ${o.name}'s base.`, ...p.state.log].slice(
          0,
          8,
        );
      }
    }
  }
  // Clear canceled blueprints only where the player can currently observe their former cells.
  for (const [id, m] of Object.entries(p.seen))
    if (
      m.cells.every(visibleAt) &&
      !others.some((o) => o.state.modules.some((n) => n.id === Number(id)))
    )
      delete p.seen[Number(id)];
  return {
    ...p.state,
    seed: 0, // Layout/seat RNG stays server-side; clients receive only public objectives.
    terrain: [...(room.floor ?? []), ...Object.values(p.seen)],
    visibleCells: [...visible],
    visibleUnits: others
      .filter((o) => o.state.phase === "playing")
      .flatMap((o) =>
        [o.state.friend, ...o.state.workers]
          .filter((a) => a.hp > 0 && visibleAt(a))
          .map((a) => ({
            x: a.x,
            y: a.y,
            id: `${o.id}:${"id" in a ? a.id : "friend"}`,
            playerId: o.id,
            name: o.name,
            hp: a.hp,
            maxHp: a.maxHp,
            hero: a === o.state.friend,
            role:
              "role" in a
                ? ROLE_NAMES[
                    a.role as import("../games/farfield/engine.ts").Role
                  ]
                : "Friend",
            color: o.color,
          })),
      ),
    shots: room.players
      .flatMap((o) =>
        o.state.shots.map((shot) => ({ ...shot, hostile: o !== p })),
      )
      .filter((s) => visibleAt(s.from) && visibleAt(s.to))
      .map((s) => ({
        from: { x: s.from.x, y: s.from.y },
        to: { x: s.to.x, y: s.to.y },
        kind: s.kind,
        hostile: s.hostile,
        at: s.at,
      })),
  };
}
const tiles = (s: State) =>
  [...s.modules, ...(s.terrain ?? [])].filter((m) => m.progress >= 1);
function moveTo(s: State, a: Actor, goals: Point[]): boolean {
  const path = routeTo(s, a, goals);
  if (path === null) return false;
  const to = path.at(-1) ?? { x: Math.round(a.x), y: Math.round(a.y) };
  const m = tiles(s).find((m) =>
    m.cells.some((p) => p.x === to.x && p.y === to.y),
  );
  if (!m) return false;
  resetOrder(a, m.id, "move", to);
  return true;
}
export function battlefieldCommand(
  room: Room,
  p: Player,
  c: Command,
): string | null | undefined {
  const s = p.state;
  if (
    ![
      "capture",
      "attack",
      "guards",
      "raid",
      "explore",
      "ability",
      "combat-mode",
    ].includes(c.type)
  )
    return undefined;
  if (s.phase !== "playing" || s.paused) return "Launch an active match first.";
  if (c.type === "raid" || c.type === "explore")
    return "Explore and fight on the shared battlefield with your Friend.";
  if (c.type === "combat-mode") {
    if (
      !["friend", "workers"].includes(c.group) ||
      !["aggressive", "peaceful"].includes(c.mode)
    )
      return "Choose Friend or workers, and Aggressive or Peaceful.";
    const modes = (s.combatModes ??= {
      friend: "aggressive",
      workers: "peaceful",
    });
    modes[c.group] = c.mode;
    for (const actor of c.group === "friend" ? [s.friend] : s.workers) {
      actor.nextCombatScan = 0;
      if (c.mode === "peaceful") {
        if (!actor.resumeJob && actor.attack) resetOrder(actor, null, "idle");
        resumeJob(actor);
        actor.attack = undefined;
        actor.fighting = false;
      }
    }
    return null;
  }
  if (c.type === "guards") {
    if (c.stance === "station") {
      const guards = s.workers.filter((w) => w.role === "guards");
      for (const w of guards) {
        w.stance = undefined;
        resetOrder(w, null, "idle");
      }
      for (const w of guards) {
        const m = workplace(s, "guards");
        if (m) resetOrder(w, m.id, "work");
      }
      return null;
    }
    if (!["follow", "defend"].includes(c.stance))
      return "Choose follow or defend.";
    const at = {
      x: c.x ?? Math.round(s.friend.x),
      y: c.y ?? Math.round(s.friend.y),
    };
    if (
      !Number.isInteger(at.x) ||
      !Number.isInteger(at.y) ||
      !tiles(s).some((m) => m.cells.some((t) => t.x === at.x && t.y === at.y))
    )
      return "Choose completed flooring to defend.";
    for (const w of s.workers.filter((w) => w.role === "guards")) {
      w.stance = c.stance;
      w.defendAt = at;
      w.destination = null;
    }
    return null;
  }
  if (s.friend.hp <= 0) return "Your Friend is recovering at the core.";
  if (c.type === "ability") {
    if (c.ability !== "shield" && c.ability !== "emp")
      return "Choose Shield or EMP.";
    const def = ABILITIES[c.ability];
    if (!def) return "Choose Shield or EMP.";
    const a = (s.abilities ??= {
      shieldUntil: 0,
      shieldReady: 0,
      empReady: 0,
      empAt: -10,
    });
    if (s.time < (c.ability === "shield" ? a.shieldReady : a.empReady))
      return `${def.name} is recharging.`;
    if (s.energy < def.cost) return `${def.name} needs ${def.cost} energy.`;
    if (c.ability === "shield") {
      a.shieldUntil = s.time + def.duration;
      a.shieldReady = s.time + def.cooldown;
    } else {
      const sight = vision(p);
      const turrets = room.players
        .filter((o) => o !== p && o.state.phase === "playing")
        .flatMap((o) => o.state.modules)
        .filter(
          (m) =>
            m.type === "turret" &&
            m.progress >= 1 &&
            !m.wreck &&
            m.cells.some(
              (t) =>
                distance(t, s.friend) <= COMBAT.empRange && sight.has(key(t)),
            ),
        );
      if (!turrets.length)
        return "No visible enemy turret within 6 tiles. Move closer before using EMP.";
      turrets.forEach((m) => (m.disabledUntil = s.time + def.duration));
      a.empReady = s.time + def.cooldown;
      a.empAt = s.time;
    }
    s.energy -= def.cost;
    return null;
  }
  if (c.type === "capture") {
    const m = room.monoliths?.[c.index];
    if (!m) return "Choose a monolith.";
    const goals = tiles(s)
      .flatMap((t) => t.cells)
      .filter((t) => distance(t, m) <= 2.5);
    if (!moveTo(s, s.friend, goals))
      return "Build a completed path to this monolith first.";
    return null;
  }
  if (c.type === "attack") {
    const other = room.players.find(
      (o) => o.id === c.target && o !== p && o.state.phase === "playing",
    );
    if (!other) return "Choose an active enemy.";
    const target =
      c.moduleId !== undefined
        ? other.state.modules.find((m) => m.id === c.moduleId && !m.wreck)
        : c.unitId !== undefined
          ? other.state.workers.find((w) => w.id === c.unitId && w.hp > 0)
          : other.state.friend;
    if (!target) return "That target is gone.";
    const points = "cells" in target ? target.cells : [target];
    const sight = vision(p);
    if (
      !points.some((t) =>
        sight.has(key({ x: Math.round(t.x), y: Math.round(t.y) })),
      )
    )
      return "Explore with your Friend to find that enemy.";
    const goals = tiles(s)
      .flatMap((t) => t.cells)
      .filter((t) => points.some((o) => distance(t, o) <= 2));
    if (!moveTo(s, s.friend, goals))
      return "Connect a completed path into attack range.";
    s.friend.attack = {
      playerId: other.id,
      ...(c.moduleId !== undefined ? { moduleId: c.moduleId } : {}),
      ...(c.unitId !== undefined ? { unitId: c.unitId } : {}),
    };
    return null;
  }
}
function wreck(p: Player, m: Module) {
  if (m.wreck) return;
  if (m.type === "core") return;
  m.type = "passage";
  m.wreck = true;
  m.progress = 1;
  m.hp = 0;
  for (const a of [p.state.friend, ...p.state.workers])
    if (a.targetId === m.id || a.resumeJob?.targetId === m.id) {
      resetOrder(a, null, "idle");
      if ("role" in a) a.role = "builders";
    }
  assignedRoles(p.state);
}
function resumeJob(actor: Actor) {
  const job = actor.resumeJob;
  if (!job) return;
  resetOrder(actor, job.targetId, job.order, job.destination);
  actor.nodeId = job.nodeId;
}
function endPursuit(actor: Actor) {
  // Dropping just the target leaves the movement order and cached route alive.
  // Automatic combat returns to its interrupted job; an explicit attack stops.
  if (actor.resumeJob) resumeJob(actor);
  else resetOrder(actor, null, "idle");
  actor.fighting = false;
  actor.task = actor.order === "idle" ? "idle" : "move";
}
/** Acquire only nearby, visible targets reachable on completed flooring. Scan at most once a second. */
function autoCombat(
  p: Player,
  actor: Actor,
  enemies: Player[],
  sight: () => Set<string>,
) {
  const s = p.state;
  const aggressive =
    (s.combatModes?.[actor === s.friend ? "friend" : "workers"] ??
      (actor === s.friend ? "aggressive" : "peaceful")) === "aggressive";
  if (!aggressive || actor.hp <= 0) return;
  // Explicit movement and attack orders to the Friend take priority over automation.
  if (
    !actor.resumeJob &&
    actor === s.friend &&
    (actor.attack || actor.path.length)
  )
    return;
  if ((actor.nextCombatScan ?? 0) > s.time) return;
  actor.nextCombatScan = s.time + 1;
  const candidates = enemies
    .flatMap((o) => [
      ...[o.state.friend, ...o.state.workers]
        .filter((a) => a.hp > 0)
        .map((a) => ({
          points: [a],
          order: {
            playerId: o.id,
            ...("id" in a ? { unitId: a.id as number } : {}),
          },
        })),
      ...o.state.modules
        .filter((m) => m.progress >= 1 && !m.wreck && m.type !== "passage")
        .map((m) => ({
          points: m.cells,
          order: { playerId: o.id, moduleId: m.id },
        })),
    ])
    .map((c) => ({
      ...c,
      distance: Math.min(...c.points.map((t) => distance(actor, t))),
    }))
    .filter(
      (c) =>
        c.distance <= 6 &&
        c.points.some((t) =>
          sight().has(key({ x: Math.round(t.x), y: Math.round(t.y) })),
        ),
    )
    .sort((a, b) => a.distance - b.distance);
  const saved = actor.resumeJob ?? {
    targetId: actor.targetId,
    order: actor.order,
    destination: actor.destination,
    nodeId: actor.nodeId,
  };
  for (const candidate of candidates) {
    const goals = tiles(s)
      .flatMap((m) => m.cells)
      .filter((t) => candidate.points.some((p) => distance(t, p) <= 2));
    if (!moveTo(s, actor, goals)) continue;
    actor.resumeJob = saved;
    actor.attack = candidate.order;
    actor.working = false;
    return;
  }
  resumeJob(actor);
}
export function advanceBattlefield(room: Room, dt: number) {
  if (!room.monoliths || room.players[0]?.state.paused) return;
  const active = room.players.filter((p) => p.state.phase === "playing");
  for (const p of active)
    for (const a of [p.state.friend, ...p.state.workers]) a.fighting = false;
  const damage = new Map<Actor, { amount: number; source: Player }>();
  const buildings = new Map<
    Module,
    { amount: number; source: Player; defender: Player }
  >();
  const hit = (a: Actor, amount: number, source: Player) => {
    const prev = damage.get(a);
    damage.set(a, { amount: amount + (prev?.amount ?? 0), source });
  };
  for (const p of active) {
    if (p.bot && p.state.friend.hp > 0) {
      const s = p.state;
      if (
        s.friend.hp < { easy: 45, normal: 65, hard: 85 }[s.difficulty] &&
        s.time - s.friend.lastHit < 2 &&
        s.time >= (s.abilities?.shieldReady ?? 0)
      )
        battlefieldCommand(room, p, { type: "ability", ability: "shield" });
      if (s.friend.attack && s.time >= (s.abilities?.empReady ?? 0))
        battlefieldCommand(room, p, { type: "ability", ability: "emp" });
    }
    const s = p.state,
      enemyUnits = active
        .filter((o) => o !== p)
        .flatMap((o) =>
          [o.state.friend, ...o.state.workers]
            .filter((a) => a.hp > 0)
            .map((a) => ({ a, o })),
        );
    const opponents = active.filter((o) => o !== p);
    let combatSight: Set<string> | undefined;
    const sight = () => (combatSight ??= vision(p));
    for (const a of [s.friend, ...s.workers]) {
      // Specialist assignments are posts, not temporary jobs for the combat toggle.
      // Guards explicitly ordered to follow/hold are a mobile squad, not turret staff.
      if (
        a !== s.friend &&
        "role" in a &&
        a.role !== "builders" &&
        !(a.role === "guards" && a.stance)
      ) {
        resumeJob(a);
        a.attack = undefined;
        a.fighting = false;
        continue;
      }
      if (a.evacuating) continue;
      autoCombat(p, a, opponents, sight);
      if (a.hp <= 0) continue;
      const aggressive =
        (s.combatModes?.[a === s.friend ? "friend" : "workers"] ??
          (a === s.friend ? "aggressive" : "peaceful")) === "aggressive";
      const attack = a.attack;
      if (!aggressive && !attack) continue;
      const unitDamage =
        a === s.friend
          ? COMBAT.friendDamage
          : "role" in a && a.role === "guards"
            ? COMBAT.guardDamage
            : 3;
      const target = enemyUnits
        .filter(
          ({ a: e, o }) =>
            distance(a, e) <= 2.2 &&
            (!attack ||
              attack.moduleId !== undefined ||
              (o.id === attack.playerId &&
                (attack.unitId === undefined
                  ? e === o.state.friend
                  : "id" in e && e.id === attack.unitId))),
        )
        .sort((x, y) => distance(a, x.a) - distance(a, y.a))[0];
      const boost = 1;
      if (target && attack?.moduleId === undefined) {
        hit(target.a, unitDamage * boost * dt, p);
        a.working = false;
        a.fighting = true;
        a.task = "combat";
        s.shots.push({
          from: { x: a.x, y: a.y },
          to: { x: target.a.x, y: target.a.y },
          kind: a === s.friend ? "friend" : "guard",
          at: s.time,
        });
      } else if (attack) {
        const order = attack,
          other = active.find((o) => o.id === order.playerId);
        if (!other) {
          endPursuit(a);
          continue;
        }
        const sight = vision(p);
        const targetModule = other.state.modules.find(
          (m) => m.id === order.moduleId && !m.wreck,
        );
        const targetUnit =
          order.moduleId === undefined
            ? order.unitId === undefined
              ? other.state.friend
              : other.state.workers.find((w) => w.id === order.unitId)
            : undefined;
        if (
          ![...(targetModule?.cells ?? (targetUnit ? [targetUnit] : []))].some(
            (t) => sight.has(key({ x: Math.round(t.x), y: Math.round(t.y) })),
          )
        ) {
          endPursuit(a);
          continue;
        }
        if (
          targetModule &&
          targetModule.cells.some((t) => distance(a, t) <= 2.2)
        ) {
          const amount =
            (a === s.friend ? COMBAT.siegeDamage : unitDamage) * dt;
          const prev = buildings.get(targetModule);
          buildings.set(targetModule, {
            amount: amount + (prev?.amount ?? 0),
            source: p,
            defender: other,
          });
          a.fighting = true;
          a.task = "combat";
          a.working = false;
          s.shots.push({
            from: { x: a.x, y: a.y },
            to: targetModule.cells[0],
            kind: a === s.friend ? "friend" : "guard",
            at: s.time,
          });
        } else if (targetModule || (targetUnit && targetUnit.hp > 0)) {
          const points = targetModule?.cells ?? [targetUnit!];
          if (!a.path.length) {
            const goals = tiles(s)
              .flatMap((m) => m.cells)
              .filter((t) => points.some((o) => distance(t, o) <= 2));
            const saved = a.resumeJob;
            moveTo(s, a, goals);
            a.resumeJob = saved;
            a.attack = order;
          }
        } else endPursuit(a);
      }
    }
    for (const m of s.modules.filter(
      (m) => m.type === "turret" && m.progress >= 1 && !m.wreck,
    )) {
      const power = workPower(s, "guards", m.id);
      if (!power || (m.disabledUntil ?? 0) > s.time) continue;
      const target = enemyUnits.find(({ a }) =>
        m.cells.some((t) => distance(t, a) <= 5),
      );
      if (target) {
        hit(target.a, COMBAT.turretDamage * dt, p);
        s.shots.push({
          from: m.cells[0],
          to: { x: target.a.x, y: target.a.y },
          kind: "turret",
          at: s.time,
        });
      }
    }
  }
  // Resolve simultaneously, avoiding a host/seat-order combat advantage.
  for (const [a, h] of damage) {
    const owner = active.find((p) => p.state.friend === a);
    const shielded =
      owner && (owner.state.abilities?.shieldUntil ?? 0) > owner.state.time;
    a.hp = Math.max(0, a.hp - h.amount * (shielded ? 0.35 : 1));
    a.lastHit = h.source.state.time;
  }
  for (const [m, h] of buildings) {
    const s = h.defender.state;
    if (m.type === "core") {
      s.integrity = Math.max(0, s.integrity - h.amount);
      m.hp = s.integrity;
      if (!s.integrity) {
        s.phase = "lost";
        s.elimination = { reason: "core-destroyed", by: h.source.name };
      }
    } else {
      m.hp = Math.max(0, (m.hp ?? 100) - h.amount);
      if (!m.hp) wreck(h.defender, m);
    }
  }
  for (const p of active) {
    const s = p.state;
    s.workers = s.workers.filter((w) => w.hp > 0);
    assignedRoles(s);
    if (s.phase !== "playing") continue;
    if (s.friend.hp <= 0) {
      if (!s.friend.respawnAt) {
        s.friend.respawnAt = s.time + 15;
        resetOrder(s.friend, null, "idle");
        s.log = [
          "Friend down · returns at the core in 15 seconds.",
          ...s.log,
        ].slice(0, 8);
      }
      if (s.time >= s.friend.respawnAt) {
        Object.assign(s.friend, s.spawn);
        s.friend.hp = s.friend.maxHp;
        s.friend.respawnAt = 0;
        resetOrder(
          s.friend,
          s.modules.find((m) => m.type === "core")!.id,
          "salvage",
        );
      }
    }
    const core = s.modules.find((m) => m.type === "core");
    // Only medics actually on duty power an infirmary; the Friend is a patient.
    const infirmaries = new Map(
      s.modules
        .filter(
          (m) =>
            m.type === "infirmary" &&
            m.progress >= 1 &&
            !m.wreck &&
            !m.dismantling,
        )
        .map((module) => [module.id, { module, staff: 0 }]),
    );
    for (const worker of s.workers) {
      if (
        worker.hp <= 0 ||
        worker.role !== "medics" ||
        !worker.working ||
        worker.task !== "medics" ||
        worker.fighting ||
        worker.evacuating ||
        worker.resumeJob
      )
        continue;
      const station = infirmaries.get(worker.targetId!);
      if (station?.module.cells.some((cell) => distance(cell, worker) < 0.01))
        station.staff = Math.min(2, station.staff + 1);
    }
    for (const a of [s.friend, ...s.workers]) {
      if (a.hp <= 0 || damage.has(a) || s.time - a.lastHit < 4) continue;
      let healing = core?.cells.some((t) => distance(t, a) <= 3) ? 8 : 0;
      for (const { module, staff } of infirmaries.values()) {
        if (staff && module.cells.some((t) => distance(t, a) <= 4))
          healing = Math.max(healing, 8 * staff);
      }
      a.hp = Math.min(a.maxHp, a.hp + healing * dt);
    }
  }
  for (const m of room.monoliths) {
    if (
      m.ownerId &&
      !active.some((p) => p.id === m.ownerId && p.state.phase === "playing")
    ) {
      m.ownerId = null;
      m.ownerName = "";
      m.progress = 0;
    }
    const contenders = active.filter(
      (p) =>
        p.state.phase === "playing" &&
        [
          p.state.friend,
          ...p.state.workers.filter((w) => w.role === "guards"),
        ].some((a) => a.hp > 0 && distance(a, m) <= 2.5),
    );
    m.contested = contenders.length > 1;
    const leader =
      contenders.length === 1 &&
      contenders[0].state.friend.hp > 0 &&
      distance(contenders[0].state.friend, m) <= 2.5
        ? contenders[0]
        : undefined;
    if (leader && leader.id !== m.ownerId) {
      if (m.claimant !== leader.id) {
        m.claimant = leader.id;
        m.progress = 0;
      }
      m.progress = Math.min(
        100,
        m.progress +
          (100 *
            dt *
            (1 + Math.min(1, workPower(leader.state, "scientists") * 0.25))) /
            CAPTURE_SECONDS,
      );
      if (m.progress >= 100) {
        m.ownerId = leader.id;
        m.ownerName = leader.name;
        m.claimant = null;
        for (const p of room.players)
          p.state.log = [
            `${leader.name} captured ${m.name}.`,
            ...p.state.log,
          ].slice(0, 8);
      }
    } else if (!m.contested && (!leader || leader.id === m.ownerId)) {
      m.claimant = null;
      m.progress = m.ownerId ? 100 : 0;
    }
  }
  const holder = active.find(
    (p) =>
      p.state.phase === "playing" &&
      room.monoliths!.every(
        (m) => m.ownerId === p.id && !m.contested && !m.claimant,
      ),
  );
  room.hold ??= { ownerId: null, name: "", seconds: 0 };
  if (!holder)
    Object.assign(room.hold, { ownerId: null, name: "", seconds: 0 });
  else {
    if (room.hold.ownerId !== holder.id)
      Object.assign(room.hold, {
        ownerId: holder.id,
        name: holder.name,
        seconds: 0,
      });
    room.hold.seconds += dt;
    if (room.hold.seconds >= HOLD_SECONDS) holder.state.phase = "won";
  }
}
