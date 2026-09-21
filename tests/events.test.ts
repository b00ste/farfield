import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import test from "node:test";
import { RoomStreams } from "../server/events.ts";
import { Rooms } from "../server/rooms.ts";

class Response extends EventEmitter {
  headers = new Map<string, string>();
  chunks: string[] = [];
  headersSent = false;
  destroyed = false;
  writableEnded = false;
  writableLength = 0;
  writableNeedDrain = false;
  setHeader(key: string, value: string) {
    this.headers.set(key, value);
  }
  removeHeader(key: string) {
    this.headers.delete(key);
  }
  flushHeaders() {
    this.headersSent = true;
  }
  write(chunk: string) {
    this.chunks.push(chunk);
    return !this.writableNeedDrain;
  }
  end() {
    this.writableEnded = true;
    this.emit("close");
  }
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.emit("close");
  }
}
const delay = () => new Promise((resolve) => setTimeout(resolve, 300));
function fixture(t: { after: (fn: () => void) => void }) {
  let time = 1000;
  const rooms = new Rooms();
  const a = rooms.create("1", time, "normal", "solo");
  const streams = new RoomStreams(rooms, () => time);
  t.after(() => streams.closeAll());
  const open = (token = a.token, active = true) => {
    const request = new EventEmitter() as IncomingMessage;
    const response = new Response();
    streams.open(
      request,
      response as unknown as ServerResponse,
      a.code,
      token,
      active,
    );
    return { request, response };
  };
  return {
    rooms,
    a,
    streams,
    open,
    setTime: (now: number) => {
      time = now;
    },
  };
}

test("streams authenticate before headers and send only authorized views on revision changes", async (t) => {
  const { rooms, a, streams, open } = fixture(t);
  const denied = new Response();
  assert.throws(
    () =>
      streams.open(
        new EventEmitter() as IncomingMessage,
        denied as unknown as ServerResponse,
        a.code,
        "bad",
        true,
      ),
    /expired/,
  );
  assert.equal(denied.headersSent, false);
  const { request, response } = open();
  assert.match(response.headers.get("Content-Type")!, /^text\/event-stream/);
  assert.equal(response.chunks.length, 1);
  assert.ok(!response.chunks[0].includes(a.token));
  assert.match(response.chunks[0], /^event: state\ndata: /);
  const view = JSON.parse(response.chunks[0].split("data: ")[1]);
  assert.equal(view.selfId, a.selfId);
  assert.equal(view.opponents[0].state, null);
  request.emit("close"); // End of a POST request is not the end of its response.
  await delay();
  assert.equal(response.destroyed, false);
  assert.equal(response.chunks.length, 1);
  rooms.command(a.code, a.token, { type: "start" }, 1000);
  await delay();
  assert.equal(response.chunks.length, 2);
  assert.equal(
    JSON.parse(response.chunks[1].split("data: ")[1]).state.phase,
    "playing",
  );
});

test("stream heartbeats renew presence without overriding visibility changes", async (t) => {
  const { rooms, a, open, setTime } = fixture(t);
  const { response } = open();
  const { player } = rooms.access(a.code, a.token, 1000);
  player.active = false;
  setTime(17_000);
  await delay();
  assert.equal(player.lastSeen, 17_000);
  assert.equal(player.active, false);
  assert.equal(response.chunks.at(-1), ": heartbeat\n\n");
});

test("replacing a seat stream cannot deactivate its replacement; disconnect can", (t) => {
  const { rooms, a, open } = fixture(t);
  const first = open();
  const second = open();
  assert.equal(first.response.writableEnded, true);
  first.response.emit("close");
  first.response.emit("error", new Error("Old socket disconnected"));
  assert.equal(rooms.rooms.get(a.code)!.players[0].active, true);
  assert.equal(second.response.destroyed, false);
  second.response.destroy();
  assert.equal(rooms.rooms.get(a.code)!.players[0].active, false);
});

test("slow streams skip snapshots and close after bounded backpressure", async (t) => {
  const { rooms, a, open, setTime } = fixture(t);
  const { response } = open();
  response.writableNeedDrain = true;
  rooms.command(a.code, a.token, { type: "start" }, 1000);
  await delay();
  assert.equal(response.chunks.length, 1);
  setTime(11_001);
  await delay();
  assert.equal(response.destroyed, true);
  assert.equal(response.chunks.length, 1);
  assert.equal(rooms.rooms.get(a.code)!.players[0].active, false);
});

test("oversized queued output and departed seats close their streams", async (t) => {
  const one = fixture(t);
  const first = one.open();
  first.response.writableLength = 2 * 1024 * 1024 + 1;
  await delay();
  assert.equal(first.response.destroyed, true);
  const two = fixture(t);
  const second = two.open();
  two.rooms.leave(two.a.code, two.a.token, 1000);
  await delay();
  assert.equal(second.response.destroyed, true);
});

test("shutdown closes active streams and prevents reopening", (t) => {
  const { streams, rooms, a, open } = fixture(t);
  const { response } = open();
  streams.closeAll();
  assert.equal(response.destroyed, true);
  assert.equal(rooms.rooms.get(a.code)!.players[0].active, false);
  assert.throws(() => open(), /restarting/);
});
