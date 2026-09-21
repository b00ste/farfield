// Browser-only synthetic 42-Friend wallet; never included in the production bundle.
import {
  decodeFunctionData,
  encodeFunctionData,
  encodeFunctionResult,
  encodeEventTopics,
  padHex,
  parseAbi,
  zeroAddress,
} from "viem";
import {
  FAMILIES_REGISTRY_ABI,
  GENERATION_SPRITE_MANIFEST,
} from "@rarefriends/friendsdk/sprites";
import { createArtworkFixture } from "./fixture.mjs";
const owner = "0x1111111111111111111111111111111111111111";
const abi = parseAbi([
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
  "function balanceOf(address) view returns(uint256)",
  "function ownerOf(uint256) view returns(address)",
  "function generation(uint256) view returns(uint8)",
  "function tokenBoundAccount(uint256) view returns(address)",
]);
export async function collectionFixture(page, control = {}) {
  const artwork = await createArtworkFixture();
  await page.route("**/api/friend-rpc", async (route) => {
    const answer = async (body) => {
      let result;
      if (body.method === "eth_getLogs") {
        await control.pending;
        if (control.fail)
          return {
            id: body.id,
            jsonrpc: "2.0",
            error: { code: -32602, message: "Test discovery failure" },
          };
      }
      if (body.method === "eth_chainId") result = "0x1237";
      else if (body.method === "eth_blockNumber") result = "0x100";
      else if (body.method === "eth_getBalance") result = "0x0";
      else if (body.method === "eth_getLogs")
        result = body.params[0].topics[1]
          ? []
          : Array.from({ length: 42 }, (_, index) => ({
              address: GENERATION_SPRITE_MANIFEST.generations,
              blockNumber: "0x10",
              blockHash: padHex("0x10", { size: 32 }),
              data: "0x",
              logIndex: `0x${index.toString(16)}`,
              transactionHash: padHex("0x1234", { size: 32 }),
              transactionIndex: "0x0",
              removed: false,
              topics: encodeEventTopics({
                abi,
                eventName: "Transfer",
                args: {
                  from: zeroAddress,
                  to: owner,
                  tokenId: BigInt(7730 + index),
                },
              }),
            }));
      else if (body.method === "eth_call") {
        const call = body.params[0];
        if (
          call.to.toLowerCase() ===
          GENERATION_SPRITE_MANIFEST.generations.toLowerCase()
        ) {
          const { functionName } = decodeFunctionData({ abi, data: call.data });
          const value = {
            balanceOf: control.empty ? 0n : 42n,
            ownerOf: owner,
            generation: 3,
            tokenBoundAccount: "0x3333333333333333333333333333333333333333",
          }[functionName];
          result = encodeFunctionResult({ abi, functionName, result: value });
        } else {
          const { functionName } = decodeFunctionData({
            abi: FAMILIES_REGISTRY_ABI,
            data: call.data,
          });
          result = await artwork(
            ["familyOf", "seedOf"].includes(functionName)
              ? {
                  ...call,
                  data: encodeFunctionData({
                    abi: FAMILIES_REGISTRY_ABI,
                    functionName,
                    args: [7730n],
                  }),
                }
              : call,
          );
        }
      } else throw new Error(`Unexpected collection RPC ${body.method}`);
      return { id: body.id, jsonrpc: "2.0", result };
    };
    const body = route.request().postDataJSON();
    return route.fulfill({
      json: Array.isArray(body)
        ? await Promise.all(body.map(answer))
        : await answer(body),
    });
  });
}
