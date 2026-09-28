import { randomBytes } from "node:crypto";
import { createPublicClient, http, isAddress, type Address, type Hex } from "viem";
import { readGenerationEligibility } from "@rarefriends/friendsdk/identity";

export type RankedIdentity = { address: string; friendId: string; expiresAt: number };
type Proof = { address: Address; friendId: string; message: string; expiresAt: number };
export type RankedVerifier = {
  signature: (address: Address, message: string, signature: Hex) => Promise<boolean>;
  ownership: (address: Address, friendId: string) => Promise<boolean>;
};
/** No provider exceptions may escape: upstream URLs can contain credentials. */
export function rankedVerifier(): RankedVerifier {
  const client = createPublicClient({ transport: http(
    process.env.FRIEND_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
    { timeout: 8000, retryCount: 0 },
  ), cacheTime: 0 });
  return {
    signature: (address, message, signature) => client.verifyMessage({ address, message, signature }),
    ownership: async (address, friendId) =>
      (await readGenerationEligibility(client, BigInt(friendId), address)).eligible === true,
  };
}
export class RankedAuth {
  private challenges = new Map<string, Proof>();
  private sessions = new Map<string, RankedIdentity>();
  private pending = 0;
  readonly origin: string;
  private verifier: RankedVerifier;
  constructor(origin: string, verifier: RankedVerifier = rankedVerifier()) {
    const url = new URL(origin);
    if (url.origin !== origin || !["http:", "https:"].includes(url.protocol))
      throw new Error("Ranked origin must be an explicit HTTP(S) origin.");
    this.origin = origin;
    this.verifier = verifier;
  }
  challenge(address: unknown, friendId: unknown, now = Date.now()) {
    this.prune(now);
    if (typeof address !== "string" || !isAddress(address) || /^0x0{40}$/i.test(address))
      throw new Error("Connect a valid wallet first.");
    if (typeof friendId !== "string" || !/^[1-9]\d{0,77}$/.test(friendId) || BigInt(friendId) >= 1n << 256n)
      throw new Error("Choose an eligible Friend.");
    if (this.challenges.size >= 1000) throw new Error("Sign-in is busy. Retry shortly.");
    const id = randomBytes(24).toString("hex"), expiresAt = now + 300_000;
    const message = [
      `${new URL(this.origin).host} requests Farfield ranked sign-in.`,
      `Wallet: ${address.toLowerCase()}`,
      "Sign in to the Farfield Preseason. This does not send a transaction.",
      `URI: ${this.origin}`, "Chain ID: 4663", `Friend: ${friendId}`,
      `Nonce: ${id}`, `Issued At: ${new Date(now).toISOString()}`,
      `Expiration Time: ${new Date(expiresAt).toISOString()}`,
    ].join("\n");
    this.challenges.set(id, { address: address.toLowerCase() as Address, friendId, message, expiresAt });
    return { id, message, expiresAt };
  }
  async verify(id: unknown, signature: unknown, now = Date.now()) {
    this.prune(now);
    if (typeof id !== "string") throw new Error("Request a new sign-in challenge.");
    const proof = this.challenges.get(id);
    if (!proof) throw new Error("Sign-in expired or was already used. Try again.");
    if (typeof signature !== "string" || !/^0x[0-9a-f]{2,8192}$/i.test(signature))
      throw new Error("Invalid wallet signature.");
    if (this.pending >= 8 || this.sessions.size >= 1000) throw new Error("Sign-in is busy. Retry shortly.");
    // Consume before awaiting RPC, so concurrent replay cannot mint two sessions.
    this.challenges.delete(id);
    this.pending++;
    try {
      if (!await this.verifier.signature(proof.address, proof.message, signature as Hex))
        throw new Error("Invalid signature.");
      if (!await this.verifier.ownership(proof.address, proof.friendId))
        throw new Error("Friend is not owned.");
      const token = randomBytes(24).toString("hex");
      const session = { address: proof.address, friendId: proof.friendId, expiresAt: now + 3_600_000 };
      this.sessions.set(token, session);
      return { token, ...session };
    } catch {
      throw new Error("Could not verify this wallet and Friend. Check ownership and sign in again.");
    } finally { this.pending--; }
  }
  access(token: string, now = Date.now()) {
    const session = this.sessions.get(token);
    if (!session || session.expiresAt <= now) {
      this.sessions.delete(token);
      throw new Error("Ranked sign-in expired. Sign in again from Online PvP.");
    }
    return { ...session };
  }
  async authorizeMatch(token: string, friendId: string, now = Date.now()) {
    const session = this.access(token, now);
    if (session.friendId !== friendId) throw new Error("Sign in with the selected Friend.");
    if (this.pending >= 8) throw new Error("Sign-in is busy. Retry shortly.");
    this.pending++;
    try {
      if (!await this.verifier.ownership(session.address as Address, friendId)) throw new Error();
    } catch {
      throw new Error("Could not verify current Friend ownership. Retry shortly.");
    } finally { this.pending--; }
    return session;
  }
  prune(now = Date.now()) {
    for (const [key, value] of this.challenges) if (value.expiresAt <= now) this.challenges.delete(key);
    for (const [key, value] of this.sessions) if (value.expiresAt <= now) this.sessions.delete(key);
  }
}
