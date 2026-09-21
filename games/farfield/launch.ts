import type { Difficulty } from "./engine.ts";
export type LaunchConfig = {
  resume?: { code: string; token: string };
  wager?: boolean;
  auth?: string;
  mode: "custom" | "online";
  bots: Difficulty[];
  code: string;
  dock?: "bottom" | "left" | "right";
  muted: boolean;
  reduced: boolean;
};
