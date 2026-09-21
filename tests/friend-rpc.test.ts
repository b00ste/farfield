import test from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, parseAbi, toEventSelector, padHex } from "viem";
import { validateFriendRpc } from "../server/friend-rpc.ts";
const collection = "0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D";
const owner = "0x1111111111111111111111111111111111111111";
const call = {
  jsonrpc: "2.0",
  id: 1,
  method: "eth_call",
  params: [
    {
      to: collection,
      data: encodeFunctionData({
        abi: parseAbi(["function ownerOf(uint256) view returns (address)"]),
        functionName: "ownerOf",
        args: [20841n],
      }),
    },
    "0x123",
  ],
};
test("Friend RPC allows batched fresh ownership and owner-filtered history reads", () => {
  assert.doesNotThrow(() =>
    validateFriendRpc([
      call,
      { jsonrpc: "2.0", id: 2, method: "eth_blockNumber" },
    ]),
  );
  assert.doesNotThrow(() =>
    validateFriendRpc({
      jsonrpc: "2.0",
      id: 3,
      method: "eth_getLogs",
      params: [
        {
          address: collection,
          fromBlock: "0x0",
          toBlock: "0x123",
          topics: [
            toEventSelector("Transfer(address,address,uint256)"),
            null,
            padHex(owner, { size: 32 }),
            null,
          ],
        },
      ],
    }),
  );
});
test("Friend RPC rejects writes, arbitrary contracts, unfiltered scans and oversized batches", () => {
  for (const method of [
    "eth_sendRawTransaction",
    "personal_sign",
    "eth_getBalance",
  ])
    assert.throws(() => validateFriendRpc({ ...call, method }));
  assert.throws(() =>
    validateFriendRpc({
      ...call,
      params: [{ ...(call.params[0] as object), to: owner }, "latest"],
    }),
  );
  assert.throws(() =>
    validateFriendRpc({
      jsonrpc: "2.0",
      id: 3,
      method: "eth_getLogs",
      params: [
        {
          address: collection,
          fromBlock: "0x0",
          toBlock: "latest",
          topics: [toEventSelector("Transfer(address,address,uint256)")],
        },
      ],
    }),
  );
  assert.throws(() => validateFriendRpc(Array(51).fill(call)));
  assert.throws(() =>
    validateFriendRpc({
      ...call,
      params: [{ ...(call.params[0] as object), value: "0x1" }, "latest"],
    }),
  );
});
