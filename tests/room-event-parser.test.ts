import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomEventParser } from "../host/room-stream.ts";

test("stream frames survive every network split and ignore heartbeats", () => {
  const wire =
    ': heartbeat\r\n\r\nevent: state\r\ndata: {"revision":1,"name":"Friend ✦"}\r\n\r\ndata: {"revision":2}\n\n';
  const bytes = new TextEncoder().encode(wire);
  for (let split = 0; split <= bytes.length; split++) {
    const decoder = new TextDecoder();
    const parser = new RoomEventParser();
    const result = [
      ...parser.push(decoder.decode(bytes.slice(0, split), { stream: true })),
      ...parser.push(decoder.decode(bytes.slice(split), { stream: true })),
    ];
    assert.deepEqual(result, [
      { revision: 1, name: "Friend ✦" },
      { revision: 2 },
    ]);
  }
});

test("invalid or unbounded stream data fails instead of accumulating", () => {
  assert.throws(() => new RoomEventParser().push("data: broken\n\n"));
  assert.throws(
    () => new RoomEventParser().push("a".repeat(4 * 1024 * 1024 + 1)),
    /too large/,
  );
});
