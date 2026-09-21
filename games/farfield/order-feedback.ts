import { MODULES, type State, type Command, type Point } from "./engine.ts";
import { TASK_LABELS, type Actor } from "./actors.ts";
import { powerEfficiency } from "./economy.ts";
const poweredTasks = new Set(["miners", "farmers", "scientists", "medics", "guards"]);

/** Local workforce only: rival grid power is intentionally unknown. */
export function workIsUnpowered(s: State, actor: Pick<Actor, "task">) {
  return (
    !powerEfficiency(s) &&
    poweredTasks.has(actor.task)
  );
}

/** Resolve only information already visible to this client; never reveal hidden targets. */
export function attackTarget(s: State, attack = s.friend.attack) {
  if (!attack) return null;
  if (attack.moduleId !== undefined) {
    const module = s.terrain?.find(
      (m) =>
        m.owner === attack.playerId && m.id === attack.moduleId && !m.wreck,
    );
    return module
      ? { point: module.cells[0], label: MODULES[module.type].name }
      : null;
  }
  const unit = s.visibleUnits?.find(
    (u) =>
      u.playerId === attack.playerId &&
      (attack.unitId === undefined
        ? u.hero
        : !u.hero && Number(u.id.split(":")[1]) === attack.unitId),
  );
  return unit
    ? {
        point: { x: unit.x, y: unit.y },
        label: unit.hero ? "Enemy Friend" : "Enemy worker",
      }
    : null;
}

export function friendOrder(s: State) {
  const f = s.friend;
  if (f.hp <= 0) return "Returning to core";
  if (f.evacuating) return "Clearing building";
  const target = attackTarget(s);
  if (f.attack)
    return target
      ? `${f.path.length ? "Approaching" : "Attacking"} · ${target.label}`
      : "Target out of sight";
  const room = s.modules.find((m) => m.id === f.targetId);
  if (f.path.length)
    return room ? `Moving · ${MODULES[room.type].name}` : "Moving";
  if (f.working && workIsUnpowered(s, f))
    return room ? `Power off · ${MODULES[room.type].name}` : "Power off";
  if (f.working) return TASK_LABELS[f.task];
  const signal = s.monoliths.find(
    (m) => Math.hypot(m.x - f.x, m.y - f.y) <= 2.6,
  );
  if (signal?.contested) return "Monolith contested";
  if (signal?.claimant === s.playerId) return "Decoding monolith";
  return "Ready";
}

export function commandPoint(s: State, command: Command): Point | null {
  if (command.type === "direct" || command.type === "build")
    return { x: command.x, y: command.y };
  if (command.type === "capture") return s.monoliths[command.index] ?? null;
  if (command.type === "attack")
    return (
      attackTarget(s, {
        playerId: command.target,
        moduleId: command.moduleId,
        unitId: command.unitId,
      })?.point ?? null
    );
  return null;
}
export type OrderMarker = {
  point: Point;
  status: "pending" | "accepted" | "rejected";
  until: number;
};
