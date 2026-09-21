// Automation-only adapter: same-origin RPC reads use the upstream SDK fixture.
import {
  installFixture as installSdkFixture,
  createArtworkFixture as createSdkArtworkFixture,
} from "../node_modules/@rarefriends/friendsdk/scripts/browser-fixture.mjs";
import { decodeFunctionData, encodeFunctionData } from "viem";
import { FAMILIES_REGISTRY_ABI } from "@rarefriends/friendsdk/sprites";
export {
  assertBounds,
  SECOND_OWNER,
} from "../node_modules/@rarefriends/friendsdk/scripts/browser-fixture.mjs";
export async function createArtworkFixture() {
  const answer = await createSdkArtworkFixture();
  return (call) => {
    const { functionName, args } = decodeFunctionData({
      abi: FAMILIES_REGISTRY_ABI,
      data: call.data,
    });
    if (["familyOf", "seedOf"].includes(functionName) && args[0] === 3412n)
      return answer({
        ...call,
        data: encodeFunctionData({
          abi: FAMILIES_REGISTRY_ABI,
          functionName,
          args: [7730n],
        }),
      });
    return answer(call);
  };
}
export async function installFixture(page, origin, options = {}) {
  const apiOrigin = new URL(process.env.TEST_API_URL || origin).origin;
  const fixture = await installSdkFixture(page, origin, {
    artworkCall: await createArtworkFixture(),
    ...options,
  });
  // Allow only this test's actual game API through the SDK's external-service
  // guard. Do not mock its responses or CORS: the browser must enforce both.
  if (apiOrigin !== new URL(origin).origin)
    await page.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.origin === apiOrigin &&
        url.pathname.startsWith("/api/") &&
        url.pathname !== "/api/friend-rpc"
        ? route.continue()
        : route.fallback();
    });
  await page.route("**/api/friend-rpc", (route) => {
    // Only wallet/artwork RPC is simulated. The preflight below belongs to that
    // fixture endpoint, never to multiplayer, commands, or the event stream.
    if (route.request().method() === "OPTIONS")
      return route.fulfill({
        status: 204,
        headers: {
          "access-control-allow-origin": new URL(origin).origin,
          "access-control-allow-methods": "POST, OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    const body =
      route.request().method() === "POST"
        ? route.request().postDataJSON()
        : null;
    if (body?.method === "eth_getBalance")
      return route.fulfill({
        headers: { "access-control-allow-origin": new URL(origin).origin },
        json: { id: body.id, jsonrpc: "2.0", result: "0x0" },
      });
    return route.fallback({ url: "https://rpc.mainnet.chain.robinhood.com/" });
  });
  return fixture;
}
