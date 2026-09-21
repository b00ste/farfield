import { decodeFunctionData, parseAbi, toEventSelector, isAddress } from "viem";
const collection = "0x14c49e6118f46525de9ab41a51cbaa3c6ebf181d";
const registry = "0x246e3e9730a7eade94c79be0fd78d210f89aeb8d";
const transfer = toEventSelector("Transfer(address,address,uint256)");
const collectionAbi = parseAbi([
  "function balanceOf(address account) view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function generation(uint256 tokenId) view returns (uint8)",
  "function tokenBoundAccount(uint256 tokenId) view returns (address)",
]);
const artAbi = parseAbi([
  "function familyOf(uint256 tokenId) pure returns (uint8)",
  "function seedOf(uint256 tokenId) pure returns (uint32)",
  "function frames(uint8 id, uint32 seed) view returns (uint256[64])",
]);
const block = (value: unknown) =>
  value === "latest" ||
  (typeof value === "string" && /^0x[0-9a-f]{1,64}$/i.test(value));
/** Fixed upstream, read-only allowlist. No arbitrary contracts, scans, or signing. */
export function validateFriendRpc(input: unknown): void {
  const batch = Array.isArray(input) ? input : [input];
  if (!batch.length || batch.length > 50) throw new Error("Invalid RPC batch.");
  for (const item of batch) {
    if (!item || typeof item !== "object")
      throw new Error("Invalid RPC request.");
    const { jsonrpc, id, method, params = [] } = item;
    if (
      jsonrpc !== "2.0" ||
      !(
        Number.isSafeInteger(id) ||
        (typeof id === "string" && id.length <= 64)
      ) ||
      !Array.isArray(params)
    )
      throw new Error("Invalid RPC request.");
    if (
      ["eth_chainId", "eth_blockNumber"].includes(method) &&
      params.length === 0
    )
      continue;
    if (
      method === "eth_getBalance" &&
      params.length === 2 &&
      typeof params[0] === "string" &&
      isAddress(params[0]) &&
      block(params[1])
    )
      continue;
    if (method === "eth_call" && params.length === 2 && block(params[1])) {
      const call = params[0];
      if (
        !call ||
        typeof call !== "object" ||
        !isAddress(call.to) ||
        typeof call.data !== "string" ||
        !/^0x[0-9a-f]+$/i.test(call.data) ||
        Object.keys(call).some((k) => !["to", "data"].includes(k))
      )
        throw new Error("Invalid Friend read.");
      const to = call.to.toLowerCase();
      if (to !== collection && to !== registry)
        throw new Error("Unsupported contract.");
      const decoded = decodeFunctionData({
        abi: to === collection ? collectionAbi : artAbi,
        data: call.data,
      });
      const words = decoded.functionName === "frames" ? 2 : 1;
      if (call.data.length !== 10 + words * 64)
        throw new Error("Invalid Friend read.");
      continue;
    }
    if (method === "eth_getLogs" && params.length === 1) {
      const f = params[0];
      const topicAddress = (v: unknown) =>
        typeof v === "string" &&
        /^0x0{24}[0-9a-f]{40}$/i.test(v) &&
        !/^0x0+$/.test(v);
      if (
        f &&
        typeof f.address === "string" &&
        f.address.toLowerCase() === collection &&
        block(f.fromBlock) &&
        block(f.toBlock) &&
        Array.isArray(f.topics) &&
        f.topics.length >= 2 &&
        f.topics.length <= 4 &&
        (f.topics.length < 4 || f.topics[3] === null) &&
        f.topics[0] === transfer &&
        f.topics
          .slice(1, 3)
          .every((t: unknown) => t === null || topicAddress(t)) &&
        f.topics.slice(1, 3).some(topicAddress) &&
        Object.keys(f).every((k) =>
          ["address", "topics", "fromBlock", "toBlock"].includes(k),
        )
      )
        continue;
    }
    throw new Error("Unsupported Friend RPC request.");
  }
}
let pending = 0;
export async function forwardFriendRpc(body: unknown) {
  validateFriendRpc(body);
  if (pending >= 8) throw new Error("Friend service is busy. Retry shortly.");
  pending++;
  try {
    const response = await fetch(
      process.env.FRIEND_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(12000),
      },
    );
    if (!response.ok)
      throw new Error("Friend service is temporarily unavailable.");
    // Never forward upstream CORS headers or cache identity reads.
    return await response.json();
  } finally {
    pending--;
  }
}
