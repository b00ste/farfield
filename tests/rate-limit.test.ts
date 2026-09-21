import test from "node:test";
import assert from "node:assert/strict";
import { RequestLimits } from "../server/rate-limit.ts";
test("four rooms behind one proxy can all poll without sharing a player budget", () => {
  const tokens = Array.from({ length: 16 }, (_, i) =>
    i.toString(16).padStart(48, "0"),
  );
  const limits = new RequestLimits((t) => tokens.includes(t));
  for (let request = 0; request < 80; request++)
    for (const token of tokens)
      assert.equal(limits.allow("proxy", token, 1000), true);
  for (let request = 80; request < 120; request++)
    assert.ok(limits.allow("proxy", tokens[0], 1000));
  assert.equal(limits.allow("proxy", tokens[0], 1000), false);
  assert.ok(limits.allow("proxy", tokens[1], 1000));
  assert.ok(limits.allow("proxy", tokens[0], 11000));
});
test("invented bearer tokens cannot bypass anonymous limits", () => {
  const limits = new RequestLimits(() => false);
  for (let i = 0; i < 250; i++)
    assert.ok(limits.allow("proxy", i.toString(16).padStart(48, "0"), 1000));
  assert.equal(limits.allow("proxy", "f".repeat(48), 1000), false);
  assert.ok(limits.allow("another-ip", "", 1000));
  limits.prune(61000);
  assert.ok(limits.allow("proxy", "", 61000));
});
