import { apiUrl } from "./api.ts";

/** Parses bounded SSE frames, including UTF-8 and line breaks split across reads. */
export class RoomEventParser {
  private buffer = "";
  push(chunk: string): unknown[] {
    this.buffer += chunk;
    if (this.buffer.length > 4 * 1024 * 1024)
      throw new Error("Station update is too large.");
    const events: unknown[] = [];
    let match: RegExpExecArray | null;
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      const frame = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      const data = frame
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).replace(/^ /, ""))
        .join("\n");
      if (data) events.push(JSON.parse(data));
    }
    return events;
  }
}

/** One fetch stream per game frame; commands still use the bounded HTTP relay. */
export function relayRoomStream(
  port: MessagePort,
  token: string,
  code: string,
  initialActive: boolean,
  current: () => boolean,
  blocked: () => boolean,
): () => void {
  const controller = new AbortController();
  let ended = false;
  let requestedActive = initialActive;
  let sentActive = initialActive && !blocked() && !document.hidden;
  let updating = false;
  let connected = false;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
  const stop = () => {
    if (ended) return;
    ended = true;
    clearInterval(watch);
    controller.abort();
    port.close();
  };
  const fail = (message: string) => {
    if (!ended && current()) port.postMessage({ error: message });
    stop();
  };
  // A presence request only when the game/menu visibility changes, never a polling loop.
  const presence = async () => {
    if (ended || updating || !connected) return;
    const active = requestedActive && !blocked() && !document.hidden;
    if (active === sentActive) return;
    updating = true;
    try {
      const response = await fetch(apiUrl("/api/sync"), {
        method: "POST",
        headers,
        body: JSON.stringify({ code, active }),
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
      });
      if (!response.ok) throw new Error("Could not update station presence.");
      await response.body?.cancel();
      sentActive = active;
    } catch {
      if (!ended) fail("Station connection interrupted.");
    } finally {
      updating = false;
    }
  };
  const watch = setInterval(() => {
    if (!current()) stop();
    else void presence();
  }, 250);
  port.onmessage = (event) => {
    if (event.data?.cancel) stop();
    else if (typeof event.data?.active === "boolean") {
      requestedActive = event.data.active;
      void presence();
    }
  };
  port.onmessageerror = () => fail("Invalid station subscription.");
  void (async () => {
    try {
      const response = await fetch(apiUrl("/api/events"), {
        method: "POST",
        headers,
        body: JSON.stringify({ code, active: sentActive }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const error = await response.json().catch(() => null);
        throw new Error(error?.error || "Station connection interrupted.");
      }
      if (!response.body) throw new Error("Station stream unavailable.");
      connected = true;
      void presence();
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new RoomEventParser();
      while (!ended) {
        const { done, value } = await reader.read();
        if (done) throw new Error("Station connection interrupted.");
        if (!current()) {
          stop();
          break;
        }
        port.postMessage({ alive: true });
        for (const result of parser.push(
          decoder.decode(value, { stream: true }),
        )) {
          if (result && typeof result === "object" && "error" in result)
            throw new Error(String(result.error));
          port.postMessage({ result });
        }
      }
    } catch (error) {
      if (!ended)
        fail(
          error instanceof Error
            ? error.message
            : "Station connection interrupted.",
        );
    }
  })();
  return stop;
}
