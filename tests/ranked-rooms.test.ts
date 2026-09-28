import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RankingStore } from "../server/ranking.ts";
import { Rooms } from "../server/rooms.ts";

const A = `0x${"ab".repeat(20)}`,
  B = `0x${"cd".repeat(20)}`;
const START = 100_000;
function fixture(t: { after(fn: () => void): void }) {
  const directory = mkdtempSync(join(tmpdir(), "farfield-ranked-rooms-"));
  const file = join(directory, "rank.sqlite");
  const rankings = new RankingStore(file);
  const rooms = new Rooms(rankings);
  t.after(() => {
    rankings.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { rankings, rooms, file };
}
function paired(rooms: Rooms) {
  const a = rooms.matchmake("94425", START, A);
  const b = rooms.matchmake("68000", START, B);
  const room = rooms.access(a.code, a.token, START).room;
  assert.equal(room.players.length, 2);
  assert.equal(b.code, a.code);
  assert.ok(room.players.every((p) => p.state.phase === "playing"));
  return { a, b, room };
}

test("ranked matchmaking requires an authenticated wallet and deduplicates the same account", (t) => {
  const { rooms, rankings } = fixture(t);
  assert.throws(() => rooms.matchmake("94425", START), /Verify your wallet/);
  assert.equal(rooms.rooms.size, 0);
  const first = rooms.matchmake("94425", START, A);
  const again = rooms.matchmake("94425", START + 1, A.toUpperCase());
  assert.equal(again.code, first.code);
  assert.equal(again.token, first.token);
  assert.equal(rooms.rooms.size, 1);
  assert.throws(
    () => rooms.matchmake("68000", START + 2, A),
    /existing ranked match/,
  );
  assert.equal(rankings.profile(A).friendId, "94425");
  assert.equal(rankings.profile(A).matches, 0);
});

test("different Friend cannot reset an active ranked match, including during reconnect grace", (t) => {
  const { rooms, rankings } = fixture(t);
  const { a, room } = paired(rooms);
  assert.throws(
    () => rooms.matchmake("68123", START + 30_000, A),
    /existing ranked match/,
  );
  const reconnected = rooms.matchmake("94425", START + 30_000, A);
  assert.equal(reconnected.token, a.token);
  assert.equal(reconnected.code, room.code);
  assert.equal(reconnected.state.phase, "playing");
  assert.equal(rankings.profile(A).matches, 0);
  assert.equal(rooms.rooms.size, 1);
});

test("ranked views omit all wallet addresses and seat secrets", (t) => {
  const { rooms } = fixture(t);
  const { a, b, room } = paired(rooms);
  const view = rooms.view(room, a.token, START);
  assert.equal(view.ranked?.profile.name, "Friend #94425");
  assert.equal(view.ranked?.opponent?.name, "Friend #68000");
  const serialized = JSON.stringify(view);
  assert.doesNotMatch(serialized, /0x[a-f0-9]{40}/i);
  assert.ok(!serialized.includes(a.token));
  assert.ok(!serialized.includes(b.token));
});

test("rating range widens automatically and original queue capability follows the paired seat", (t) => {
  const { rooms, rankings, file } = fixture(t);
  rankings.profile(A);
  rankings.profile(B);
  const db = new DatabaseSync(file);
  db.prepare("UPDATE ranked_profiles SET rating=1750 WHERE wallet=?").run(B);
  db.close();
  const a = rooms.matchmake("94425", START, A);
  const b = rooms.matchmake("68000", START + 1, B);
  assert.notEqual(a.code, b.code);
  assert.equal(rooms.rooms.size, 2);
  for (let elapsed = 5000; elapsed <= 15000; elapsed += 5000) {
    rooms.access(a.code, a.token, START + elapsed);
    rooms.access(b.code, b.token, START + elapsed);
    rooms.advance(0.05, START + elapsed);
    assert.equal(rooms.rooms.size, 2);
  }
  rooms.access(a.code, a.token, START + 20000);
  rooms.access(b.code, b.token, START + 20000);
  rooms.advance(0.05, START + 20000);
  assert.equal(rooms.rooms.size, 1);
  const joined = rooms.access(b.code, b.token, START + 20001);
  assert.equal(joined.room.code, a.code);
  assert.equal(joined.player.friendId, "68000");
  assert.equal(joined.player.queueCode, b.code);
  assert.equal(joined.player.state.phase, "playing");
  assert.throws(() => rooms.access(b.code, a.token, START + 20001), /expired/);
  const forfeited = rooms.command(
    b.code,
    b.token,
    { type: "forfeit" },
    START + 20002,
  );
  assert.equal(forfeited.ranked?.result?.outcome, "loss");
  assert.equal(rankings.profile(A).matches, 1);
});

test("forfeit settles both profiles exactly once and changing Friend preserves skill history", (t) => {
  const { rooms, rankings } = fixture(t);
  const { a, b, room } = paired(rooms);
  const result = rooms.command(
    a.code,
    a.token,
    { type: "forfeit" },
    START + 10,
  );
  assert.equal(result.winnerId, b.selfId);
  assert.equal(result.ranked?.result?.outcome, "loss");
  assert.equal(
    rooms.view(room, b.token, START + 10).ranked?.result?.outcome,
    "win",
  );
  for (let i = 0; i < 5; i++) rooms.advance(0.1, START + 20 + i);
  assert.equal(rankings.profile(A).matches, 1);
  assert.equal(rankings.profile(B).matches, 1);
  assert.throws(
    () => rooms.command(a.code, a.token, { type: "forfeit" }, START + 30),
    /No active/,
  );
  const changed = rooms.matchmake("68123", START + 40, A);
  assert.equal(changed.ranked?.profile.matches, 1);
  assert.equal(changed.ranked?.profile.rating, result.ranked?.profile.rating);
  assert.equal(changed.ranked?.profile.name, "Friend #68123");
});

test("disconnect grace allows reconnect through 60 seconds and settles only after its deadline", (t) => {
  const { rooms, rankings } = fixture(t);
  const { a, b, room } = paired(rooms);
  for (const p of room.players) p.active = false;
  rooms.access(b.code, b.token, START + 60000);
  rooms.advance(0.1, START + 60000);
  assert.equal(room.winnerId, null);
  assert.equal(rankings.profile(A).matches, 0);
  const reconnect = rooms.access(a.code, a.token, START + 60000);
  assert.equal(reconnect.player.state.phase, "playing");
  rooms.access(b.code, b.token, START + 120000);
  rooms.advance(0.1, START + 120000);
  assert.equal(room.winnerId, null);
  rooms.advance(0.1, START + 120001);
  assert.equal(room.winnerId, b.selfId);
  assert.equal(
    rooms.view(room, a.token, START + 120001).ranked?.result?.outcome,
    "loss",
  );
  assert.equal(rankings.profile(A).matches, 1);
  rooms.advance(0.1, START + 180002);
  assert.equal(rankings.profile(A).matches, 1);
  assert.equal(rankings.profile(B).wins, 1);
});

test("both disconnected seats become a rated draw exactly once, rather than an arbitrary winner", (t) => {
  const { rooms, rankings } = fixture(t);
  const { a, b, room } = paired(rooms);
  for (const p of room.players) p.active = false;
  rooms.advance(0.1, START + 60001);
  assert.equal(room.draw, true);
  assert.equal(room.winnerId, null);
  assert.equal(
    rooms.view(room, a.token, START + 60001).ranked?.result?.outcome,
    "draw",
  );
  assert.equal(
    rooms.view(room, b.token, START + 60001).ranked?.result?.outcome,
    "draw",
  );
  rooms.advance(0.1, START + 60002);
  assert.equal(rankings.profile(A).draws, 1);
  assert.equal(rankings.profile(B).draws, 1);
});

test("custom matches remain unranked even when a ranking store is enabled", (t) => {
  const { rooms, rankings } = fixture(t);
  const a = rooms.create("94425", START, "normal", "custom", ["easy"]);
  rooms.command(a.code, a.token, { type: "start" }, START);
  const result = rooms.command(a.code, a.token, { type: "forfeit" }, START + 1);
  assert.equal(result.ranked, undefined);
  assert.ok(result.winnerId);
  assert.equal(rankings.profile(A).matches, 0);
  assert.equal(rankings.leaderboard().entries.length, 0);
});

test("restart voids an interrupted ranked game without counting a draw", (t) => {
  const { rooms, rankings } = fixture(t);
  const { a, room } = paired(rooms);
  const restored = new Rooms(rankings);
  restored.rooms = new Map([[room.code, structuredClone(room)]]);
  restored.restoreRanked();
  const view = restored.view(
    restored.rooms.get(room.code)!,
    a.token,
    START + 1000,
  );
  assert.match(view.ranked!.cancelled!, /Server restarted/);
  assert.equal(view.ranked?.result, null);
  assert.equal(view.draw, true);
  assert.equal(rankings.profile(A).matches, 0);
  assert.equal(rankings.profile(B).matches, 0);
  restored.advance(0.1, START + 1001);
  assert.equal(rankings.profile(A).matches, 0);
});

test("a committed result wins over a stale playing snapshot and restores its actual winner", (t) => {
  const { rooms, rankings } = fixture(t);
  const { a, b, room } = paired(rooms);
  const stale = structuredClone(room);
  rooms.command(a.code, a.token, { type: "forfeit" }, START + 1);
  const restored = new Rooms(rankings);
  restored.rooms = new Map([[stale.code, stale]]);
  restored.restoreRanked();
  assert.equal(stale.winnerId, b.selfId);
  assert.equal(stale.draw, false);
  assert.equal(
    stale.players.find((p) => p.id === b.selfId)?.state.phase,
    "won",
  );
  assert.equal(
    stale.players.find((p) => p.id === a.selfId)?.state.phase,
    "lost",
  );
  assert.equal(stale.ranked?.settled, true);
  assert.equal(
    restored.view(stale, a.token, START + 2).ranked?.result?.outcome,
    "loss",
  );
  restored.advance(0.1, START + 3);
  assert.equal(rankings.profile(A).matches, 1);
  assert.equal(rankings.profile(B).matches, 1);
});

test("server stalls exceeding five seconds void a ranked match without rating movement", (t) => {
  const { rooms, rankings } = fixture(t);
  const { a, room } = paired(rooms);
  rooms.advance(5, START + 5000);
  assert.equal(room.draw, undefined);
  assert.equal(room.players[0].state.phase, "playing");
  rooms.advance(5.001, START + 10001);
  assert.equal(room.draw, true);
  assert.equal(room.winnerId, null);
  const view = rooms.view(room, a.token, START + 10001);
  assert.match(view.ranked!.cancelled!, /interruption/);
  assert.equal(view.ranked?.result, null);
  assert.equal(rankings.profile(A).matches, 0);
  assert.equal(rankings.profile(B).matches, 0);
});

test("leaving through an original queue alias deletes the canonical room after both seats depart", (t) => {
  const { rooms } = fixture(t);
  const { a, b, room } = paired(rooms);
  const alias = room.players.find((p) => p.token === b.token)!.queueCode!;
  assert.notEqual(alias, room.code);
  rooms.leave(a.code, a.token, START + 1);
  rooms.leave(alias, b.token, START + 2);
  assert.equal(rooms.rooms.size, 0);
});
