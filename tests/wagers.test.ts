import test from "node:test";
import assert from "node:assert/strict";
import { Rooms } from "../server/rooms.ts";
import { Wagers } from "../server/wagers.ts";
import type { Wager } from "../shared/wagers.ts";
test("RF mode fails closed without an enabled, verified escrow and referee", async () => {
  const wagers = new Wagers(new Rooms());
  assert.equal(wagers.config().enabled, false);
  assert.equal(wagers.config().entry, "1");
  assert.equal(wagers.config().pool, "2");
  assert.throws(
    () => wagers.challenge("0x1111111111111111111111111111111111111111", "1"),
    /unavailable/,
  );
  assert.throws(() => wagers.matchmake("forged", "1"), /Verify/);
  await assert.rejects(() => wagers.authenticate("fake", "0x12"), /Invalid/);
});
test("funded and practice queues never mix; paid games cannot start through ordinary commands", () => {
  const rooms = new Rooms();
  const practice = rooms.matchmake("1", 1000);
  const wager: Wager = {
    id: `0x${"1".repeat(64)}`,
    contract: `0x${"2".repeat(40)}`,
    status: "waiting",
    funded: [false, false],
    fundBy: 0,
    resolveBy: 0,
  };
  const a = rooms.matchmake("2", 1001, wager, `0x${"3".repeat(40)}`);
  const b = rooms.matchmake("3", 1002, wager, `0x${"4".repeat(40)}`);
  assert.notEqual(practice.code, a.code);
  assert.equal(a.code, b.code);
  assert.equal(b.state.phase, "ready");
  assert.equal(b.economy.entry, "1");
  assert.throws(
    () => rooms.command(a.code, a.token, { type: "start" }, 1003),
    /deposits/,
  );
  assert.throws(() => rooms.leave(a.code, a.token, 1003), /escrow/);
});
