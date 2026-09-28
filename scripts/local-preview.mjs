import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { chmod, cp, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const repository = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.LOCAL_PREVIEW_PORT || 4180);
if (!Number.isInteger(port) || port < 1024 || port > 65535 || port === 4173)
  throw new Error(
    "LOCAL_PREVIEW_PORT must be 1024–65535, excluding the normal preview port 4173.",
  );
const origin = process.env.LOCAL_PREVIEW_ORIGIN || `http://localhost:${port}`;
const parsedOrigin = new URL(origin);
if (
  parsedOrigin.origin !== origin ||
  !["http:", "https:"].includes(parsedOrigin.protocol)
)
  throw new Error(
    "LOCAL_PREVIEW_ORIGIN must be an HTTP(S) origin without a path, credentials, or trailing slash.",
  );
const smoke = process.argv.includes("--smoke");
if (process.argv.slice(2).some((arg) => arg !== "--smoke"))
  throw new Error("Usage: npm run preview:local [-- --smoke]");
// Detect occupied ports before building or opening either persistent store.
await new Promise((resolve, reject) => {
  const probe = createServer();
  probe.once("error", () =>
    reject(
      new Error(
        `Port ${port} is already in use. Stop that preview or choose LOCAL_PREVIEW_PORT.`,
      ),
    ),
  );
  probe.listen(port, "0.0.0.0", () => probe.close(resolve));
});

// Do not read .env files or inherit production origins, state paths, signing
// keys, or NODE_OPTIONS. Provider configuration is an explicit server-only opt-in.
const commonEnv = {};
for (const key of [
  "PATH",
  "HOME",
  "TMPDIR",
  "TEMP",
  "TMP",
  "SystemRoot",
  "WINDIR",
])
  if (process.env[key] !== undefined) commonEnv[key] = process.env[key];
const state = join(repository, ".farfield", "local-preview", String(port));
await mkdir(state, { recursive: true, mode: 0o700 });
await chmod(state, 0o700);
const staging = await mkdtemp(join(tmpdir(), "farfield-local-preview-"));
let child,
  childDone,
  stopTimer,
  stopRequested = false;
function launch(args, env) {
  child = spawn(process.execPath, args, {
    cwd: staging,
    env,
    stdio: "inherit",
  });
  childDone = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  // Attach a handler immediately while health polling is underway.
  childDone.catch(() => {});
  return childDone;
}
function requestStop() {
  stopRequested = true;
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    stopTimer ??= setTimeout(() => child.kill("SIGKILL"), 30_000);
    stopTimer.unref();
  }
}
process.on("SIGINT", requestStop);
process.on("SIGTERM", requestStop);
try {
  console.log("Building isolated local preview…");
  await Promise.all(
    ["games", "host", "server", "scripts", "package.json"].map((entry) =>
      cp(join(repository, entry), join(staging, entry), {
        recursive: true,
        filter: (path) =>
          ![".friendsdk", ".env", "node_modules"].includes(basename(path)) &&
          !basename(path).startsWith(".env."),
      }),
    ),
  );
  await symlink(
    join(repository, "node_modules"),
    join(staging, "node_modules"),
    "junction",
  );
  if (stopRequested) throw new Error("Preview stopped.");
  const buildEnv = { ...commonEnv, PUBLIC_API_ORIGIN: "" };
  if (process.env.WALLETCONNECT_PROJECT_ID !== undefined)
    buildEnv.WALLETCONNECT_PROJECT_ID = process.env.WALLETCONNECT_PROJECT_ID;
  const built = await launch(["scripts/build.mjs"], buildEnv);
  if (stopRequested) throw new Error("Preview stopped.");
  if (built.code !== 0) throw new Error("Local preview build failed.");
  launch(["dist/server.mjs"], {
    ...commonEnv,
    PORT: String(port),
    GAME_ROOT: join(staging, "games", "farfield", ".friendsdk"),
    FARFIELD_STATE_PATH: join(state, "rooms.json"),
    FARFIELD_RANKINGS_PATH: join(state, "rankings.sqlite"),
    FARFIELD_RANKED_ENABLED: "1",
    FARFIELD_RANKED_ORIGIN: origin,
    FARFIELD_ALLOWED_ORIGINS: origin,
    FRIEND_RPC_URL:
      process.env.FRIEND_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
  });
  const local = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let attempt = 0; attempt < 100 && !stopRequested; attempt++) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error("Local preview server exited before it became ready.");
    try {
      const response = await fetch(`${local}/health`, {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok && (await response.json()).status === "ok") {
        ready = true;
        break;
      }
    } catch {
      /* Startup may not have opened the listening socket yet. */
    }
    await delay(100);
  }
  if (stopRequested) throw new Error("Preview stopped.");
  if (!ready) throw new Error("Local preview health check timed out.");
  const response = await fetch(`${local}/api/ranked/config`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: "{}",
    signal: AbortSignal.timeout(5000),
  });
  const config = await response.json();
  if (!response.ok || config.enabled !== true || config.season !== "Preseason")
    throw new Error("Local preview ranked configuration check failed.");
  console.log(`Local ranked preview ready: ${origin}`);
  console.log(`Private local saves: ${state}`);
  console.log(
    "No production ratings or matches are used. Ctrl+C saves and stops; rerun after source edits.",
  );
  if (smoke) {
    console.log("Smoke check passed: health OK and ranked Preseason enabled.");
    requestStop();
  }
  const stopped = await childDone;
  if (stopped.code !== 0) {
    console.error("Local preview server did not shut down cleanly.");
    process.exitCode = 1;
  }
} catch (error) {
  if (!stopRequested) {
    console.error(error.message);
    process.exitCode = 1;
  }
} finally {
  requestStop();
  if (child && child.exitCode === null && child.signalCode === null) {
    try {
      await childDone;
    } catch {
      /* Spawn failure is already reported. */
    }
  }
  clearTimeout(stopTimer);
  // Only our unique temporary build is removed. Persistent local saves stay.
  await rm(staging, { recursive: true, force: true });
  process.off("SIGINT", requestStop);
  process.off("SIGTERM", requestStop);
}
