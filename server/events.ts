import type { IncomingMessage, ServerResponse } from "node:http";
import type { Rooms } from "./rooms.ts";

const INTERVAL_MS = 250;
const HEARTBEAT_MS = 15_000;
const STALL_MS = 10_000;
const MAX_BUFFERED_BYTES = 2 * 1024 * 1024;
type Stream = {
  code: string;
  token: string;
  response: ServerResponse;
  revision: number;
  presence: string;
  lastWrite: number;
  blockedAt?: number;
  detach: () => void;
};

/** One authenticated, bounded response stream per seat. No room capabilities
 * appear in event bodies; Rooms.view remains the fog-of-war boundary.
 */
export class RoomStreams {
  private streams = new Map<string, Stream>();
  private timer?: ReturnType<typeof setInterval>;
  private closed = false;
  private rooms: Rooms;
  private now: () => number;

  constructor(rooms: Rooms, now: () => number = Date.now) {
    this.rooms = rooms;
    this.now = now;
  }

  open(
    request: IncomingMessage,
    response: ServerResponse,
    code: string,
    token: string,
    active: boolean,
  ) {
    if (this.closed)
      throw new Error("The server is restarting. Reconnect shortly.");
    // Authenticate before sending headers so the HTTP handler can return its
    // normal JSON error. Keep the bearer only in server-side connection state.
    const { player } = this.rooms.access(code, token, this.now());
    if (request.aborted || response.destroyed || response.writableEnded) return;
    player.active = active === true;
    const previous = this.streams.get(token);
    const stream: Stream = {
      code,
      token,
      response,
      revision: -1,
      presence: "",
      lastWrite: this.now(),
      detach: () => {},
    };
    const disconnected = () => this.finish(stream, true);
    request.once("aborted", disconnected);
    response.once("close", disconnected);
    response.once("error", disconnected);
    stream.detach = () => {
      request.off("aborted", disconnected);
      response.off("close", disconnected);
      response.off("error", disconnected);
    };
    // Publish the replacement before ending the old response. Its close event
    // must never mark the replacement's live seat inactive.
    this.streams.set(token, stream);
    if (previous) this.finish(previous, false);
    try {
      response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      response.setHeader("Cache-Control", "no-store, no-transform");
      response.setHeader("Connection", "keep-alive");
      response.setHeader("X-Accel-Buffering", "no");
      response.removeHeader("Content-Length");
      response.flushHeaders();
      this.update(stream);
    } catch {
      // Once streaming starts, transport failures must not fall through to an
      // HTTP handler that attempts to replace these headers with a JSON error.
      this.finish(stream, true);
    }
    if (this.streams.size && !this.timer) {
      this.timer = setInterval(() => {
        for (const current of this.streams.values()) this.update(current);
      }, INTERVAL_MS);
      this.timer.unref();
    }
  }

  private update(stream: Stream) {
    const response = stream.response;
    if (response.destroyed || response.writableEnded) {
      this.finish(stream, true);
      return;
    }
    try {
      const now = this.now();
      const { room } = this.rooms.access(stream.code, stream.token, now);
      // access() refreshes presence, but active is changed only by stream-open
      // or explicit visibility syncs. A heartbeat cannot undo a menu/tab change.
      if (response.writableLength > MAX_BUFFERED_BYTES) {
        this.finish(stream, true);
        return;
      }
      if (response.writableNeedDrain) {
        stream.blockedAt ??= now;
        if (now - stream.blockedAt >= STALL_MS) this.finish(stream, true);
        return;
      }
      stream.blockedAt = undefined;
      const presence = `${room.host}:${room.players
        .map(
          (p) => `${p.id}:${p.bot || (!p.departed && now - p.lastSeen < 8000)}`,
        )
        .join(",")}`;
      if (room.revision !== stream.revision || presence !== stream.presence) {
        const frame = `event: state\ndata: ${JSON.stringify(this.rooms.view(room, stream.token, now))}\n\n`;
        if (
          Buffer.byteLength(frame) + response.writableLength >
          MAX_BUFFERED_BYTES
        ) {
          this.finish(stream, true);
          return;
        }
        if (!response.write(frame)) stream.blockedAt = now;
        stream.revision = room.revision;
        stream.presence = presence;
        stream.lastWrite = now;
      } else if (now - stream.lastWrite >= HEARTBEAT_MS) {
        if (!response.write(": heartbeat\n\n")) stream.blockedAt = now;
        stream.lastWrite = now;
      }
    } catch {
      // Expired/departed seats and transport errors end this response. A new
      // connection must authenticate again through the ordinary HTTP handler.
      this.finish(stream, true);
    }
  }

  private finish(stream: Stream, destroy: boolean) {
    stream.detach();
    // The socket can fail while an old response is ending. It no longer owns
    // presence, but its late error must still have a listener.
    if (!stream.response.listenerCount("error"))
      stream.response.on("error", () => {});
    if (this.streams.get(stream.token) === stream) {
      this.streams.delete(stream.token);
      const player = this.rooms.rooms
        .get(stream.code)
        ?.players.find((p) => p.token === stream.token);
      if (player) player.active = false;
    }
    if (!this.streams.size && this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    if (destroy) stream.response.destroy();
    else if (!stream.response.writableEnded) stream.response.end();
  }

  /** Call before awaiting HTTP server.close(), which waits for open streams. */
  closeAll() {
    this.closed = true;
    for (const stream of this.streams.values()) this.finish(stream, true);
  }
}
