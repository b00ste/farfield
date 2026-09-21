// Local Anvil only. Uses its public development mnemonic and test-double RF/Generations code.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseAbi,
  type Hex,
} from "viem";
import { mnemonicToAccount } from "viem/accounts";
import {
  RF,
  GENERATIONS,
  ENTRY,
  chain,
  escrowAbi,
  tokenAbi,
} from "../shared/wagers.ts";
import { Rooms } from "../server/rooms.ts";
import { Wagers } from "../server/wagers.ts";
const rpc = "http://127.0.0.1:18545";
const mnemonic = "test test test test test test test test test test test junk";
const accounts = [0, 1, 2].map((addressIndex) =>
  mnemonicToAccount(mnemonic, { addressIndex }),
);
const clients = accounts.map((account) =>
  createWalletClient({ account, chain, transport: http(rpc) }),
);
const client = createPublicClient({
  chain,
  transport: http(rpc),
  pollingInterval: 200,
});
const artifact = async (name: string) =>
  JSON.parse(await readFile(`contracts/out/${name}.sol/${name}.json`, "utf8"));
const mock = async (name: string) =>
  JSON.parse(
    await readFile(`contracts/out/FarfieldEscrow.t.sol/${name}.json`, "utf8"),
  );
async function raw(method: string, params: unknown[]) {
  const r = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await r.json();
  if (body.error) throw new Error(body.error.message);
  return body.result;
}
async function mined(hash: Hex) {
  const r = await client.waitForTransactionReceipt({
    hash,
    confirmations: 2,
    timeout: 20000,
  });
  assert.equal(r.status, "success");
  return r;
}
await raw("anvil_reset", []);
await raw("anvil_setCode", [
  RF,
  (await mock("MockRF")).deployedBytecode.object,
]);
await raw("anvil_setCode", [
  GENERATIONS,
  (await mock("MockGenerations")).deployedBytecode.object,
]);
const contract = await artifact("FarfieldEscrow");
const deployed = await mined(
  await clients[0].deployContract({
    abi: contract.abi,
    bytecode: contract.bytecode.object,
    args: [accounts[0].address],
  }),
);
const escrow = deployed.contractAddress!;
for (let i = 1; i <= 2; i++) {
  await mined(
    await clients[0].writeContract({
      address: RF,
      abi: parseAbi(["function mint(address a,uint256 n)"]),
      functionName: "mint",
      args: [accounts[i].address, 10n * ENTRY],
    }),
  );
  await mined(
    await clients[0].writeContract({
      address: GENERATIONS,
      abi: parseAbi(["function set(uint256 id,address owner)"]),
      functionName: "set",
      args: [BigInt(i), accounts[i].address],
    }),
  );
}
process.env.FRIEND_RPC_URL = rpc;
process.env.RF_ESCROW_ADDRESS = escrow;
process.env.RF_WAGERS_ENABLED = "true";
// The private key is derived in memory from Anvil's public development mnemonic, never a funded wallet.
process.env.RF_REFEREE_KEY = `0x${Buffer.from(accounts[0].getHdKey().privateKey!).toString("hex")}`;
const rooms = new Rooms(),
  wagers = new Wagers(rooms);
await wagers.initialize();
assert.equal(wagers.config().enabled, true);
async function login(i: number) {
  const c = wagers.challenge(accounts[i].address, String(i));
  const signature = await accounts[i].signMessage({ message: c.message });
  const result = await wagers.authenticate(c.nonce, signature);
  await assert.rejects(
    () => wagers.authenticate(c.nonce, signature),
    /expired/,
  );
  return result.auth;
}
const bad = wagers.challenge(accounts[1].address, "1");
await assert.rejects(
  () => wagers.authenticate(bad.nonce, accounts[2].address),
  /signature|Signature/i,
);
assert.throws(() => wagers.matchmake("fake", "1"), /Verify/);
const a = wagers.matchmake(await login(1), "1");
const b = wagers.matchmake(await login(2), "2");
assert.equal(a.code, b.code);
assert.equal(b.state.phase, "ready");
assert.equal(b.economy.kind, "wager");
assert.throws(
  () => rooms.command(a.code, a.token, { type: "start" }),
  /deposits/,
);
const resumed = wagers.matchmake(await login(1), "1");
assert.equal(
  resumed.token,
  a.token,
  "signed owner recovers their active paid seat",
);
await wagers.pump();
const room = rooms.rooms.get(a.code)!;
assert.equal(room.wager!.status, "funding");
const id = room.wager!.id;
await assert.rejects(
  () => wagers.status(id, accounts[0].address),
  /not a player/,
);
await mined(
  await clients[1].writeContract({
    address: RF,
    abi: tokenAbi,
    functionName: "approve",
    args: [escrow, ENTRY],
  }),
);
await mined(
  await clients[1].writeContract({
    address: escrow,
    abi: escrowAbi,
    functionName: "deposit",
    args: [id],
  }),
);
await wagers.pump();
assert.equal(
  room.players[0].state.phase,
  "ready",
  "one deposit never starts gameplay",
);
await mined(
  await clients[2].writeContract({
    address: RF,
    abi: tokenAbi,
    functionName: "approve",
    args: [escrow, ENTRY],
  }),
);
await mined(
  await clients[2].writeContract({
    address: escrow,
    abi: escrowAbi,
    functionName: "deposit",
    args: [id],
  }),
);
await wagers.pump();
assert.equal(room.players[0].state.phase, "playing");
assert.equal(room.wager!.status, "active");
rooms.command(a.code, a.token, { type: "forfeit" });
await wagers.pump();
assert.equal(room.wager!.status, "settled");
const status = await wagers.status(id, accounts[2].address);
assert.equal(status.claimable, String(2n * ENTRY));
await mined(
  await clients[2].writeContract({
    address: escrow,
    abi: escrowAbi,
    functionName: "claim",
    args: [id],
  }),
);
assert.equal(
  (await wagers.status(id, accounts[2].address)).balance,
  String(11n * ENTRY),
);
assert.equal((await wagers.status(id, accounts[2].address)).claimable, "0");
// Referee process loss still leaves an on-chain timeout recovery path.
const c = wagers.matchmake(await login(1), "1");
wagers.matchmake(await login(2), "2");
await wagers.pump();
const orphan = rooms.rooms.get(c.code)!.wager!.id;
await mined(
  await clients[1].writeContract({
    address: RF,
    abi: tokenAbi,
    functionName: "approve",
    args: [escrow, ENTRY],
  }),
);
await mined(
  await clients[1].writeContract({
    address: escrow,
    abi: escrowAbi,
    functionName: "deposit",
    args: [orphan],
  }),
);
await raw("evm_increaseTime", [601]);
await raw("evm_mine", []);
await mined(
  await clients[1].writeContract({
    address: escrow,
    abi: escrowAbi,
    functionName: "claim",
    args: [orphan],
  }),
);
assert.equal(
  (await wagers.status(orphan, accounts[1].address)).balance,
  String(9n * ENTRY),
);
console.log(
  "PASS: local-chain deployment, signed identity/nonces, separate paid queue, two confirmed deposits before start, server-refereed forfeit, 2 RF claim, and server-independent timeout refund. No mainnet transactions.",
);
