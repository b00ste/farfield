import { DatabaseSync } from "node:sqlite";
import {
  constants,
  closeSync,
  fchmodSync,
  mkdirSync,
  openSync,
  realpathSync,
} from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

export const RANK_SEASON = "Preseason" as const;
export type RankDivision =
  | "Unranked"
  | "Bronze"
  | "Silver"
  | "Gold"
  | "Platinum"
  | "Diamond";
export type RankProfile = {
  season: typeof RANK_SEASON;
  rating: number;
  deviation: number;
  provisional: boolean;
  division: RankDivision;
  label: string;
  placements: { completed: number; required: 5 };
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  friendId: string | null;
  name: string;
};
export type RankResult = {
  matchId: string;
  outcome: "win" | "loss" | "draw";
  before: RankProfile;
  after: RankProfile;
  delta: number;
  division: RankDivision;
  placements: RankProfile["placements"];
};
type ProfileRow = {
  wallet: string;
  rating: number;
  deviation: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  last_friend_id: string | null;
};
function walletKey(wallet: string): string {
  if (typeof wallet !== "string" || !/^0x[0-9a-f]{40}$/i.test(wallet))
    throw new Error("Invalid ranking wallet.");
  return wallet.toLowerCase();
}
function matchKey(matchId: string): string {
  if (typeof matchId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(matchId))
    throw new Error("Invalid ranked match ID.");
  return matchId;
}
function friendKey(friendId: string): string {
  if (
    typeof friendId !== "string" ||
    !/^[0-9]{1,78}$/.test(friendId) ||
    BigInt(friendId) <= 0n
  )
    throw new Error("Invalid ranked Friend ID.");
  return BigInt(friendId).toString();
}
// Resolve symlinked ancestors even when the leaf does not yet exist.
function canonicalPath(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return resolve(canonicalPath(dirname(path)), basename(path));
  }
}
function publicProfile(row: ProfileRow): RankProfile {
  const rating = Math.round(row.rating),
    provisional = row.matches < 5;
  // Division thresholds use the displayed rating, avoiding a 1600/Gold mismatch.
  const division: RankDivision = provisional
    ? "Unranked"
    : rating < 1200
      ? "Bronze"
      : rating < 1400
        ? "Silver"
        : rating < 1600
          ? "Gold"
          : rating < 1800
            ? "Platinum"
            : "Diamond";
  const placements = {
    completed: Math.min(row.matches, 5),
    required: 5 as const,
  };
  return {
    season: RANK_SEASON,
    rating,
    deviation: Math.round(row.deviation),
    provisional,
    division,
    label: provisional ? `Placement ${placements.completed}/5` : division,
    placements,
    matches: row.matches,
    wins: row.wins,
    losses: row.losses,
    draws: row.draws,
    friendId: row.last_friend_id,
    name: row.last_friend_id
      ? `Friend #${row.last_friend_id}`
      : "Unranked commander",
  };
}
/** Glicko-1, https://www.glicko.net/glicko/glicko.pdf (steps 2–3).
 * One match is one rating period; both updates use the pre-match values.
 * Preseason uses c=0 (no inactivity inflation) and an RD floor of 50.
 * Full precision is persisted; only the public display is rounded.
 */
function update(
  row: ProfileRow,
  opponent: ProfileRow,
  score: number,
): ProfileRow {
  const q = Math.log(10) / 400;
  const g =
    1 / Math.sqrt(1 + (3 * q * q * opponent.deviation ** 2) / Math.PI ** 2);
  const expected =
    1 / (1 + 10 ** ((-g * (row.rating - opponent.rating)) / 400));
  const precision =
    1 / row.deviation ** 2 + q * q * g * g * expected * (1 - expected);
  return {
    ...row,
    rating: row.rating + (q / precision) * g * (score - expected),
    deviation: Math.max(50, Math.sqrt(1 / precision)),
    matches: row.matches + 1,
    wins: row.wins + (score === 1 ? 1 : 0),
    losses: row.losses + (score === 0 ? 1 : 0),
    draws: row.draws + (score === 0.5 ? 1 : 0),
  };
}

