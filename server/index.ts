import { RoomStore } from "./room-store.ts";
import { RoomStreams } from "./events.ts";
import { allowedOrigins, corsOrigin } from "./cors.ts";
import { RequestLimits } from "./rate-limit.ts";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { Rooms } from "./rooms.ts";
import { Wagers } from "./wagers.ts";
import { forwardFriendRpc } from "./friend-rpc.ts";
import type { Command } from "../games/farfield/engine.ts";
const rooms = new Rooms(),
  root = resolve(process.env.GAME_ROOT || "games/farfield/.friendsdk");
const origins = allowedOrigins(process.env.FARFIELD_ALLOWED_ORIGINS);
const store = process.env.FARFIELD_STATE_PATH
  ? new RoomStore(resolve(process.env.FARFIELD_STATE_PATH), { webRoot: root })
  : null;
if (store) {
  rooms.rooms = await store.load();
  // Fail startup if the configured durable path is not writable.
  await store.save(rooms.rooms);
}
let checkpointError = false;
let checkpointPending: Promise<void> | null = null;
const checkpoint = () => {
  if (!store || checkpointPending)
    return checkpointPending ?? Promise.resolve();
  checkpointPending = store
    .save(rooms.rooms)
    .then(() => {
      checkpointError = false;
    })
    .catch(() => {
      checkpointError = true;
      console.error("Match checkpoint failed; check persistent storage.");
    })
    .finally(() => {
      checkpointPending = null;
    });
  return checkpointPending;
};
const checkpointTimer = store
  ? setInterval(() => {
      void checkpoint();
    }, 5000)
  : null;
