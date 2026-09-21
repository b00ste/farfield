import assert from "node:assert/strict";
import test from "node:test";
import { apiUrl } from "../host/api.ts";
import { allowedOrigins, corsOrigin } from "../server/cors.ts";

test("all API paths resolve on the configured backend while local hosting stays same-origin", () => {
  for (const path of [
    "/api/events",
    "/api/sync",
    "/api/command",
    "/api/friend-rpc",
    "/api/wager/config",
  ]) {
    assert.equal(
      apiUrl(path, "https://api.farfield.fun", "https://farfield.fun"),
      `https://api.farfield.fun${path}`,
    );
    assert.equal(
      apiUrl(path, "", "http://localhost:4173"),
      `http://localhost:4173${path}`,
    );
  }
  for (const path of [
    "https://other.example/api/command",
    "//other.example/api/command",
    "/api/../secret",
  ])
    assert.throws(
      () => apiUrl(path, "https://api.farfield.fun"),
      /Invalid API path/,
    );
});

test("split deployment accepts exact game origins, rejects lookalikes and preserves capability-only CLI access", () => {
  const origins = allowedOrigins(
    "https://farfield.fun,https://staging.example.com",
  );
  assert.equal(
    corsOrigin("https://farfield.fun", origins),
    "https://farfield.fun",
  );
  assert.equal(
    corsOrigin("https://farfield.fun.attacker.example", origins),
    null,
  );
  assert.equal(corsOrigin("null", origins), null);
  assert.equal(corsOrigin(undefined, origins), null);
  assert.equal(corsOrigin("http://localhost:4173", allowedOrigins()), "*");
  for (const value of [
    "https://farfield.fun/path",
    "https://user:pass@farfield.fun",
    "*",
  ])
    assert.throws(() => allowedOrigins(value));
});
