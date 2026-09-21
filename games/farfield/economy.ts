import type { RoomType, State } from "./engine.ts";
export const RECRUIT_SECONDS = 6;
export const MAX_RECRUIT_QUEUE = 5;
export const WORKER_FOOD_UPKEEP = 0.13;
export const FOOD_SHORTAGE_SECONDS = 30;
export function workerEfficiency(s: State) {
  return 1 - 0.5 * Math.max(0, Math.min(1, s.foodShortage ?? 0));
}

export const MINER_ALLOY_RATE = 0.3;
export const ENGINEER_ENERGY_RATE = 0.45;
export const CORE_SALVAGE_RATE = 0.15;
/** Energy per second for each completed four-tile module, including idle ones. */
export const BUILDING_POWER_UPKEEP: Readonly<Record<RoomType, number>> = {
  core: 0.02,
  passage: 0.01,
  solar: 0.03,
  garden: 0.1,
  foundry: 0.12,
  habitat: 0.08,
  turret: 0.2,
  lab: 0.14,
  infirmary: 0.12,
};
export function powerDemand(s: State) {
  return s.modules.reduce(
    (total, module) =>
      total +
      (module.progress >= 1 && !module.wreck && !module.dismantling
        ? BUILDING_POWER_UPKEEP[module.type]
        : 0),
    0,
  );
}
export function powerEfficiency(s: State) {
  return s.energy > 0 ? 1 : 0;
}
