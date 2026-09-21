import type { State, Command } from "./engine.ts";
export type { RankProfile, RankResult } from "../../server/ranking.ts";
import type { RankProfile, RankResult } from "../../server/ranking.ts";
export type RoomView = {
  ranked?: { season: string; profile: RankProfile; opponent: RankProfile | null; result: RankResult | null; cancelled?: string };
  draw?: boolean;
  revision: number;
  mode: "solo" | "pvp" | "custom" | "online";
  maxPlayers: number;
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

/** Long-lived private reply port. Heartbeats detect a stalled proxy or host. */
export function subscribe(
  session: Session,
  active: boolean,
  onView: (view: RoomView) => void,
  onError: (error: Error) => void,
): { close: () => void; presence: (active: boolean) => void } {
  const channel = new MessageChannel();
  let closed = false;
  let watchdog: ReturnType<typeof setTimeout>;
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(watchdog);
    channel.port1.postMessage({ cancel: true });
    channel.port1.close();
  };
  const fail = (message: string) => {
    if (closed) return;
    close();
    onError(new Error(message));
  };
  const reset = () => {
    clearTimeout(watchdog);
    watchdog = setTimeout(() => fail("Station connection timed out."), 22000);
  };
  channel.port1.onmessage = (event) => {
    if (closed) return;
    reset();
    if (event.data?.error) fail(event.data.error);
    else if (event.data?.result) onView(event.data.result as RoomView);
  };
  channel.port1.onmessageerror = () => fail("Invalid station update.");
  reset();
  window.parent.postMessage(
    {
      channel: "farfield-room-v1",
      action: "subscribe",
      body: { code: session.code, active },
      token: session.token,
    },
    new URL(window.location.href).origin,
    [channel.port2],
  );
  return {
    close,
    presence: (active) => {
      if (!closed) channel.port1.postMessage({ active });
    },
  };
}
