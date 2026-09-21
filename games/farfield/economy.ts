import type { State } from "./engine.ts";
export const RECRUIT_SECONDS = 6;
export const MAX_RECRUIT_QUEUE = 5;
export const WORKER_FOOD_UPKEEP = 0.13;
export const FOOD_SHORTAGE_SECONDS = 30;
export function workerEfficiency(s: State) {
  return 1 - 0.5 * Math.max(0, Math.min(1, s.foodShortage ?? 0));
}
