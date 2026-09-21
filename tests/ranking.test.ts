import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RankingStore } from "../server/ranking.ts";

const A = `0x${"ab".repeat(20)}`,
  B = `0x${"cd".repeat(20)}`,
  C = `0x${"ef".repeat(20)}`;
function fixture(t: { after(fn: () => void): void }) {
  const directory = mkdtempSync(join(tmpdir(), "farfield-ranking-"));
  const file = join(directory, "private", "rank.sqlite");
  const store = new RankingStore(file);
  t.after(() => {
    try {
      store.close();
    } catch {
      /* Restart tests close the first handle. */
    }
    rmSync(directory, { recursive: true, force: true });
  });
  return { store, file, directory };
}

test("new rankings are private, wallet-canonicalized placements with remembered Friend", (t) => {
  const { store } = fixture(t);
  const initial = store.profile(A, "0094425");
  assert.equal(initial.rating, 1500);
  assert.equal(initial.deviation, 350);
  assert.equal(initial.provisional, true);
  assert.equal(initial.division, "Unranked");
  assert.equal(initial.label, "Placement 0/5");
  assert.equal(initial.name, "Friend #94425");
  assert.deepEqual(store.profile(A.toUpperCase()), initial);
  assert.deepEqual(store.leaderboard(), { season: "Preseason", entries: [] });
  assert.doesNotMatch(JSON.stringify(initial), /0x[a-f0-9]{40}/i);
});

test("equal starting players receive symmetric Glicko win/loss updates from the same baseline", (t) => {
  const { store } = fixture(t);
  const result = store.record("equal-win", A, B, A);
  assert.equal(result.a.after.rating, 1662);
  assert.equal(result.b.after.rating, 1338);
  assert.equal(result.a.after.deviation, 290);
  assert.equal(result.b.after.deviation, 290);
  assert.equal(result.a.delta, -result.b.delta);
  assert.equal(result.a.outcome, "win");
  assert.equal(result.b.outcome, "loss");
  assert.equal(result.a.after.wins, 1);
  assert.equal(result.b.after.losses, 1);
  assert.equal(result.a.before.rating, 1500);
  assert.equal(result.b.before.rating, 1500);
});

test("draws count explicitly and reduce uncertainty without changing equal ratings", (t) => {
  const { store } = fixture(t);
  const result = store.record("draw", A, B, null);
  for (const row of [result.a, result.b]) {
    assert.equal(row.outcome, "draw");
    assert.equal(row.delta, 0);
    assert.equal(row.after.rating, 1500);
    assert.equal(row.after.deviation, 290);
    assert.equal(row.after.matches, 1);
    assert.equal(row.after.draws, 1);
    assert.equal(row.after.wins + row.after.losses, 0);
  }
});

test("an upset moves ratings more than an expected result at identical starting uncertainty", (t) => {
  const { store, file } = fixture(t);
  store.profile(A);
  store.profile(B);
  store.profile(C);
  const D = `0x${"12".repeat(20)}`;
  store.profile(D);
  const db = new DatabaseSync(file);
  db.prepare(
    "UPDATE ranked_profiles SET rating=1800, deviation=100 WHERE wallet IN (?,?)",
  ).run(A, C);
  db.prepare(
    "UPDATE ranked_profiles SET rating=1200, deviation=100 WHERE wallet IN (?,?)",
  ).run(B, D);
  db.close();
  const expected = store.record("favorite", A, B, A);
  const upset = store.record("upset", C, D, D);
  assert.ok(upset.b.delta > expected.a.delta * 10);
  assert.ok(upset.a.delta < 0);
  assert.ok(upset.b.delta > 0);
  assert.equal(upset.b.delta, -upset.a.delta);
});

test("five placements unlock divisions and a sorted address-free leaderboard", (t) => {
  const { store } = fixture(t);
  store.profile(A, "94425");
  store.profile(B, "68000");
  store.profile(C, "68123");
  for (let i = 0; i < 4; i++) store.record(`placement-${i}`, A, B, A);
  assert.equal(store.profile(A).label, "Placement 4/5");
  assert.equal(store.leaderboard().entries.length, 0);
  const result = store.record("placement-4", A, B, A);
  assert.equal(result.a.before.provisional, true);
  assert.equal(result.a.after.provisional, false);
  assert.deepEqual(result.a.placements, { completed: 5, required: 5 });
  assert.equal(result.a.division, "Platinum");
  assert.equal(result.b.division, "Silver");
  const board = store.leaderboard();
  assert.equal(board.entries.length, 2);
  assert.equal(board.entries[0].name, "Friend #94425");
  assert.equal(board.entries[0].position, 1);
  assert.equal(board.entries[1].position, 2);
  assert.doesNotMatch(JSON.stringify({ board, result }), /0x[a-f0-9]{40}/i);
  assert.equal(store.leaderboard(1).entries.length, 1);
});

