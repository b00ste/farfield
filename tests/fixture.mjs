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
  const fixture = await installSdkFixture(page, origin, {
    artworkCall: await createArtworkFixture(),
    ...options,
  });
  await page.route("**/api/friend-rpc", (route) => {
    const body =
      route.request().method() === "POST"
        ? route.request().postDataJSON()
        : null;
    if (body?.method === "eth_getBalance")
      return route.fulfill({
        json: { id: body.id, jsonrpc: "2.0", result: "0x0" },
      });
    return route.fallback({ url: "https://rpc.mainnet.chain.robinhood.com/" });
  });
  return fixture;
}
