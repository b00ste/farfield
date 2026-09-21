// Browser Testing only. No routes or wallet fixtures: exercise actual browser CORS.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
const origin = process.env.TEST_URL || "http://127.0.0.1:4173";
const apiOrigin = new URL(process.env.TEST_API_URL || origin).origin;
assert.notEqual(
  new URL(origin).origin,
  apiOrigin,
  "CORS test requires separate frontend and API origins",
);
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--no-sandbox"],
});
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(origin, { waitUntil: "domcontentloaded" });
  const probe = async (url) => {
    try {
      const response = await fetch(url + "/api/wager/config", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer cross-origin-probe",
        },
        body: "{}",
      });
      return {
        readable: true,
        status: response.status,
        json: await response.json(),
      };
    } catch (error) {
      return { readable: false, error: error.name };
    }
  };
  const allowed = await page.evaluate(probe, apiOrigin);
  assert.equal(
    allowed.readable,
    true,
    "allowed frontend can read actual API responses",
  );
  assert.equal(
    allowed.status,
    200,
    "JSON and Authorization preflight succeeds",
  );
  const opaquePage = await context.newPage();
  const denied = await opaquePage.evaluate(probe, apiOrigin);
  assert.equal(
    denied.readable,
    false,
    "unapproved opaque origin cannot read API responses",
  );
  const report = { frontend: origin, api: apiOrigin, allowed, denied };
  await mkdir("artifacts", { recursive: true });
  await writeFile("artifacts/api-cors.json", JSON.stringify(report, null, 2));
  console.log("PASS real browser CORS", JSON.stringify(report));
} finally {
  await browser.close();
}