test("settlement is idempotent across seat order, and conflicting replay cannot change ratings", (t) => {
  const { store } = fixture(t);
  const first = store.record("once", A, B, A);
  assert.deepEqual(store.record("once", A, B, A), first);
  assert.deepEqual(store.record("once", B, A, A), { a: first.b, b: first.a });
  assert.throws(() => store.record("once", A, B, B), /different result/);
  assert.throws(() => store.record("once", A, B, null), /different result/);
  assert.throws(() => store.record("once", A, C, A), /different result/);
  assert.equal(store.profile(A).matches, 1);
  assert.equal(store.profile(B).matches, 1);
  assert.deepEqual(store.getResult("once", A), first.a);
  assert.equal(store.getResult("once", C), null);
  assert.equal(store.getResult("missing", A), null);
});

test("database restart retains rating precision, Friend identity, and settlement ledger with mode 0600", (t) => {
  const { store, file } = fixture(t);
  store.profile(A, "94425");
  const first = store.record("durable", A, B, A);
  assert.equal(statSync(file).mode & 0o777, 0o600);
  store.close();
  const restarted = new RankingStore(file);
  try {
    assert.deepEqual(restarted.profile(A), first.a.after);
    assert.deepEqual(restarted.getResult("durable", B), first.b);
    assert.deepEqual(restarted.record("durable", A, B, A), first);
    assert.equal(restarted.profile(A).matches, 1);
    assert.equal(statSync(file).mode & 0o777, 0o600);
  } finally {
    restarted.close();
  }
});

test("failure writing the second result rolls back both profiles and all match records", (t) => {
  const { store, file } = fixture(t);
  store.profile(A);
  store.profile(B);
  const db = new DatabaseSync(file);
  db.exec(
    `CREATE TRIGGER reject_second_result BEFORE INSERT ON ranked_results WHEN NEW.wallet='${B}' BEGIN SELECT RAISE(ABORT,'simulated disk write failure'); END;`,
  );
  assert.throws(
    () => store.record("atomic", A, B, A),
    /simulated disk write failure/,
  );
  assert.equal(store.profile(A).matches, 0);
  assert.equal(store.profile(B).matches, 0);
  assert.equal(store.getResult("atomic", A), null);
  assert.equal(
    db.prepare("SELECT count(*) AS n FROM ranked_matches").get()!.n,
    0,
  );
  db.exec("DROP TRIGGER reject_second_result");
  db.close();
  assert.equal(store.record("atomic", A, B, A).a.after.matches, 1);
});

test("uncertainty has a floor and long play counts remain consistent", (t) => {
  const { store } = fixture(t);
  for (let i = 0; i < 250; i++) store.record(`long-${i}`, A, B, null);
  assert.equal(store.profile(A).deviation, 50);
  assert.equal(store.profile(B).deviation, 50);
  assert.equal(store.profile(A).draws, 250);
  assert.equal(store.profile(A).matches, 250);
  assert.equal(store.profile(A).division, "Gold");
});

test("invalid identities and public or symlinked-public database paths are rejected", (t) => {
  const { store, directory } = fixture(t);
  assert.throws(() => store.profile("bad"), /wallet/);
  assert.throws(() => store.profile(A, "<script>"), /Friend/);
  assert.throws(() => store.record("valid", A, A, A), /participants/);
  assert.throws(() => store.record("valid", A, B, C), /participants/);
  assert.throws(() => store.record("../bad", A, B, A), /match ID/);
  assert.throws(() => store.leaderboard(101), /limit/);
  assert.throws(() => store.leaderboard(1.5), /limit/);
  assert.throws(() => new RankingStore("relative.sqlite"), /absolute/);
  const publicRoot = join(directory, "public");
  mkdirSync(publicRoot);
  assert.throws(
    () =>
      new RankingStore(join(publicRoot, "private", "rank.sqlite"), {
        webRoot: publicRoot,
      }),
    /outside/,
  );
  const alias = join(directory, "alias");
  symlinkSync(publicRoot, alias, "dir");
  assert.throws(
    () => new RankingStore(join(alias, "rank.sqlite"), { webRoot: publicRoot }),
    /outside/,
  );
});

test("completed placements use the published five division boundaries", (t) => {
  const { store, file } = fixture(t);
  for (let i = 0; i < 5; i++) store.record(`boundary-${i}`, A, B, null);
  const db = new DatabaseSync(file);
  try {
    for (const [rating, division] of [
      [1199, "Bronze"],
      [1200, "Silver"],
      [1399, "Silver"],
      [1400, "Gold"],
      [1599, "Gold"],
      [1600, "Platinum"],
      [1799, "Platinum"],
      [1800, "Diamond"],
    ] as const) {
      db.prepare("UPDATE ranked_profiles SET rating=? WHERE wallet=?").run(
        rating,
        A,
      );
      assert.equal(store.profile(A).division, division);
      assert.equal(store.profile(A).label, division);
    }
  } finally {
    db.close();
  }
});