/** Private, single-process SQLite ledger. Call record only for server-authorized
 * completed matches. Cancelled matches must never be recorded as draws.
 */
export class RankingStore {
  private readonly db: DatabaseSync;
  constructor(filename: string, options: { webRoot?: string } = {}) {
    if (!isAbsolute(filename))
      throw new Error("Ranking path must be absolute.");
    const file = canonicalPath(resolve(filename));
    const root = canonicalPath(
      resolve(
        options.webRoot ?? process.env.GAME_ROOT ?? "games/farfield/.friendsdk",
      ),
    );
    const fromRoot = relative(root, file);
    if (
      !fromRoot ||
      (fromRoot !== ".." &&
        !fromRoot.startsWith(`..${sep}`) &&
        !isAbsolute(fromRoot))
    )
      throw new Error("Ranking database must be outside the web root.");
    mkdirSync(dirname(filename), { recursive: true, mode: 0o700 });
    const fd = openSync(
      filename,
      constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW,
      0o600,
    );
    try {
      fchmodSync(fd, 0o600);
    } finally {
      closeSync(fd);
    }
    this.db = new DatabaseSync(filename);
    try {
      this.db.exec(
        "PRAGMA busy_timeout=5000; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;",
      );
      const version = this.db.prepare("PRAGMA user_version").get()!
        .user_version;
      if (version !== 0 && version !== 1)
        throw new Error("Unsupported ranking database version.");
      this.db.exec(`
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS ranked_profiles (
          wallet TEXT PRIMARY KEY,
          rating REAL NOT NULL DEFAULT 1500,
          deviation REAL NOT NULL DEFAULT 350 CHECK (deviation >= 50 AND deviation <= 350),
          matches INTEGER NOT NULL DEFAULT 0 CHECK (matches >= 0),
          wins INTEGER NOT NULL DEFAULT 0 CHECK (wins >= 0),
          losses INTEGER NOT NULL DEFAULT 0 CHECK (losses >= 0),
          draws INTEGER NOT NULL DEFAULT 0 CHECK (draws >= 0),
          last_friend_id TEXT,
          CHECK (matches = wins + losses + draws)
        );
        CREATE TABLE IF NOT EXISTS ranked_matches (
          id TEXT PRIMARY KEY,
          wallet_a TEXT NOT NULL REFERENCES ranked_profiles(wallet),
          wallet_b TEXT NOT NULL REFERENCES ranked_profiles(wallet),
          winner_wallet TEXT,
          CHECK (wallet_a != wallet_b),
          CHECK (winner_wallet IS NULL OR winner_wallet = wallet_a OR winner_wallet = wallet_b)
        );
        CREATE TABLE IF NOT EXISTS ranked_results (
          match_id TEXT NOT NULL REFERENCES ranked_matches(id),
          wallet TEXT NOT NULL REFERENCES ranked_profiles(wallet),
          result_json TEXT NOT NULL,
          PRIMARY KEY (match_id, wallet)
        );
        PRAGMA user_version=1;
        COMMIT;
      `);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  private row(wallet: string): ProfileRow {
    return this.db
      .prepare("SELECT * FROM ranked_profiles WHERE wallet = ?")
      .get(wallet) as ProfileRow;
  }
  private ensure(wallet: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO ranked_profiles(wallet) VALUES (?)")
      .run(wallet);
  }
  profile(wallet: string, friendId?: string): RankProfile {
    const key = walletKey(wallet),
      friend = friendId === undefined ? undefined : friendKey(friendId);
    this.ensure(key);
    if (friend !== undefined)
      this.db
        .prepare(
          "UPDATE ranked_profiles SET last_friend_id = ? WHERE wallet = ?",
        )
        .run(friend, key);
    return publicProfile(this.row(key));
  }
  leaderboard(limit = 20): {
    season: typeof RANK_SEASON;
    entries: Array<RankProfile & { position: number }>;
  } {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
      throw new Error("Ranking limit must be between 1 and 100.");
    const rows = this.db
      .prepare(
        "SELECT * FROM ranked_profiles WHERE matches >= 5 ORDER BY rating DESC, deviation ASC, wallet ASC LIMIT ?",
      )
      .all(limit) as ProfileRow[];
    return {
      season: RANK_SEASON,
      entries: rows.map((row, i) => ({
        ...publicProfile(row),
        position: i + 1,
      })),
    };
  }
  getResult(matchId: string, wallet: string): RankResult | null {
    const result = this.db
      .prepare(
        "SELECT result_json FROM ranked_results WHERE match_id = ? AND wallet = ?",
      )
      .get(matchKey(matchId), walletKey(wallet));
    return result
      ? (JSON.parse(result.result_json as string) as RankResult)
      : null;
  }
  record(
    matchId: string,
    walletA: string,
    walletB: string,
    winnerWallet: string | null,
  ): { a: RankResult; b: RankResult } {
    const id = matchKey(matchId),
      a = walletKey(walletA),
      b = walletKey(walletB);
    const winner = winnerWallet === null ? null : walletKey(winnerWallet);
    if (a === b || (winner !== null && winner !== a && winner !== b))
      throw new Error("Invalid ranked participants or winner.");
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const prior = this.db
        .prepare("SELECT * FROM ranked_matches WHERE id = ?")
        .get(id);
      if (prior) {
        if (
          !(
            (prior.wallet_a === a && prior.wallet_b === b) ||
            (prior.wallet_a === b && prior.wallet_b === a)
          ) ||
          prior.winner_wallet !== winner
        )
          throw new Error(
            "Ranked match was already recorded with a different result.",
          );
        const result = { a: this.getResult(id, a)!, b: this.getResult(id, b)! };
        this.db.exec("COMMIT");
        return result;
      }
      this.ensure(a);
      this.ensure(b);
      const beforeA = this.row(a),
        beforeB = this.row(b);
      const scoreA = winner === null ? 0.5 : winner === a ? 1 : 0;
      const afterA = update(beforeA, beforeB, scoreA),
        afterB = update(beforeB, beforeA, 1 - scoreA);
      const persist = this.db.prepare(
        "UPDATE ranked_profiles SET rating=?, deviation=?, matches=?, wins=?, losses=?, draws=? WHERE wallet=?",
      );
      for (const row of [afterA, afterB])
        persist.run(
          row.rating,
          row.deviation,
          row.matches,
          row.wins,
          row.losses,
          row.draws,
          row.wallet,
        );
      this.db
        .prepare(
          "INSERT INTO ranked_matches(id,wallet_a,wallet_b,winner_wallet) VALUES (?,?,?,?)",
        )
        .run(id, a, b, winner);
      const result = (
        before: ProfileRow,
        after: ProfileRow,
        score: number,
      ): RankResult => {
        const beforePublic = publicProfile(before),
          afterPublic = publicProfile(after);
        return {
          matchId: id,
          outcome: score === 1 ? "win" : score === 0 ? "loss" : "draw",
          before: beforePublic,
          after: afterPublic,
          delta: afterPublic.rating - beforePublic.rating,
          division: afterPublic.division,
          placements: afterPublic.placements,
        };
      };
      const results = {
        a: result(beforeA, afterA, scoreA),
        b: result(beforeB, afterB, 1 - scoreA),
      };
      const save = this.db.prepare(
        "INSERT INTO ranked_results(match_id,wallet,result_json) VALUES (?,?,?)",
      );
      save.run(id, a, JSON.stringify(results.a));
      save.run(id, b, JSON.stringify(results.b));
      this.db.exec("COMMIT");
      return results;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close(): void {
    this.db.close();
  }
}