const wagers = new Wagers(rooms);
const streams = new RoomStreams(rooms);
void wagers.initialize();
const wagerTimer = setInterval(() => {
  void wagers.pump();
}, 2000);
const limits = new RequestLimits((token) =>
  [...rooms.rooms.values()].some((room) =>
    room.players.some((player) => !player.bot && player.token === token),
  ),
);
const mime: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json",
};
const server = createServer(async (req, res) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname.startsWith("/api/")) {
    // The SDK iframe has an opaque origin. Bearer capabilities, never cookies, authorize room actions.
    const origin = corsOrigin(req.headers.origin, origins);
    res.setHeader("Vary", "Origin");
    if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
    if (req.headers.origin && !origin) {
      res
        .writeHead(403)
        .end(JSON.stringify({ error: "Origin is not allowed." }));
      return;
    }
    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }
    if (req.method !== "POST") {
      res.writeHead(405).end(JSON.stringify({ error: "Use POST." }));
      return;
    }
    try {
      const now = Date.now(),
        ip = req.socket.remoteAddress || "unknown";
      const bearer = (req.headers.authorization || "").replace(/^Bearer /, "");
      if (!limits.allow(ip, bearer, now)) {
        res
          .writeHead(429)
          .end(JSON.stringify({ error: "Too many requests. Wait a moment." }));
        return;
      }
      let raw = "";
      for await (const chunk of req) {
        raw += chunk;
        if (raw.length > (url.pathname === "/api/friend-rpc" ? 32768 : 2048))
          throw new Error("Request too large.");
      }
      const body = JSON.parse(raw || "{}");
      if (!body || typeof body !== "object")
        throw new Error("Invalid request.");
      if (url.pathname === "/api/wager/config") {
        res.end(JSON.stringify(wagers.config()));
        return;
      }
      if (url.pathname === "/api/wager/challenge") {
        res.end(JSON.stringify(wagers.challenge(body.address, body.friendId)));
        return;
      }
      if (url.pathname === "/api/wager/auth") {
        res.end(
          JSON.stringify(await wagers.authenticate(body.nonce, body.signature)),
        );
        return;
      }
      if (url.pathname === "/api/wager/status") {
        res.end(
          JSON.stringify(await wagers.status(body.id, body.address, body.hash)),
        );
        return;
      }
      if (url.pathname === "/api/friend-rpc") {
        res.end(JSON.stringify(await forwardFriendRpc(body)));
        return;
      }
      if (
        url.pathname === "/api/create" ||
        url.pathname === "/api/join" ||
        url.pathname === "/api/matchmake"
      ) {
        if (
          typeof body.friendId !== "string" ||
          !/^\d{1,78}$/.test(body.friendId) ||
          BigInt(body.friendId) < 1n
        )
          throw new Error("Invalid Friend.");
        if (url.pathname === "/api/matchmake") {
          res.end(
            JSON.stringify(
              body.wager
                ? wagers.matchmake(body.auth, body.friendId)
                : rooms.matchmake(body.friendId),
            ),
          );
          return;
        }
        if (url.pathname === "/api/create") {
          if (!["easy", "normal", "hard"].includes(body.difficulty ?? "normal"))
            throw new Error("Choose Easy, Normal, or Hard.");
          if (!["solo", "pvp", "custom"].includes(body.mode ?? "solo"))
            throw new Error("Choose Solo or Multiplayer.");
          if (
            body.bots !== undefined &&
            (!Array.isArray(body.bots) || body.bots.length > 3)
          )
            throw new Error("Choose up to three AI commanders.");
          res.end(
            JSON.stringify(
              rooms.create(
                body.friendId,
                Date.now(),
                body.difficulty ?? "normal",
                body.mode ?? "solo",
                body.bots ?? [],
              ),
            ),
          );
        } else {
          if (
            typeof body.code !== "string" ||
            !/^[A-F0-9]{10}$/.test(body.code)
          )
            throw new Error("Enter a 10-character station code.");
          res.end(JSON.stringify(rooms.join(body.code, body.friendId)));
        }
        return;
      }
      if (typeof body.code !== "string")
        throw new Error("Missing station code.");
      const token = (req.headers.authorization || "").replace(/^Bearer /, "");
      if (url.pathname === "/api/events") {
        streams.open(req, res, body.code, token, body.active === true);
      } else if (url.pathname === "/api/leave") {
        res.end(JSON.stringify(rooms.leave(body.code, token)));
      } else if (url.pathname === "/api/sync") {
        const { room, player } = rooms.access(body.code, token);
        player.active = body.active === true;
        res.end(JSON.stringify(rooms.view(room, token)));
      } else if (url.pathname === "/api/command") {
        if (!body.command || typeof body.command !== "object")
          throw new Error("Missing command.");
        res.end(
          JSON.stringify(
            rooms.command(body.code, token, body.command as Command),
          ),
        );
      } else
        res.writeHead(404).end(JSON.stringify({ error: "Unknown endpoint." }));
    } catch (error) {
      res.writeHead(400).end(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Request failed.",
        }),
      );
    }
    return;
  }
  if (url.pathname === "/health") {
    res.setHeader("Content-Type", "application/json");
    res.statusCode = checkpointError ? 503 : 200;
    res.end(
      JSON.stringify({
        status: checkpointError ? "storage-unavailable" : "ok",
        rooms: rooms.rooms.size,
      }),
    );
    return;
  }
  if (!["GET", "HEAD"].includes(req.method || "")) {
    res.writeHead(405).end();
    return;
  }
  try {
    const path = resolve(
      root,
      "." +
        decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname),
    );
    if (!path.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    const data = await readFile(path);
    res.setHeader(
      "Content-Type",
      mime[extname(path)] || "application/octet-stream",
    );
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    res.end(req.method === "HEAD" ? undefined : data);
  } catch {
    res.writeHead(404).end("Not found");
  }
});
let previous = Date.now();
const interval = setInterval(() => {
  const now = Date.now();
  rooms.advance((now - previous) / 1000, now);
  previous = now;
  limits.prune(now);
}, 100);
const port = Number(process.env.PORT || 4173);
server.listen(port, "0.0.0.0", () =>
  console.log(`Farfield arena listening on http://0.0.0.0:${port}`),
);
let stopping = false;
const shutdown = async () => {
  if (stopping) return;
  stopping = true;
  clearInterval(interval);
  clearInterval(wagerTimer);
  if (checkpointTimer) clearInterval(checkpointTimer);
  streams.closeAll();
  const deadline = setTimeout(() => process.exit(1), 25000);
  deadline.unref();
  try {
    // Finish accepted requests before committing the final authoritative state.
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await checkpointPending;
    if (store) await store.save(rooms.rooms);
    clearTimeout(deadline);
    process.exit(0);
  } catch {
    console.error("Could not save matches during shutdown.");
    process.exit(1);
  }
};
process.on("SIGTERM", () => {
  void shutdown();
});
process.on("SIGINT", () => {
  void shutdown();
});
