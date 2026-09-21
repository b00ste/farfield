import {
  positionPlayers,
  syncTerrain,
  visibleState,
  battlefieldCommand,
  advanceBattlefield,
} from "./battlefield.ts";
import type { Wager } from "../shared/wagers.ts";
import { randomBytes } from "node:crypto";
import {
  applyCommand,
  createState,
  tick,
  DIFFICULTIES,
  type Command,
  type State,
  type Difficulty,
} from "../games/farfield/engine.ts";
import { decide } from "./arena.ts";
export type Mode = "solo" | "pvp" | "custom" | "online";
export type Player = {
  wallet?: `0x${string}`;
  id: string;
  token: string;
  friendId: string;
  name: string;
  bot: boolean;
  lastSeen: number;
  active: boolean;
  departed?: boolean;
  color: string;
  state: State;
  raidReadyAt: number;
  nextDecision: number;
  discovered: string[];
  seen?: Record<number, import("../games/farfield/engine.ts").Module>;
};
export type Room = {
  draw?: boolean;
  monoliths?: import("../games/farfield/engine.ts").Monolith[];
  floor?: import("../games/farfield/engine.ts").Module[];
  hold?: { ownerId: string | null; name: string; seconds: number };
  wager?: Wager;
  code: string;
  host: string;
  mode: Mode;
  players: Player[];
  touched: number;
  revision: number;
  seed: number;
  difficulty: Difficulty;
  combatAt: number;
  winnerId: string | null;
};
const colors = ["#b8d9ca", "#e6bd7d", "#aca6dc", "#df9fa9", "#8fc9e8"];
function player(
  friendId: string,
  index: number,
  room: Room,
  now: number,
  bot = false,
): Player {
  const state = createState(room.seed, room.difficulty);
  state.attackWaves = false;
  return {
    id: randomBytes(6).toString("hex"),
    token: bot ? "" : randomBytes(24).toString("hex"),
    friendId,
    name: bot
      ? { easy: "Cadet", normal: "Navigator", hard: "Strategist" }[
          room.difficulty
        ] + " · AI"
      : `Friend #${friendId}`,
    bot,
    lastSeen: now,
    active: true,
    color: colors[index],
    state,
    raidReadyAt: 0,
    nextDecision: 0,
    discovered: [],
  };
}
export class Rooms {
  rooms = new Map<string, Room>();
  create(
    friendId: string,
    now = Date.now(),
    difficulty: Difficulty = "normal",
    mode: Mode = "solo",
    bots: Difficulty[] = [],
  ) {
    this.clean(now);
    if (
      bots.length > 3 ||
      bots.some((d) => !["easy", "normal", "hard"].includes(d))
    )
      throw new Error("Choose up to three AI commanders.");
    if (this.rooms.size >= 100)
      throw new Error("The sector is full. Try again later.");
    let code: string;
    do {
      code = randomBytes(5).toString("hex").toUpperCase();
    } while (this.rooms.has(code));
    const room: Room = {
      code,
      host: "",
      mode,
      players: [],
      touched: now,
      revision: 0,
      seed: randomBytes(4).readUInt32LE(),
      difficulty,
      combatAt:
        mode === "pvp" || mode === "online"
          ? 120
          : DIFFICULTIES[difficulty].firstWave,
      winnerId: null,
    };
    const human = player(friendId, 0, room, now);
    room.host = human.token;
    room.players.push(human);
    if (mode === "solo") room.players.push(player("", 1, room, now, true));
    if (mode === "custom")
      for (const level of bots) this.addBot(room, level, now);
    positionPlayers(room);
    this.rooms.set(code, room);
    return { token: human.token, ...this.view(room, human.token, now) };
  }
  join(code: string, friendId: string, now = Date.now()) {
    const room = this.rooms.get(code);
    if (!room)
      throw new Error("No match with that code. Check all 10 characters.");
    if (room.mode !== "pvp" && room.mode !== "custom")
      throw new Error(
        "This is a solo match. Create a multiplayer match to invite friends.",
      );
    if (room.players.some((p) => p.state.phase !== "ready"))
      throw new Error("This match has already launched. Join a new lobby.");
    room.players = room.players.filter(
      (p) => p.bot || now - p.lastSeen < 300_000,
    );
    if (room.players.length >= 4)
      throw new Error("This match has no free commander slots.");
    const joined = player(friendId, room.players.length, room, now);
    room.players.push(joined);
    positionPlayers(room);
    if (!room.players.some((p) => p.token === room.host))
      room.host = joined.token;
    room.touched = now;
    room.revision++;
    return { token: joined.token, ...this.view(room, joined.token, now) };
  }
  access(code: string, token: string, now = Date.now()) {
    const room = this.rooms.get(code),
      current = room?.players.find(
        (p) => !p.bot && !p.departed && p.token === token && token.length > 0,
      );
    if (!room || !current)
      throw new Error("This room session expired. Join the match again.");
    current.lastSeen = now;
    room.touched = now;
    if (
      !room.players.some(
        (p) =>
          !p.departed && p.token === room.host && now - p.lastSeen < 15_000,
      )
    )
      room.host = token;
    return { room, player: current };
  }
  view(room: Room, token: string, now = Date.now()) {
    const own = room.players.find(
      (p) => !p.bot && p.token === token && token.length > 0,
    );
    if (!own) throw new Error("This room session expired.");
    const state = visibleState(room, own);
    return {
      code: room.code,
      revision: room.revision,
      isHost: room.host === token,
      mode: room.mode,
      selfId: own.id,
      maxPlayers: room.mode === "online" ? 2 : 4,
      economy: {
        kind: room.wager ? ("wager" as const) : ("practice" as const),
        entry: room.wager ? "1" : "0",
        payoutsEnabled: !!room.wager,
        wager: room.wager,
      },
      combatAt: room.combatAt,
      raidReadyAt: own.raidReadyAt,
      winnerId: room.winnerId,
      draw: !!room.draw,
      victoryReason: room.winnerId
        ? room.hold?.ownerId === room.winnerId && room.hold.seconds >= 60
          ? ("signals" as const)
          : ("last-standing" as const)
        : null,
      state,
      opponents: room.players
        .filter((p) => p.id !== own.id)
        .map((p) => ({
          id: p.id,
          name: p.name,
          bot: p.bot,
          color: p.color,
          signal: { x: 0, y: 0 }, // Legacy protocol field; never discloses a spawn.
          discovered: own.discovered.includes(p.id),
          state: null, // Enemy details are spatially filtered into the shared map.
          difficulty: p.state.difficulty,
        })),
      players: room.players.map((p) => ({
        id: p.id,
        friendId: p.friendId,
        name: p.name,
        bot: p.bot,
        difficulty: p.state.difficulty,
        color: p.color,
        online: p.bot || (!p.departed && now - p.lastSeen < 8000),
        host: p.token === room.host,
      })),
    };
  }
  command(code: string, token: string, command: Command, now = Date.now()) {
    const { room, player: current } = this.access(code, token, now);
    syncTerrain(room);
    const battleError = battlefieldCommand(room, current, command);
    if (battleError !== undefined) {
      if (battleError) throw new Error(battleError);
      room.revision++;
      return this.view(room, token, now);
    }
    if (
      (command.type === "start" || command.type === "pause") &&
      room.host !== token
    )
      throw new Error("Only the room host can launch or pause the match.");
    if (command.type === "bot-add" || command.type === "bot-remove") {
      if (
        room.mode !== "custom" ||
        room.host !== token ||
        current.state.phase !== "ready"
      )
        throw new Error("Only the host can edit AI commanders before launch.");
      if (command.type === "bot-add")
        this.addBot(room, command.difficulty, now);
      else {
        const target = room.players.find(
          (p) => p.id === command.target && p.bot,
        );
        if (!target) throw new Error("Choose an AI commander.");
        room.players = room.players.filter((p) => p !== target);
        positionPlayers(room);
      }
    } else if (command.type === "forfeit") {
      if (current.state.phase !== "playing")
        throw new Error("No active match to forfeit.");
      current.state.phase = "lost";
      current.state.integrity = 0;
      current.state.elimination = { reason: "forfeit" };
      current.state.log.unshift("You forfeited this match.");
      this.settle(room);
    } else if (command.type === "start") {
      if (room.wager)
        throw new Error("Both escrow deposits must confirm before launch.");
      if (room.players.length < 2)
        throw new Error(
          "Invite at least one rival before launching multiplayer.",
        );
      if (room.players.some((p) => p.state.phase !== "ready"))
        throw new Error("Match already launched.");
      positionPlayers(room);
      for (const p of room.players) applyCommand(p.state, command, p.id);
    } else if (command.type === "pause") {
      if (room.mode === "online")
        throw new Error("Online matches cannot be paused.");
      if (room.winnerId || current.state.phase !== "playing")
        throw new Error("Match is not active.");
      const paused = !current.state.paused;
      for (const p of room.players) p.state.paused = paused;
    } else {
      if (command.type === "direct" && current.state.friend.hp <= 0)
        throw new Error("Your Friend is recovering at the core.");
      const error = applyCommand(
        current.state,
        command,
        current.id,
        room.players
          .filter((p) => p !== current)
          .flatMap((p) => [p.state.friend, ...p.state.workers]),
      );
      if (error) throw new Error(error);
    }
    room.revision++;
    return this.view(room, token, now);
  }
  advance(dt: number, now = Date.now()) {
    for (const room of this.rooms.values()) {
      // Visibility is a rendering hint, not permission to pause competitive
      // play. Keep online matches running throughout the reconnect window,
      // even when every tab is hidden or every connection has dropped.
      const onlinePlaying =
        room.mode === "online" &&
        room.players.some((p) => p.state.phase === "playing");
      if (
        room.winnerId ||
        room.draw ||
        (!onlinePlaying &&
          !room.players.some(
            (p) => !p.bot && p.active && now - p.lastSeen < 8000,
          ))
      )
        continue;

      if (onlinePlaying) {
        for (const p of room.players) {
          if (p.state.phase === "playing" && now - p.lastSeen > 60_000) {
            p.state.phase = "lost";
            p.state.integrity = 0;
            p.state.elimination = { reason: "disconnect" };
            p.state.log.unshift("Connection timed out after 60 seconds.");
          }
        }
        this.settle(room);
        if (room.winnerId || room.draw) {
          room.revision++;
          continue;
        }
      }
      syncTerrain(room);
      for (const p of room.players) {
        tick(
          p.state,
          dt,
          room.players
            .filter((o) => o !== p)
            .flatMap((o) => [o.state.friend, ...o.state.workers]),
        );
        visibleState(room, p);
      }
      for (const p of room.players)
        if (p.bot) decide(p, room.players, room.combatAt);
      advanceBattlefield(room, Math.min(dt, 0.5));
      this.settle(room);
      room.revision++;
    }
    this.clean(now);
  }
  private settle(room: Room) {
    const alive = room.players.filter((p) => p.state.phase !== "lost");
    if (!alive.length && room.players.length) {
      room.draw = true;
      return;
    }
    const winner =
      room.players.find((p) => p.state.phase === "won") ??
      (alive.length === 1 && alive[0].state.phase === "playing"
        ? alive[0]
        : undefined);
    if (winner) {
      room.winnerId = winner.id;
      for (const p of room.players) {
        p.state.phase = p === winner ? "won" : "lost";
        p.state.log.unshift(
          p === winner
            ? "Sector secured. Your station wins."
            : `${winner.name} won the sector.`,
        );
      }
    }
  }
  private addBot(room: Room, difficulty: Difficulty, now: number) {
    if (!["easy", "normal", "hard"].includes(difficulty))
      throw new Error("Choose an AI difficulty.");
    if (
      room.players.length >= 4 ||
      room.players.filter((p) => p.bot).length >= 3
    )
      throw new Error("Four commanders maximum, including you.");
    const bot = player("", room.players.length, room, now, true);
    bot.state.difficulty = difficulty;
    bot.name = `${{ easy: "Cadet", normal: "Navigator", hard: "Strategist" }[difficulty]} ${room.players.filter((p) => p.bot).length + 1} · AI`;
    room.players.push(bot);
    positionPlayers(room);
  }
  matchmake(
    friendId: string,
    now = Date.now(),
    wager?: Wager,
    wallet?: `0x${string}`,
  ) {
    this.clean(now);
    for (const room of this.rooms.values()) {
      if (
        room.mode !== "online" ||
        !!room.wager !== !!wager ||
        room.players.length !== 1 ||
        room.players[0].state.phase !== "ready" ||
        now - room.players[0].lastSeen > 8000
      )
        continue;
      if (
        room.players[0].friendId === friendId ||
        (wallet &&
          room.players[0].wallet?.toLowerCase() === wallet.toLowerCase())
      )
        throw new Error("This Friend is already searching for a match.");
      const rival = player(friendId, 1, room, now);
      rival.wallet = wallet;
      room.players.push(rival);
      positionPlayers(room);
      if (!wager)
        for (const p of room.players) applyCommand(p.state, { type: "start" });
      room.touched = now;
      room.revision++;
      return { token: rival.token, ...this.view(room, rival.token, now) };
    }
    const created = this.create(friendId, now, "normal", "online");
    const room = this.rooms.get(created.code)!;
    room.wager = wager;
    room.players[0].wallet = wallet;
    return { token: created.token, ...this.view(room, created.token, now) };
  }
  leave(code: string, token: string, now = Date.now()) {
    const { room, player: current } = this.access(code, token, now);
    if (
      room.wager &&
      room.players.length === 2 &&
      current.state.phase === "ready"
    )
      throw new Error(
        "An escrow match is assigned. Use the deposit panel to track funding and timeout refunds.",
      );
    if (current.state.phase === "playing") {
      current.state.phase = "lost";
      current.state.integrity = 0;
      current.state.elimination = { reason: "forfeit" };
      this.settle(room);
    } else if (current.state.phase === "ready") {
      room.players = room.players.filter((p) => p !== current);
      if (room.host === token)
        room.host = room.players.find((p) => !p.bot)?.token ?? "";
    }
    current.active = false;
    current.departed = true;
    if (
      (!room.wager || !room.players.length) &&
      !room.players.some((p) => !p.bot && !p.departed)
    )
      this.rooms.delete(code);
    room.revision++;
    return { left: true };
  }
  clean(now = Date.now()) {
    for (const [code, room] of this.rooms)
      if (now - room.touched > 2 * 60 * 60 * 1000) this.rooms.delete(code);
  }
}
