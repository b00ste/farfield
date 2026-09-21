import { buildGame } from "@rarefriends/friendsdk/build";
import { build } from "esbuild";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { buildPwa } from "./build-pwa.mjs";
const version = randomBytes(8).toString("hex");
const output = "games/farfield/.friendsdk";
const apiOrigin = process.env.PUBLIC_API_ORIGIN || "";
if (apiOrigin) {
  const url = new URL(apiOrigin);
  if (
    !["https:", "http:"].includes(url.protocol) ||
    url.origin !== apiOrigin.replace(/\/$/, "")
  )
    throw new Error(
      "PUBLIC_API_ORIGIN must be an http(s) origin without credentials, path, query or fragment.",
    );
}
// The SDK exclusively owns its output directory. Stage its output separately
// before adding our trusted host and PWA files, so repeat builds stay valid.
const sdkOutput = await mkdtemp(join(tmpdir(), "farfield-sdk-"));
try {
  await buildGame("games/farfield", { outdir: sdkOutput });
  await cp(sdkOutput, output, { recursive: true });
} finally {
  await rm(sdkOutput, { recursive: true, force: true });
}
await buildPwa(output, version);
await build({
  entryPoints: ["host/index.tsx"],
  outfile: `${output}/runtime.js`,
  bundle: true,
  platform: "browser",
  format: "iife",
  target: "es2022",
  jsx: "automatic",
  // wagmi/chains only re-exports viem/chains. Resolve it directly to avoid
  // an esbuild lazy-initialization edge case in RainbowKit's ENS helpers.
  alias: { "wagmi/chains": "viem/chains" },
  minify: true,
  define: {
    __FARFIELD_BUILD__: JSON.stringify(version),
    __FARFIELD_API_ORIGIN__: JSON.stringify(apiOrigin.replace(/\/$/, "")),
    "process.env.NODE_ENV": '"production"',
    __WALLETCONNECT_PROJECT_ID__: JSON.stringify(
      process.env.WALLETCONNECT_PROJECT_ID ??
        "1ef81bdbd6e8e9a585c2e94944ee1f6d",
    ),
  },
});
for (const [source, target] of [
  ["host/index.html", `${output}/index.html`],
  [`${output}/game.html`, `${output}/game.html`],
]) {
  const html = (await readFile(source, "utf8")).replace(
    /(src|href)="(\.\/[^"?]+\.(?:js|css))"/g,
    `$1="$2?v=${version}"`,
  );
  await writeFile(target, html);
}
await build({
  entryPoints: ["server/index.ts"],
  outfile: "dist/server.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
});
await writeFile(
  "dist/build.json",
  JSON.stringify({ version, builtAt: new Date().toISOString() }),
);
console.log(
  "Built the FriendSDK sandbox, trusted multiplayer host, and arena server.",
);
