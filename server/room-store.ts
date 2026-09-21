import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { createState, MODULES, ROLES } from "../games/farfield/engine.ts";
import { createActor } from "../games/farfield/actors.ts";
import { syncTerrain } from "./battlefield.ts";
import type { Room } from "./rooms.ts";

const VERSION = 1;
const EXPIRY_MS = 2 * 60 * 60 * 1000;
const MAX_BYTES = 64 * 1024 * 1024;
type ObjectValue = Record<string, unknown>;
function object(value: unknown): value is ObjectValue {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function check(condition: unknown, field: string): asserts condition {
  if (!condition) throw new Error(`Invalid room snapshot: ${field}`);
}
function array(value: unknown, field: string): asserts value is unknown[] {
  check(Array.isArray(value), field);
}
function point(value: unknown) {
  check(object(value) && finite(value.x) && finite(value.y), "point");
}
// Require the current engine's mandatory scalar/object fields. Lists and nullable
// references are validated separately, rather than trusting a TypeScript cast.
function shape(value: unknown, sample: unknown, field: string) {
  if (sample === null) return;
  if (Array.isArray(sample)) return array(value, field);
  if (object(sample)) {
    check(object(value), field);
    for (const [key, child] of Object.entries(sample))
      shape(value[key], child, `${field}.${key}`);
    return;
  }
  check(
    typeof value === typeof sample &&
      (typeof value !== "number" || finite(value)),
    field,
  );
}
function moduleValue(value: unknown) {
  check(object(value), "module");
  check(
    Number.isSafeInteger(value.id) &&
      typeof value.type === "string" &&
      Object.hasOwn(MODULES, value.type),
    "module identity",
  );
  check(
    finite(value.progress) &&
      value.progress >= 0 &&
      value.progress <= 1 &&
      typeof value.owner === "string",
    "module progress/owner",
  );
  array(value.cells, "module cells");
  check(value.cells.length > 0, "empty module cells");
  value.cells.forEach(point);
  for (const key of ["hp", "disabledUntil"])
    if (value[key] !== undefined) check(finite(value[key]), `module ${key}`);
}
function actor(value: unknown) {
  shape(value, { ...createActor(), targetId: null }, "actor");
  check(object(value), "actor");
  point(value);
  array(value.path, "actor path");
  value.path.forEach(point);
  if (value.destination !== null) point(value.destination);
  if (value.defendAt !== undefined) point(value.defendAt);
  if (value.stance !== undefined) {
    check(["follow", "defend"].includes(String(value.stance)), "guard stance");
    if (value.stance === "defend") point(value.defendAt);
  }
  check(
    value.targetId === null || Number.isSafeInteger(value.targetId),
    "actor target",
  );
  check(
    value.nodeId === null || typeof value.nodeId === "string",
    "actor node",
  );
  if (value.resumeJob !== undefined) {
    check(
      object(value.resumeJob) && typeof value.resumeJob.order === "string",
      "actor resume job",
    );
    check(
      value.resumeJob.targetId === null ||
        Number.isSafeInteger(value.resumeJob.targetId),
      "resume target",
    );
    if (value.resumeJob.destination !== null)
      point(value.resumeJob.destination);
  }
  if (value.attack !== undefined)
    check(
      object(value.attack) && typeof value.attack.playerId === "string",
      "attack target",
    );
}
function monolith(value: unknown) {
  point(value);
  check(
    object(value) &&
      typeof value.name === "string" &&
      finite(value.progress) &&
      typeof value.connected === "boolean",
    "monolith",
  );
}
function validateRoom(value: unknown): asserts value is Room {
  check(object(value), "room");
  check(
    typeof value.code === "string" && /^[A-F0-9]{10}$/.test(value.code),
    "room code",
  );
  check(
    typeof value.host === "string" &&
      ["solo", "pvp", "custom", "online"].includes(String(value.mode)),
    "host/mode",
  );
  check(
    ["easy", "normal", "hard"].includes(String(value.difficulty)),
    "difficulty",
  );
  for (const field of ["touched", "revision", "seed", "combatAt"])
    check(finite(value[field]), `room ${field}`);
  check(
    Number.isSafeInteger(value.revision) &&
      (value.revision as number) >= 0 &&
      (value.revision as number) < Number.MAX_SAFE_INTEGER,
    "room revision",
  );
  check(
    value.winnerId === null || typeof value.winnerId === "string",
    "winner",
  );
  array(value.players, "players");
  check(value.players.length > 0 && value.players.length <= 4, "player count");
  const ids = new Set<string>(),
    tokens = new Set<string>();
  for (const p of value.players) {
    check(object(p), "player");
    for (const field of ["id", "token", "friendId", "name", "color"])
      check(typeof p[field] === "string", `player ${field}`);
    check(
      typeof p.bot === "boolean" && typeof p.active === "boolean",
      "player flags",
    );
    for (const field of ["lastSeen", "raidReadyAt", "nextDecision"])
      check(finite(p[field]), `player ${field}`);
    check(typeof p.id === "string" && !ids.has(p.id), "duplicate player");
    ids.add(p.id);
    if (!p.bot) {
      check(
        typeof p.token === "string" &&
          /^[a-f0-9]{48}$/.test(p.token) &&
          !tokens.has(p.token),
        "seat token",
      );
      tokens.add(p.token);
    }
    array(p.discovered, "discovered");
    check(
      p.discovered.every((id) => typeof id === "string"),
      "discovered ids",
    );
    if (p.seen !== undefined) {
      check(object(p.seen), "fog memory");
      Object.values(p.seen).forEach(moduleValue);
    }
    const s = p.state;
    shape(s, { ...createState(), friend: {} }, "state");
    check(object(s), "state");
    check(
      ["ready", "playing", "won", "lost"].includes(String(s.phase)) &&
        ["easy", "normal", "hard"].includes(String(s.difficulty)),
      "state phase/difficulty",
    );
    check(
      Number.isInteger(s.nextShape) &&
        (s.nextShape as number) >= 0 &&
        (s.nextShape as number) < 7,
      "next block",
    );
    if (s.spawn !== undefined) point(s.spawn);
    (s.shots as unknown[]).forEach((shot) => {
      check(object(shot), "combat shot");
      point(shot.from);
      point(shot.to);
    });
    actor(s.friend);
    array(s.workers, "workers");
    for (const worker of s.workers) {
      actor(worker);
      check(
        object(worker) &&
          Number.isSafeInteger(worker.id) &&
          ROLES.includes(worker.role as never),
        "worker job",
      );
    }
    array(s.modules, "modules");
    s.modules.forEach(moduleValue);
    check(
      s.modules.some((m) => object(m) && m.type === "core"),
      "missing core",
    );
    for (const list of ["terrain", "visibleUnits", "visibleCells"])
      if (s[list] !== undefined) array(s[list], list);
    (s.terrain as unknown[] | undefined)?.forEach(moduleValue);
    (s.enemies as unknown[]).forEach((enemy) => {
      point(enemy);
      check(
        object(enemy) && finite(enemy.hp) && finite(enemy.maxHp),
        "enemy health",
      );
    });
    (s.monoliths as unknown[]).forEach(monolith);
    (s.deposits as unknown[]).forEach((deposit) => {
      point(deposit);
      check(
        object(deposit) &&
          typeof deposit.id === "string" &&
          ["alloy", "energy", "food"].includes(String(deposit.resource)) &&
          finite(deposit.amount),
        "deposit",
      );
    });
    check(
      (s.log as unknown[]).every((line) => typeof line === "string"),
      "event log",
    );
    if (s.abilities !== undefined)
      shape(
        s.abilities,
        { shieldUntil: 0, shieldReady: 0, empReady: 0, empAt: 0 },
        "abilities",
      );
  }
  if (value.monoliths !== undefined) {
    array(value.monoliths, "shared monoliths");
    value.monoliths.forEach(monolith);
  }
  if (value.floor !== undefined) {
    array(value.floor, "shared floor");
    value.floor.forEach(moduleValue);
  }
  if (value.hold !== undefined) {
    check(
      object(value.hold) &&
        finite(value.hold.seconds) &&
        typeof value.hold.name === "string",
      "objective hold",
    );
    check(
      value.hold.ownerId === null || typeof value.hold.ownerId === "string",
      "hold owner",
    );
  }
}

/** Single-process practice-room recovery, not shared storage or HA.
 * The caller's save interval (normally five seconds) is the maximum crash-loss
 * window. Seat tokens are secrets: keep this path on a private persistent volume.
 */
export class RoomStore {
  private pending: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  readonly filename: string;
  constructor(
    filename: string,
    options: { webRoot?: string; now?: () => number } = {},
  ) {
    if (!isAbsolute(filename))
      throw new Error("Room snapshot path must be absolute.");
    this.filename = resolve(filename);
    const webRoot = resolve(
      options.webRoot ?? process.env.GAME_ROOT ?? "games/farfield/.friendsdk",
    );
    const pathFromWeb = relative(webRoot, this.filename);
    if (
      !pathFromWeb ||
      (!pathFromWeb.startsWith(`..${sep}`) &&
        pathFromWeb !== ".." &&
        !isAbsolute(pathFromWeb))
    )
      throw new Error("Room snapshot must be outside the web root.");
    this.now = options.now ?? Date.now;
  }
  async load(): Promise<Map<string, Room>> {
    let text: string;
    try {
      check(
        (await stat(this.filename)).size <= MAX_BYTES,
        "file exceeds 64 MiB",
      );
      text = await readFile(this.filename, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Map();
      throw error;
    }
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(text);
    } catch {
      throw new Error(
        "Invalid room snapshot: malformed JSON. Preserve the file for recovery.",
      );
    }
    check(
      object(snapshot) && snapshot.version === VERSION,
      "unsupported version",
    );
    check(finite(snapshot.savedAt), "savedAt");
    array(snapshot.rooms, "rooms");
    check(snapshot.rooms.length <= 100, "room count");
    const now = this.now(),
      rooms = new Map<string, Room>();
    for (const room of snapshot.rooms) {
      // Wagers must never resume through this practice-only persistence path.
      if (object(room) && room.wager !== undefined) continue;
      validateRoom(room);
      if (now - room.touched > EXPIRY_MS) continue;
      check(!rooms.has(room.code), "duplicate room code");
      room.revision++;
      room.touched = now;
      for (const player of room.players) {
        player.active = false;
        if (!player.departed && player.state.phase !== "lost")
          player.lastSeen = now;
      }
      syncTerrain(room);
      rooms.set(room.code, room);
    }
    return rooms;
  }
  save(rooms: ReadonlyMap<string, Room>): Promise<void> {
    const now = this.now();
    // Capture at call time, before queueing IO: later mutations cannot change an
    // earlier snapshot or reorder saves around slow disk operations.
    const text = JSON.stringify({
      version: VERSION,
      savedAt: now,
      rooms: [...rooms.values()].filter(
        (room) => !room.wager && now - room.touched <= EXPIRY_MS,
      ),
    });
    if (Buffer.byteLength(text) > MAX_BYTES)
      return Promise.reject(new Error("Room snapshot exceeds 64 MiB."));
    const operation = this.pending.then(async () => {
      await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 });
      const temporary = `${this.filename}.${randomUUID()}.tmp`;
      try {
        const file = await open(temporary, "wx", 0o600);
        try {
          await file.writeFile(text);
          await file.sync();
        } finally {
          await file.close();
        }
        await rename(temporary, this.filename);
        const directory = await open(dirname(this.filename), "r");
        try {
          await directory.sync();
        } finally {
          await directory.close();
        }
      } finally {
        await rm(temporary, { force: true });
      }
    });
    this.pending = operation.catch(() => {});
    return operation;
  }
}
