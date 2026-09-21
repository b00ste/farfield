import { randomBytes } from "node:crypto";
import {
  createPublicClient,
  createWalletClient,
  http,
  isAddress,
  verifyMessage,
  zeroAddress,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  chain,
  escrowAbi,
  tokenAbi,
  identityAbi,
  RF,
  GENERATIONS,
  ENTRY,
  type Wager,
} from "../shared/wagers.ts";
import { applyCommand } from "../games/farfield/engine.ts";
import type { Rooms } from "./rooms.ts";
type Login = {
  address: Address;
  friendId: string;
  message: string;
  expires: number;
};
/** Paid matchmaking has a separate signed identity gate. Practice room identifiers cannot authorize deposits. */
export class Wagers {
  private client = createPublicClient({
    chain,
    transport: http(
      process.env.FRIEND_RPC_URL || chain.rpcUrls.default.http[0],
      { timeout: 12000, retryCount: 1 },
    ),
  });
  private signer =
    process.env.RF_REFEREE_KEY &&
    /^0x[0-9a-fA-F]{64}$/.test(process.env.RF_REFEREE_KEY)
      ? privateKeyToAccount(process.env.RF_REFEREE_KEY as Hex)
      : null;
  private contract = isAddress(process.env.RF_ESCROW_ADDRESS || "")
    ? (process.env.RF_ESCROW_ADDRESS as Address)
    : null;
  private enabled = false;
  private working = false;
  private pending = new Map<string, Hex>();
  private challenges = new Map<string, Login>();
  private auth = new Map<
    string,
    Login & { session?: { code: string; token: string } }
  >();
  private rooms: Rooms;
  constructor(rooms: Rooms) {
    this.rooms = rooms;
  }
  async initialize() {
    if (
      process.env.RF_WAGERS_ENABLED !== "true" ||
      !this.signer ||
      !this.contract
    )
      return;
    try {
      const [network, referee, token, entry, code] = await Promise.all([
        this.client.getChainId(),
        this.client.readContract({
          address: this.contract,
          abi: escrowAbi,
          functionName: "referee",
        }),
        this.client.readContract({
          address: this.contract,
          abi: escrowAbi,
          functionName: "RF",
        }),
        this.client.readContract({
          address: this.contract,
          abi: escrowAbi,
          functionName: "ENTRY",
        }),
        this.client.getCode({ address: this.contract }),
      ]);
      this.enabled =
        network === 4663 &&
        referee.toLowerCase() === this.signer.address.toLowerCase() &&
        token.toLowerCase() === RF.toLowerCase() &&
        entry === ENTRY &&
        !!code &&
        code !== "0x";
    } catch {
      this.enabled = false;
    }
  }
  config() {
    return {
      enabled: this.enabled,
      chainId: 4663,
      token: RF,
      entry: "1",
      pool: "2",
      contract: this.contract,
      referee: this.signer?.address ?? null,
      fundingSeconds: 600,
      resultSeconds: 2700,
    };
  }
  challenge(address: unknown, friendId: unknown) {
    if (!this.enabled)
      throw new Error(
        "RF matches are unavailable until escrow deployment and validation.",
      );
    if (
      typeof address !== "string" ||
      !isAddress(address) ||
      typeof friendId !== "string" ||
      !/^\d{1,78}$/.test(friendId)
    )
      throw new Error("Invalid wallet or Friend.");
    this.clean();
    if (this.challenges.size > 500)
      throw new Error("Too many pending wallet verifications.");
    const nonce = randomBytes(24).toString("hex"),
      expires = Date.now() + 300000;
    const message = `Farfield RF matchmaking\nChain: 4663\nEscrow: ${this.contract}\nWallet: ${address}\nFriend: ${friendId}\nEntry: 1 RF\nWinner pool: 2 RF\nNonce: ${nonce}\nExpires: ${new Date(expires).toISOString()}\nThis signature verifies your identity. It does not transfer tokens.`;
    this.challenges.set(nonce, { address, friendId, message, expires });
    return { nonce, message };
  }
  async authenticate(nonce: unknown, signature: unknown) {
    if (
      !this.enabled ||
      typeof nonce !== "string" ||
      typeof signature !== "string" ||
      !/^0x[0-9a-fA-F]+$/.test(signature)
    )
      throw new Error("Invalid wallet verification.");
    const login = this.challenges.get(nonce);
    this.challenges.delete(nonce);
    if (!login || login.expires < Date.now())
      throw new Error("Wallet verification expired.");
    if (
      !(await verifyMessage({
        address: login.address,
        message: login.message,
        signature: signature as Hex,
      }))
    )
      throw new Error("Signature does not match this wallet.");
    const [owner, generation, wallet] = await Promise.all([
      this.client.readContract({
        address: GENERATIONS,
        abi: identityAbi,
        functionName: "ownerOf",
        args: [BigInt(login.friendId)],
      }),
      this.client.readContract({
        address: GENERATIONS,
        abi: identityAbi,
        functionName: "generation",
        args: [BigInt(login.friendId)],
      }),
      this.client.readContract({
        address: GENERATIONS,
        abi: identityAbi,
        functionName: "tokenBoundAccount",
        args: [BigInt(login.friendId)],
      }),
    ]).catch(() => {
      throw new Error(
        "Friend ownership could not be verified. Retry in a moment.",
      );
    });
    if (
      owner.toLowerCase() !== login.address.toLowerCase() ||
      generation < 1 ||
      wallet === zeroAddress
    )
      throw new Error("This wallet does not own an eligible Friend.");
    if (this.auth.size > 500) throw new Error("Matchmaking is busy.");
    const auth = randomBytes(32).toString("hex");
    this.auth.set(auth, { ...login, expires: Date.now() + 1800000 });
    return { auth };
  }
  matchmake(auth: unknown, friendId: string) {
    const login = typeof auth === "string" ? this.auth.get(auth) : undefined;
    if (
      !this.enabled ||
      !this.contract ||
      !login ||
      login.expires < Date.now() ||
      login.friendId !== friendId
    )
      throw new Error("Verify your wallet before joining a token match.");
    if (login.session) {
      const { room } = this.rooms.access(
        login.session.code,
        login.session.token,
      );
      return {
        token: login.session.token,
        ...this.rooms.view(room, login.session.token),
      };
    }
    for (const room of this.rooms.rooms.values()) {
      if (!room.wager) continue;
      const previous = room.players.find(
        (p) =>
          p.wallet?.toLowerCase() === login.address.toLowerCase() &&
          ["ready", "playing"].includes(p.state.phase),
      );
      if (!previous) continue;
      if (previous.friendId !== friendId)
        throw new Error(
          `Return with Friend #${previous.friendId} to resume your RF match.`,
        );
      login.session = { code: room.code, token: previous.token };
      this.rooms.access(room.code, previous.token);
      return {
        token: previous.token,
        ...this.rooms.view(room, previous.token),
      };
    }
    const wager: Wager = {
      id: `0x${randomBytes(32).toString("hex")}`,
      contract: this.contract,
      status: "waiting",
      funded: [false, false],
      fundBy: 0,
      resolveBy: 0,
    };
    const result = this.rooms.matchmake(
      friendId,
      Date.now(),
      wager,
      login.address,
    );
    login.session = { code: result.code, token: result.token };
    return result;
  }
  async status(id: unknown, address: unknown, hash?: unknown) {
    if (
      !this.contract ||
      typeof id !== "string" ||
      !/^0x[0-9a-fA-F]{64}$/.test(id) ||
      typeof address !== "string" ||
      !isAddress(address)
    )
      throw new Error("Invalid escrow match.");
    const [match, claimable, allowance, balance, transaction] =
      await Promise.all([
        this.client.readContract({
          address: this.contract,
          abi: escrowAbi,
          functionName: "getMatch",
          args: [id as Hex],
        }),
        this.client.readContract({
          address: this.contract,
          abi: escrowAbi,
          functionName: "claimable",
          args: [id as Hex, address],
        }),
        this.client.readContract({
          address: RF,
          abi: tokenAbi,
          functionName: "allowance",
          args: [address, this.contract],
        }),
        this.client.readContract({
          address: RF,
          abi: tokenAbi,
          functionName: "balanceOf",
          args: [address],
        }),
        typeof hash === "string" && /^0x[0-9a-fA-F]{64}$/.test(hash)
          ? this.client
              .getTransactionReceipt({ hash: hash as Hex })
              .then((r) => r.status)
              .catch(() => "pending" as const)
          : null,
      ]).catch(() => {
        throw new Error(
          "Could not read escrow status. Check the match ID or retry.",
        );
      });
    if (
      ![match[0].toLowerCase(), match[1].toLowerCase()].includes(
        address.toLowerCase(),
      )
    )
      throw new Error("This wallet is not a player in that match.");
    return {
      id,
      contract: this.contract,
      players: [match[0], match[1]],
      fundBy: Number(match[2]),
      resolveBy: Number(match[3]),
      stage: match[4],
      funded: [match[5], match[6]],
      winner: match[7],
      transaction,
      claimable: claimable.toString(),
      allowance: allowance.toString(),
      balance: balance.toString(),
    };
  }
  async pump() {
    if (this.working || !this.enabled || !this.signer || !this.contract) return;
    this.working = true;
    const wallet = createWalletClient({
      account: this.signer,
      chain,
      transport: http(
        process.env.FRIEND_RPC_URL || chain.rpcUrls.default.http[0],
      ),
    });
    try {
      for (const room of this.rooms.rooms.values()) {
        const w = room.wager;
        if (
          !w ||
          room.players.length !== 2 ||
          w.status === "refundable" ||
          w.status === "settled"
        )
          continue;
        try {
          const confirmed =
            (await this.client.getBlockNumber({ cacheTime: 0 })) - 1n;
          let match = await this.client.readContract({
            blockNumber: confirmed > 0n ? confirmed : 0n,
            address: this.contract,
            abi: escrowAbi,
            functionName: "getMatch",
            args: [w.id],
          });
          if (match[4] === 0) {
            w.status = "opening";
            const hash =
              this.pending.get(w.id) ??
              (await wallet.writeContract({
                address: this.contract,
                abi: escrowAbi,
                functionName: "createMatch",
                args: [
                  w.id,
                  room.players[0].wallet!,
                  room.players[1].wallet!,
                  BigInt(room.players[0].friendId),
                  BigInt(room.players[1].friendId),
                ],
              }));
            this.pending.set(w.id, hash);
            const receipt = await this.client.waitForTransactionReceipt({
              hash,
              confirmations: 2,
              timeout: 45000,
            });
            this.pending.delete(w.id);
            if (receipt.status !== "success")
              throw new Error("Escrow creation reverted");
            match = await this.client.readContract({
              blockNumber:
                (await this.client.getBlockNumber({ cacheTime: 0 })) - 1n,
              address: this.contract,
              abi: escrowAbi,
              functionName: "getMatch",
              args: [w.id],
            });
          }
          w.fundBy = Number(match[2]);
          w.resolveBy = Number(match[3]);
          w.funded = [match[5], match[6]];
          delete w.error;
          const now = Number((await this.client.getBlock()).timestamp);
          if (
            (match[4] === 1 && now >= w.fundBy) ||
            (match[4] === 2 && now >= w.resolveBy) ||
            match[4] === 4
          ) {
            w.status = "refundable";
            for (const p of room.players) {
              p.state.phase = "lost";
              p.state.paused = true;
            }
            room.winnerId = null;
          } else if (match[4] === 3) {
            w.status = "settled";
            const winner = room.players.find(
              (p) => p.wallet!.toLowerCase() === match[7].toLowerCase(),
            )!;
            room.winnerId = winner.id;
            for (const p of room.players)
              p.state.phase = p === winner ? "won" : "lost";
          } else if (match[4] === 1) w.status = "funding";
          else if (match[4] === 2) {
            w.status = room.winnerId ? "settling" : "active";
            for (const p of room.players)
              if (p.state.phase === "ready")
                applyCommand(p.state, { type: "start" });
            if (room.winnerId) {
              const winner = room.players.find((p) => p.id === room.winnerId)!;
              const hash =
                this.pending.get(`${w.id}:result`) ??
                (await wallet.writeContract({
                  address: this.contract,
                  abi: escrowAbi,
                  functionName: "settle",
                  args: [w.id, winner.wallet!],
                }));
              this.pending.set(`${w.id}:result`, hash);
              const receipt = await this.client.waitForTransactionReceipt({
                hash,
                confirmations: 2,
                timeout: 45000,
              });
              this.pending.delete(`${w.id}:result`);
              if (receipt.status !== "success")
                throw new Error("Settlement reverted");
              w.status = "settled";
            }
          }
          room.revision++;
        } catch {
          w.error =
            "Waiting for escrow confirmation. Timeout refunds remain available on-chain.";
          room.revision++;
        }
      }
    } finally {
      this.working = false;
      this.clean();
    }
  }
  private clean() {
    for (const [key, v] of this.challenges)
      if (v.expires < Date.now()) this.challenges.delete(key);
    for (const [key, v] of this.auth)
      if (v.expires < Date.now()) this.auth.delete(key);
  }
}
