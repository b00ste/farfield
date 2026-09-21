import test from "node:test";
import assert from "node:assert/strict";
import { encodeFunctionData, parseAbi, toEventSelector, padHex } from "viem";
import { forwardFriendRpc, validateFriendRpc } from "../server/friend-rpc.ts";
const collection = "0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D";
const owner = "0x1111111111111111111111111111111111111111";
const privateUrl = "https://rpc.example.invalid/v2/private-test-credential";
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

test("Friend RPC uses runtime upstream and strips provider metadata from successful batches", async (t) => {
  const original = process.env.FRIEND_RPC_URL;
  process.env.FRIEND_RPC_URL = privateUrl;
  t.after(() => {
    if (original === undefined) delete process.env.FRIEND_RPC_URL;
    else process.env.FRIEND_RPC_URL = original;
  });
  const requests = [
    call,
    { jsonrpc: "2.0", id: 2, method: "eth_chainId", params: [] },
  ];
  t.mock.method(
    globalThis,
    "fetch",
    async (url: string, options: RequestInit) => {
      assert.equal(url, privateUrl);
      assert.equal(options.redirect, "error");
      return Response.json([
        { jsonrpc: "2.0", id: 2, result: "0x1237", provider: privateUrl },
        { jsonrpc: "2.0", id: 1, result: "0x1234", debug: { url: privateUrl } },
      ]);
    },
  );
  assert.deepEqual(await forwardFriendRpc(requests), [
    { jsonrpc: "2.0", id: 2, result: "0x1237" },
    { jsonrpc: "2.0", id: 1, result: "0x1234" },
  ]);
});

test("Friend RPC never exposes upstream URLs through errors or malformed results", async (t) => {
  let response: () => Promise<Response>;
  t.mock.method(globalThis, "fetch", () => response());
  for (const failure of [
    async () => {
      throw new Error(`Failed fetching ${privateUrl}`);
    },
    async () => new Response(privateUrl, { status: 429 }),
    async () => new Response(privateUrl),
    async () => Response.json({ jsonrpc: "2.0", id: 1, result: privateUrl }),
    async () =>
      Response.json({ jsonrpc: "2.0", id: privateUrl, result: "0x1" }),
  ]) {
    response = failure;
    await assert.rejects(forwardFriendRpc(call), {
      message: "Friend service is temporarily unavailable. Retry shortly.",
    });
  }
  response = async () =>
    Response.json({
      jsonrpc: "2.0",
      id: 1,
      error: {
        code: -32005,
        message: privateUrl,
        data: { requestUrl: privateUrl },
      },
    });
  assert.deepEqual(await forwardFriendRpc(call), {
    jsonrpc: "2.0",
    id: 1,
    error: { code: -32005, message: "Friend RPC read failed. Retry shortly." },
  });
});

test("Friend history keeps canonical log fields without provider diagnostics", async (t) => {
  const log = {
    address: collection,
    data: "0x",
    blockNumber: "0x123",
    blockHash: "0xab",
    transactionHash: "0xcd",
    transactionIndex: "0x0",
    logIndex: "0x1",
    removed: false,
    topics: [
      toEventSelector("Transfer(address,address,uint256)"),
      padHex(owner, { size: 32 }),
    ],
  };
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({
      jsonrpc: "2.0",
      id: 3,
      result: [{ ...log, provider: privateUrl }],
      debug: privateUrl,
    }),
  );
  const request = {
    jsonrpc: "2.0",
    id: 3,
    method: "eth_getLogs",
    params: [
      {
        address: collection,
        fromBlock: "0x0",
        toBlock: "latest",
        topics: log.topics,
      },
    ],
  };
  assert.deepEqual(await forwardFriendRpc(request), {
    jsonrpc: "2.0",
    id: 3,
    result: [log],
  });
});
