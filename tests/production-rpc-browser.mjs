// Browser Testing only. No wallet, RPC fixtures, route overrides, or signing.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import {
  encodeFunctionData,
  decodeFunctionResult,
  parseAbi,
  isAddress,
  createPublicClient,
  http,
} from "viem";
import { readOwnedFriends } from "@rarefriends/friendsdk/owned";
import { mkdir, writeFile } from "node:fs/promises";
const origin = process.env.TEST_URL || "https://farfield.fun";
const apiOrigin = new URL(
  process.env.TEST_API_URL || "https://api.farfield.fun",
).origin;
const collection = "0x14c49e6118f46525de9ab41a51cbaa3c6ebf181d";
const registry = "0x246e3e9730a7eade94c79be0fd78d210f89aeb8d";
const abi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function generation(uint256 tokenId) view returns (uint8)",
  "function familyOf(uint256 tokenId) pure returns (uint8)",
  "function seedOf(uint256 tokenId) pure returns (uint32)",
  "function frames(uint8 id, uint32 seed) view returns (uint256[64])",
]);
const privateMarkers = /alch_|robinhood-mainnet\.g\.alchemy\.com/i;
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox"],
});
const report = {
  checkedAt: new Date().toISOString(),
  frontend: origin,
  api: apiOrigin,
  assets: [],
  sourceMaps: [],
  privateFileRoutes: [],
  rpc: {},
  directAlchemyRequests: 0,
  privateMarkerLeaks: 0,
};
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: false });
  const page = await context.newPage();
  const pending = [];
  const assetUrls = new Set();
  page.on("request", (request) => {
    if (/alchemy\.com/i.test(new URL(request.url()).hostname))
      report.directAlchemyRequests++;
  });
  page.on("response", (response) => {
    if (new URL(response.url()).origin !== new URL(origin).origin) return;
    const type = response.headers()["content-type"] || "";
    if (!/javascript|text\/html|text\/css/.test(type)) return;
    pending.push(
      (async () => {
        const text = await response.text();
        if (privateMarkers.test(text)) report.privateMarkerLeaks++;
        assetUrls.add(response.url());
        report.assets.push({
          path: new URL(response.url()).pathname,
          status: response.status(),
          bytes: text.length,
          markerFree: !privateMarkers.test(text),
        });
      })(),
    );
  });
  const response = await page.goto(origin, { waitUntil: "networkidle" });
  assert.equal(response.status(), 200);
  const runtime = await page
    .locator("script[src*='runtime.js']")
    .getAttribute("src");
  report.build = new URL(runtime, origin).searchParams.get("v");
  await Promise.all(pending);
  // Probe conventional map routes; scan any body actually served, including SPA fallback.
  for (const url of [...assetUrls].filter((url) =>
    /\.(js|css)(\?|$)/.test(url),
  )) {
    const map = new URL(url);
    map.pathname += ".map";
    const result = await page.request.get(map.href);
    const text = await result.text();
    const markerFree = !privateMarkers.test(text);
    if (!markerFree) report.privateMarkerLeaks++;
    report.sourceMaps.push({
      path: map.pathname,
      status: result.status(),
      markerFree,
      contentType: result.headers()["content-type"],
    });
  }
  for (const base of [origin, apiOrigin]) {
    for (const path of ["/.env", "/runtime.env"]) {
      const response = await page.request.get(new URL(path, base).href);
      const text = await response.text();
      assert.equal(
        privateMarkers.test(text),
        false,
        "private file route response is sanitized",
      );
      assert.equal(
        response.status(),
        404,
        "private runtime files are outside public web roots",
      );
      report.privateFileRoutes.push({
        origin: base,
        path,
        status: response.status(),
      });
    }
  }
  let nextId = 1;
  const read = (name, args, to = collection) => ({
    jsonrpc: "2.0",
    id: nextId++,
    method: "eth_call",
    params: [
      { to, data: encodeFunctionData({ abi, functionName: name, args }) },
      "latest",
    ],
  });
  const call = async (payload) => {
    const answer = await page.evaluate(
      async ({ url, payload }) => {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });
        return { status: response.status, text: await response.text() };
      },
      { url: apiOrigin + "/api/friend-rpc", payload },
    );
    assert.equal(
      privateMarkers.test(answer.text),
      false,
      "RPC response does not expose private endpoint markers",
    );
    assert.equal(answer.status, 200, "real proxy RPC read succeeds");
    return JSON.parse(answer.text);
  };
  const payload = [
    { jsonrpc: "2.0", id: nextId++, method: "eth_chainId", params: [] },
    read("ownerOf", [20841n]),
    read("generation", [20841n]),
    read("familyOf", [20841n], registry),
    read("seedOf", [20841n], registry),
  ];
  const replies = await call(payload);
  assert.equal(replies.length, payload.length);
  const results = payload.map((request) => {
    const reply = replies.find((reply) => reply.id === request.id);
    assert.ok(reply && !reply.error, "known Friend RPC returns a result");
    assert.deepEqual(Object.keys(reply).sort(), ["id", "jsonrpc", "result"]);
    return reply.result;
  });
  report.rpc.chainId = Number(BigInt(results[0]));
  assert.equal(report.rpc.chainId, 4663);
  const owner = decodeFunctionResult({
    abi,
    functionName: "ownerOf",
    data: results[1],
  });
  assert.ok(isAddress(owner));
  report.rpc.ownerRead = true;
  // Run the actual SDK discovery algorithm, preserving its production batching.
  // Transport executes fetch in the real frontend browser origin so CORS applies.
  const historyRequests = [];
  const client = createPublicClient({
    cacheTime: 0,
    transport: http(apiOrigin + "/api/friend-rpc", {
      batch: { wait: 50, batchSize: 50 },
      retryCount: 0,
      fetchFn: async (_url, init) => {
        const body = JSON.parse(init.body);
        for (const request of Array.isArray(body) ? body : [body]) {
          if (request.method === "eth_getLogs")
            historyRequests.push({
              fromBlock: request.params[0].fromBlock,
              toBlock: request.params[0].toBlock,
              ownerFiltered: request.params[0].topics.some(
                (topic) =>
                  typeof topic === "string" &&
                  topic.toLowerCase().endsWith(owner.slice(2).toLowerCase()),
              ),
            });
        }
        const reply = await page.evaluate(
          async ({ url, body }) => {
            const response = await fetch(url, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body,
            });
            return { status: response.status, text: await response.text() };
          },
          { url: apiOrigin + "/api/friend-rpc", body: init.body },
        );
        assert.equal(
          privateMarkers.test(reply.text),
          false,
          "discovery response has no private endpoint markers",
        );
        return new Response(reply.text, {
          status: reply.status,
          headers: { "content-type": "application/json" },
        });
      },
    }),
  });
  const owned = await readOwnedFriends(client, owner);
  assert.ok(
    owned.friends.some((friend) => friend.id === 20841n),
    "actual SDK discovery includes the known owned Friend",
  );
  assert.equal(historyRequests.length, 2);
  assert.ok(
    historyRequests.every(
      (request) => request.fromBlock === "0x0" && request.ownerFiltered,
    ),
  );
  report.rpc.discovery = {
    friends: owned.friends.length,
    hidden: owned.hiddenCount,
    blockNumber: String(owned.blockNumber),
    historyRequests,
  };

  report.rpc.generation = Number(
    decodeFunctionResult({ abi, functionName: "generation", data: results[2] }),
  );
  const family = decodeFunctionResult({
    abi,
    functionName: "familyOf",
    data: results[3],
  });
  const seed = decodeFunctionResult({
    abi,
    functionName: "seedOf",
    data: results[4],
  });
  report.rpc.family = Number(family);
  report.rpc.seedRead = true;
  const frameReply = await call(read("frames", [family, seed], registry));
  assert.ok(!frameReply.error, "canonical frames read succeeds");
  const frames = decodeFunctionResult({
    abi,
    functionName: "frames",
    data: frameReply.result,
  });
  assert.equal(frames.length, 64);
  assert.ok(frames.some((frame) => frame !== 0n));
  report.rpc.frameWords = frames.length;
  const failure = await call(read("ownerOf", [2n ** 255n]));
  assert.ok(failure.error, "nonexistent Friend produces an RPC error");
  assert.deepEqual(Object.keys(failure).sort(), ["error", "id", "jsonrpc"]);
  assert.deepEqual(Object.keys(failure.error).sort(), ["code", "message"]);
  assert.equal(failure.error.message, "Friend RPC read failed. Retry shortly.");
  report.rpc.providerErrorSanitized = true;
  assert.equal(report.directAlchemyRequests, 0);
  assert.equal(report.privateMarkerLeaks, 0);
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/production-rpc.json",
    JSON.stringify(report, null, 2),
  );
  console.log("PASS private RPC browser validation", JSON.stringify(report));
} finally {
  await browser.close();
}
