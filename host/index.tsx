import "./storage-fallback";
import "./pwa-register";
import { saveSeat, clearSeat } from "./session";
import { apiUrl } from "./api";
import { relayRoomStream } from "./room-stream";
import { createRoot } from "react-dom/client";
import { WalletApp, walletUi, spriteReader } from "./wallet-host";
import "@rarefriends/friendsdk/frame.css";
import "@rarefriends/friendsdk/runtime.css";
import "../games/farfield/host.css";

// A bounded multiplayer transport in the trusted host. Coder's public proxy strips
// opaque-origin CORS headers, so the sandbox uses a private reply port instead.
// This does not replace, intercept, or extend the SDK's identity/action bridge.
const actions = new Set([
  "create",
  "join",
  "sync",
  "subscribe",
  "command",
  "art",
  "setup",
  "home",
  "matchmake",
  "leave",
  "preferences",
  "wallet",
]);
let inFlight = 0;
let stopStream: (() => void) | undefined;
window.addEventListener("pagehide", () => stopStream?.());
window.addEventListener("farfield-home", () => stopStream?.());
window.addEventListener("message", async (event) => {
  const frame = document.querySelector<HTMLIFrameElement>(
    ".rf-frame-viewport iframe",
  );
  const data = event.data;
  if (
    !frame ||
    event.source !== frame.contentWindow ||
    event.origin !== "null" ||
    data?.channel !== "farfield-room-v1"
  )
    return;
  const port = event.ports[0];
  if (!port) return;
  if (
    !actions.has(data.action) ||
    typeof data.token !== "string" ||
    data.token.length > 64 ||
    !data.body ||
    typeof data.body !== "object" ||
    inFlight >= 8
  ) {
    port.postMessage({ error: "Invalid station request." });
    port.close();
    return;
  }
  if (walletUi.blocked && !["sync", "subscribe"].includes(data.action)) {
    port.postMessage({ error: "Close the wallet menu before playing." });
    port.close();
    return;
  }
  if (walletUi.blocked && data.action === "sync")
    data.body = { ...data.body, active: false };
  let body: string;
  try {
    body = JSON.stringify(data.body);
    if (body.length > 2048) throw new Error();
  } catch {
    port.postMessage({ error: "Station request is too large." });
    port.close();
    return;
  }
  if (data.action === "subscribe") {
    if (
      typeof data.body.code !== "string" ||
      !/^[A-F0-9]{10}$/.test(data.body.code)
    ) {
      port.postMessage({ error: "Invalid station code." });
      port.close();
      return;
    }
    stopStream?.();
    stopStream = relayRoomStream(
      port,
      data.token,
      data.body.code,
      data.body.active === true,
      () =>
        document.querySelector<HTMLIFrameElement>(".rf-frame-viewport iframe")
          ?.contentWindow === event.source,
      () => walletUi.blocked,
    );
    return;
  }
  inFlight++;
  try {
    if (data.action === "wallet") {
      port.postMessage({ result: { ok: true } });
      window.dispatchEvent(new Event("farfield-wallet"));
      return;
    }
    if (data.action === "setup") {
      port.postMessage({ result: walletUi.launch });
      return;
    }
    if (data.action === "home") {
      clearSeat();
      port.postMessage({ result: { ok: true } });
      window.dispatchEvent(new Event("farfield-home"));
      return;
    }
    if (data.action === "preferences") {
      localStorage.setItem(
        "farfield-preferences",
        JSON.stringify({
          dock: ["left", "right", "bottom"].includes(data.body.dock)
            ? data.body.dock
            : (JSON.parse(localStorage.getItem("farfield-preferences") || "{}")
                .dock ?? "bottom"),
          muted: data.body.muted !== false,
          reduced: data.body.reduced === true,
        }),
      );
      port.postMessage({ result: { ok: true } });
      return;
    }
    if (data.action === "art") {
      if (data.body.friendId !== walletUi.friendId)
        throw new Error("Choose your Friend first.");
      const art = await spriteReader.read(BigInt(data.body.friendId));
      if (
        document.querySelector<HTMLIFrameElement>(".rf-frame-viewport iframe")
          ?.contentWindow === event.source
      )
        port.postMessage({
          result: {
            rows: art.clips.idle[art.familyId === 6 ? "right" : "down"][0].rows,
            animation: {
              familyId: art.familyId,
              clips: Object.fromEntries(
                Object.entries(art.clips).map(([kind, directions]) => [
                  kind,
                  Object.fromEntries(
                    Object.entries(directions).map(([facing, frames]) => [
                      facing,
                      frames.map((frame) => frame.rows),
                    ]),
                  ),
                ]),
              ),
            },
          },
        });
      return;
    }
    // Authentication capabilities remain in the trusted host. The sandbox only
    // receives the separate seat token after matchmaking succeeds.
    const bearer = data.action === "matchmake" ? walletUi.rankedToken?.() : data.token;
    if (data.action === "matchmake" && data.body.friendId !== walletUi.friendId)
      throw new Error("Choose your Friend again before matchmaking.");
    const response = await fetch(apiUrl(`/api/${data.action}`), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {}),
      },
      body,
      signal: AbortSignal.timeout(8000),
    });
    const result = await response.json();
    if (!response.ok && data.action === "matchmake" && bearer)
      walletUi.invalidateRanked?.();
    // Discard responses to a frame replaced by an account/network/Friend change.
    if (
      document.querySelector<HTMLIFrameElement>(".rf-frame-viewport iframe")
        ?.contentWindow !== event.source
    )
      return;
    if (
      response.ok &&
      ["create", "join", "matchmake"].includes(data.action) &&
      result.token &&
      walletUi.launch &&
      walletUi.account &&
      walletUi.friendId
    )
      saveSeat({
        code: result.code,
        token: result.token,
        friendId: walletUi.friendId,
        account: walletUi.account,
        chainId: walletUi.chainId!,
        launch: { ...walletUi.launch },
      });
    if (response.ok && data.action === "leave") clearSeat();
    port.postMessage(
      response.ok
        ? { result }
        : { error: result.error || "Station request failed." },
    );
  } catch (error) {
    port.postMessage({
      error:
        error instanceof Error ? error.message : "Station connection failed.",
    });
  } finally {
    inFlight--;
    port.close();
  }
});
createRoot(document.getElementById("root")!).render(<WalletApp />);
