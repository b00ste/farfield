import { parseAbi, defineChain } from "viem";
export const RF = "0x0779369854d3EcdEA927206718FFD7730C67B71f" as const;
export const GENERATIONS =
  "0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D" as const;
export const ENTRY = 10n ** 18n;
export const chain = defineChain({
  id: 4663,
  name: "Robinhood",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
});
export const escrowAbi = parseAbi([
  "function referee() view returns (address)",
  "function RF() view returns (address)",
  "function ENTRY() view returns (uint256)",
  "function createMatch(bytes32 id,address a,address b,uint256 friendA,uint256 friendB)",
  "function deposit(bytes32 id)",
  "function claim(bytes32 id)",
  "function forfeit(bytes32 id)",
  "function settle(bytes32 id,address winner)",
  "function getMatch(bytes32 id) view returns (address a,address b,uint64 fundBy,uint64 resolveBy,uint8 stage,bool fundedA,bool fundedB,address winner)",
  "function claimable(bytes32 id,address player) view returns (uint256)",
]);
export const tokenAbi = parseAbi([
  "function approve(address spender,uint256 amount) returns (bool)",
  "function allowance(address owner,address spender) view returns (uint256)",
  "function balanceOf(address player) view returns (uint256)",
]);
export const identityAbi = parseAbi([
  "function ownerOf(uint256 id) view returns (address)",
  "function generation(uint256 id) view returns (uint8)",
  "function tokenBoundAccount(uint256 id) view returns (address)",
]);
export type Wager = {
  id: `0x${string}`;
  contract: `0x${string}`;
  status:
    | "waiting"
    | "opening"
    | "funding"
    | "active"
    | "settling"
    | "settled"
    | "refundable";
  funded: boolean[];
  fundBy: number;
  resolveBy: number;
  error?: string;
};
