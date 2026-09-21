import type { State, Command } from "./engine.ts";
export type RoomView = {
  draw?: boolean;
  revision: number;
  mode: "solo" | "pvp" | "custom" | "online";
  maxPlayers: number;
  economy: {
    kind: "practice" | "wager";
    entry: string;
    payoutsEnabled: boolean;
    wager?: import("../../shared/wagers.ts").Wager;
  };
  selfId: string;
  combatAt: number;
  raidReadyAt: number;
  winnerId: string | null;
  victoryReason: "signals" | "last-standing" | null;
  opponents: {
    id: string;
    name: string;
    bot: boolean;
    color: string;
    signal: { x: number; y: number };
    discovered: boolean;
    state: State | null;
  }[];
  code: string;
  isHost: boolean;
  state: State;
  players: {
    id: string;
    name: string;
    bot: boolean;
    friendId: string;
    difficulty: import("./engine.ts").Difficulty;
    color: string;
    online: boolean;
    host: boolean;
  }[];
};
export type Session = { code: string; token: string };
/** Private request/reply port to the trusted host; no wallet APIs or arbitrary URLs. */
export function request<T>(
  action: string,
  body: unknown,
  token = "",
): Promise<T> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const close = () => {
      clearTimeout(timeout);
      channel.port1.close();
    };
    const timeout = setTimeout(() => {
      channel.port1.close();
      reject(new Error("Station connection timed out."));
    }, 10000);
    channel.port1.onmessage = (event) => {
      close();
      if (event.data?.error) reject(new Error(event.data.error));
      else resolve(event.data.result as T);
    };
    channel.port1.onmessageerror = () => {
      close();
      reject(new Error("Invalid station response."));
    };
    window.parent.postMessage(
      { channel: "farfield-room-v1", action, body, token },
      new URL(window.location.href).origin,
      [channel.port2],
    );
  });
}
export const send = (session: Session, command: Command) =>
  request<RoomView>("command", { code: session.code, command }, session.token);
