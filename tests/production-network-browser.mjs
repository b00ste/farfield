// Browser Testing only: normal public DNS and strict browser TLS, no fixtures/routes.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const origin = process.env.TEST_URL || "https://farfield.fun";
const apiOrigin = new URL(
  process.env.TEST_API_URL || "https://api.farfield.fun",
).origin;
assert.equal(new URL(origin).protocol, "https:");
assert.equal(new URL(apiOrigin).protocol, "https:");
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const context = await browser.newContext({ ignoreHTTPSErrors: false });
  const frontend = await context.newPage();
  const response = await frontend.goto(origin, {
    waitUntil: "domcontentloaded",
  });
  assert.equal(response.status(), 200, "public frontend returns HTTP 200");
  const runtime = await frontend
    .locator("script[src*='runtime.js']")
    .getAttribute("src");
  const build = new URL(runtime, origin).searchParams.get("v");
  assert.match(
    build || "",
    /^[a-f0-9]{16}$/,
    "frontend identifies the compiled release",
  );
  const frontendTls = await response.securityDetails();
  assert.ok(
    frontendTls?.protocol.startsWith("TLS"),
    "frontend is served over verified TLS",
  );
  const api = await context.newPage();
  const healthResponse = await api.goto(apiOrigin + "/health");
  assert.equal(
    healthResponse.status(),
    200,
    "public API health returns HTTP 200",
  );
  const health = await healthResponse.json();
  assert.equal(health.status, "ok");
  const apiTls = await healthResponse.securityDetails();
  assert.ok(
    apiTls?.protocol.startsWith("TLS"),
    "API is served over verified TLS",
  );
  const report = {
    checkedAt: new Date().toISOString(),
    build,
    frontend: {
      url: frontend.url(),
      status: response.status(),
      tls: frontendTls,
    },
    api: {
      url: api.url(),
      status: healthResponse.status(),
      health,
      tls: apiTls,
    },
    dnsOverride: false,
    ignoredCertificateErrors: false,
  };
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/production-network.json",
    JSON.stringify(report, null, 2),
  );
  console.log("PASS public HTTPS release", JSON.stringify(report));
} finally {
  await browser.close();
}
