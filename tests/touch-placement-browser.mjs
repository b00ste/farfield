// Browser Testing only. Real CDP touch/pen input and real game commands; wallet reads are fixtures.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { installFixture } from "./fixture.mjs";
import { observeRoom } from "./room-observer.mjs";
import { placementError } from "../games/farfield/engine.ts";
const origin = process.env.TEST_URL || "http://127.0.0.1:4180",
  apiOrigin = new URL(process.env.TEST_API_URL || origin).origin;
const report = { origin, apiOrigin, checks: [], errors: [] };
const browser = await chromium.launch({
  channel: "chrome",
  args: ["--no-sandbox"],
});
await mkdir("artifacts", { recursive: true });
try {
  for (const profile of [
    { name: "ipad", width: 1024, height: 1366 },
    { name: "ipad-landscape", width: 1024, height: 768 },
    { name: "iphone", width: 390, height: 844 },
    { name: "phone320", width: 320, height: 568 },
    { name: "submission", width: 852, height: 393, submission: true },
    { name: "desktop", width: 1440, height: 900, desktop: true },
  ].filter(
    (p) => !process.env.TEST_PROFILE || p.name === process.env.TEST_PROFILE,
  )) {
    const ctx = await browser.newContext({
      viewport: { width: profile.width, height: profile.height },
      hasTouch: !profile.desktop,
      isMobile: !profile.desktop,
      deviceScaleFactor: 2,
    });
    const page = await ctx.newPage();
    page.setDefaultTimeout(15000);
    await installFixture(page, origin);
    let latest, token;
    const commands = [];
    await observeRoom(page, (v) => {
      if (!latest || v.revision >= latest.revision) latest = v;
      if (v.token) token = v.token;
    });
    page.on("pageerror", (e) =>
      report.errors.push({ profile: profile.name, message: e.message }),
    );
    page.on("request", (r) => {
      if (r.method() === "POST" && new URL(r.url()).pathname === "/api/command")
        commands.push(r.postDataJSON().command);
    });
    const wait = async (fn, label) => {
      for (let i = 0; i < 150; i++) {
        if (await fn()) return;
        await page.waitForTimeout(100);
      }
      throw Error(profile.name + ": " + label);
    };
    await page.goto(origin + (profile.submission ? "/?submission=1" : ""));
    await page
      .getByRole("button", { name: "Connect wallet", exact: true })
      .first()
      .click();
    await page.getByRole("button", { name: /Browser Wallet/ }).click();
    await page.getByRole("button", { name: /Friends & AI/ }).click();
    await page
      .getByRole("button", { name: "Enter sector →", exact: true })
      .click();
    const iframe = page.locator("iframe"),
      frame = await (await iframe.elementHandle()).contentFrame();
    const game = page.frameLocator("iframe"),
      canvas = game.locator("canvas"),
      cdp = await ctx.newCDPSession(page);
    const touch = async (type, points) =>
      cdp.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: points.map((p, id) => ({
          ...p,
          id: p.id ?? id,
          radiusX: 2,
          radiusY: 2,
          force: 1,
        })),
      });
    const metrics = async () => ({
      outer: await iframe.boundingBox(),
      inner: await frame.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
      })),
    });
    const topPoint = async (p) => {
      const { outer, inner } = await metrics();
      return {
        x: outer.x + (p.x * outer.width) / inner.width,
        y: outer.y + (p.y * outer.height) / inner.height,
      };
    };
    const ui = async (name) => {
      await page.waitForTimeout(500);
      const button = game.getByRole("button", { name, exact: true });
      await button.waitFor();
      await wait(() => button.isEnabled(), name + " enabled");
      const box = await button.evaluate((e) => {
          const r = e.getBoundingClientRect();
          return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
        }),
        p = await topPoint(box);
      if (profile.desktop || profile.submission)
        await page.mouse.click(p.x, p.y);
      else {
        await touch("touchStart", [p]);
        await page.waitForTimeout(70);
        await touch("touchEnd", []);
      }
      await page.waitForTimeout(350);
    };
    await ui("Begin match →");
    await wait(() => latest?.state.phase === "playing", "match ready");
    const ghost = async () => {
      const text = await game.locator(".map-coordinates").textContent();
      const m = text.match(/X\s+(-?\d+)\s*·\s*Y\s+(-?\d+)/);
      return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
    };
    // Core color is unique in an empty station. Track its rendered bounding box,
    // independently of preview coordinates, to detect accidental camera movement.
    const core = async () =>
      canvas.evaluate((el) => {
        const ctx = el.getContext("2d"),
          { data } = ctx.getImageData(0, 0, el.width, el.height),
          r = el.getBoundingClientRect();
        let x0 = Infinity,
          y0 = Infinity,
          x1 = -1,
          y1 = -1;
        for (let y = 0; y < el.height; y += 2)
          for (let x = 0; x < el.width; x += 2) {
            const i = (y * el.width + x) * 4,
              a = data[i],
              b = data[i + 1],
              c = data[i + 2];
            if (
              a > 210 &&
              b > 205 &&
              a > b + 2 &&
              a - b < 18 &&
              c > 170 &&
              c < b - 12
            ) {
              x0 = Math.min(x0, x);
              x1 = Math.max(x1, x);
              y0 = Math.min(y0, y);
              y1 = Math.max(y1, y);
            }
          }
        if (x1 < 0) throw Error("Core pixels missing");
        return {
          x: r.left + (((x0 + x1) / 2) * r.width) / el.width,
          y: r.top + (((y0 + y1) / 2) * r.height) / el.height,
        };
      });
    const zoom = async () =>
      Number(
        (await game.locator(".map-controls span").innerText()).replace("%", ""),
      ) / 100;
    const world = async (p) => {
      const center = await core(),
        z = await zoom();
      const cells = latest.state.modules.find((m) => m.type === "core").cells;
      const x = cells.reduce((sum, c) => sum + c.x + 0.5, 0) / cells.length,
        y = cells.reduce((sum, c) => sum + c.y + 0.5, 0) / cells.length;
      return topPoint({
        x: center.x + (p.x + 0.5 - x) * 24 * z,
        y: center.y + (p.y + 0.5 - y) * 24 * z,
      });
    };
    const drag = async (start, delta, end = "touchEnd") => {
      await touch("touchStart", [start]);
      for (let i = 1; i <= 6; i++) {
        await touch("touchMove", [
          { x: start.x + (delta.x * i) / 6, y: start.y + (delta.y * i) / 6 },
        ]);
        await page.waitForTimeout(20);
      }
      await touch(end, []);
      await page.waitForTimeout(100);
    };
    const select = async () => {
      await ui("Open build panel");
      await ui("O shape");
      await ui("Build Foundry");
      await wait(
        () => ghost(),
        "preview exists immediately without map hover/tap",
      );
    };
    await select();
    const initial = await ghost(),
      cameraBefore = await core(),
      initialCommands = commands.length;
    assert.ok(initial, "preview appears at selection");
    if (!profile.desktop) {
      const { outer, inner } = await metrics(),
        scale = outer.width / inner.width,
        tile = 24 * (await zoom()) * scale;
      const dx = initial.x < latest.state.spawn.x ? -2 : 2;
      const dy = initial.y < latest.state.spawn.y ? -1 : 1;
      const start = await world({ x: initial.x + 1, y: initial.y });
      await drag(start, { x: dx * tile, y: dy * tile });
      assert.deepEqual(
        await ghost(),
        { x: initial.x + dx, y: initial.y + dy },
        "drag preserves grabbed-cell offset and moves preview",
      );
      const after = await core();
      assert.ok(
        Math.abs(after.x - cameraBefore.x) < 2 &&
          Math.abs(after.y - cameraBefore.y) < 2,
        `dragging preview never pans camera (${JSON.stringify({ cameraBefore, after })})`,
      );
      assert.equal(
        commands.length,
        initialCommands,
        "preview drag release issues no command",
      );
      const current = await ghost();
      await drag(await world(current), { x: tile, y: 0 }, "touchCancel");
      assert.equal(
        commands.length,
        initialCommands,
        "cancelled gesture issues no command",
      );
      const ghostBeforePan = await ghost(),
        panBefore = await core();
      const blank = await world({
        x: latest.state.spawn.x - 5,
        y: latest.state.spawn.y - 4,
      });
      await drag(blank, { x: 30 * scale, y: 20 * scale });
      const panAfter = await core();
      assert.ok(
        Math.abs(panAfter.x - panBefore.x - 30) < 3 &&
          Math.abs(panAfter.y - panBefore.y - 20) < 3,
        "blank-space drag pans the level",
      );
      assert.deepEqual(
        await ghost(),
        ghostBeforePan,
        "panning does not reposition preview",
      );
      await ui("Center station");
      const blankPinch = await world(await ghost()),
        z0 = await zoom();
      await touch("touchStart", [{ x: blankPinch.x, y: blankPinch.y }]);
      await touch("touchStart", [
        { x: blankPinch.x, y: blankPinch.y },
        { x: blankPinch.x + 30, y: blankPinch.y },
      ]);
      for (let i = 1; i <= 4; i++)
        await touch("touchMove", [
          { x: blankPinch.x - i * 4, y: blankPinch.y },
          { x: blankPinch.x + 30 + i * 4, y: blankPinch.y },
        ]);
      await touch("touchEnd", [
        { x: blankPinch.x + 46, y: blankPinch.y, id: 1 },
      ]);
      await touch("touchMove", [
        { x: blankPinch.x + 50, y: blankPinch.y, id: 1 },
      ]);
      await touch("touchEnd", []);
      assert.ok(
        (await zoom()) > z0,
        "pinch zoom remains available during placement",
      );
      assert.equal(
        commands.length,
        initialCommands,
        "pinch and lifted finger never place",
      );
      await ui("Center station");
      if (profile.name === "ipad") {
        const before = await ghost(),
          p = await world(before),
          coreBefore = await core(),
          tile = 24 * (await zoom());
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: p.x,
          y: p.y,
          button: "left",
          buttons: 1,
          clickCount: 1,
          pointerType: "pen",
        });
        await page.waitForTimeout(60);
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x: p.x + tile,
          y: p.y,
          button: "left",
          buttons: 1,
          pointerType: "pen",
        });
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: p.x + tile,
          y: p.y,
          button: "left",
          buttons: 0,
          clickCount: 1,
          pointerType: "pen",
        });
        await page.waitForTimeout(120);
        assert.deepEqual(
          await ghost(),
          { x: before.x + 1, y: before.y },
          "pen drag repositions preview",
        );
        const after = await core();
        assert.ok(
          Math.abs(after.x - coreBefore.x) < 2,
          "pen drag does not pan",
        );
        assert.equal(commands.length, initialCommands);
        const sparseAnchor = await ghost(),
          sparsePoint = await world(sparseAnchor);
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mousePressed",
          x: sparsePoint.x,
          y: sparsePoint.y,
          button: "left",
          buttons: 1,
          clickCount: 1,
          pointerType: "pen",
        });
        await page.waitForTimeout(70);
        await cdp.send("Input.dispatchMouseEvent", {
          type: "mouseReleased",
          x: sparsePoint.x + tile,
          y: sparsePoint.y,
          button: "left",
          buttons: 0,
          clickCount: 1,
          pointerType: "pen",
        });
        await page.waitForTimeout(120);
        assert.equal(
          commands.length,
          initialCommands,
          "displaced pen release without move never builds",
        );
        assert.deepEqual(
          await ghost(),
          { x: sparseAnchor.x + 1, y: sparseAnchor.y },
          "sparse pen release moves preview",
        );
      }
    }
    let target;
    for (let dx = -3; dx <= 3 && !target; dx++)
      for (let dy = -3; dy <= 3; dy++) {
        const p = {
          x: latest.state.spawn.x + dx,
          y: latest.state.spawn.y + dy,
        };
        if (!placementError(latest.state, "foundry", 1, 0, p.x, p.y)) {
          target = p;
          break;
        }
      }
    assert.ok(target);
    if (profile.desktop) {
      const p = await world(target);
      await page.mouse.click(p.x, p.y);
    } else {
      const current = await ghost(),
        from = await world(current),
        to = await world(target);
      if (current.x !== target.x || current.y !== target.y)
        await drag(from, { x: to.x - from.x, y: to.y - from.y });
      assert.deepEqual(await ghost(), target);
      assert.equal(commands.length, initialCommands);
      await ui("Rotate ↻");
      await ui("Build ↵");
    }
    await wait(
      () => latest.state.modules.length === 2,
      "explicit placement creates one building",
    );
    const builds = commands.filter((c) => c.type === "build");
    assert.equal(builds.length, 1, "exactly one build command");
    assert.equal(builds[0].x, target.x);
    assert.equal(builds[0].y, target.y);
    assert.equal(
      builds[0].rotation,
      profile.desktop ? 0 : 1,
      profile.name + " rotation survives repositioning and confirmation",
    );
    if (!profile.desktop) {
      await select();
      const anchor = await ghost(),
        p = await world({ x: anchor.x + 1, y: anchor.y });
      await touch("touchStart", [p]);
      await page.waitForTimeout(70);
      await touch("touchEnd", []);
      await wait(
        () => commands.filter((c) => c.type === "build").length === 2,
        "short tap confirms existing preview",
      );
      const confirmed = commands.filter((c) => c.type === "build")[1];
      assert.equal(confirmed.x, anchor.x);
      assert.equal(confirmed.y, anchor.y);
      await wait(
        () => latest.state.modules.length === 3,
        "confirmed preview creates exactly one additional blueprint",
      );
    }
    if (profile.name === "phone320") {
      for (let i = 0; i < 9; i++) await ui("Zoom in");
      assert.equal(await zoom(), 4);
      await ui("Open build panel");
      await ui("I shape");
      await ui("Build Foundry");
      const anchor = await ghost(),
        tile = 24 * (await zoom());
      const a = await world(anchor),
        b = await world({ x: anchor.x + 3, y: anchor.y });
      assert.ok(
        a.x - tile / 2 >= 0 &&
          b.x + tile / 2 <= 320 &&
          a.y - tile / 2 >= 0 &&
          a.y + tile / 2 <= 568,
        "entire I preview remains on screen at maximum requested zoom",
      );
      assert.ok((await zoom()) < 4, "initial preview lowers zoom to fit phone");
    }
    await page.screenshot({
      path: `artifacts/touch-placement-${profile.name}.png`,
    });
    report.checks.push({
      profile: profile.name,
      immediatePreview: true,
      previewDrag: !profile.desktop,
      blankPan: !profile.desktop,
      pinchSafe: !profile.desktop,
      pen: profile.name === "ipad",
      scaled: !!profile.submission,
      hudInput: profile.submission
        ? "mouse (Chromium transformed-iframe touch-click issue)"
        : profile.desktop
          ? "mouse"
          : "touch",
      maximumZoomPreview: profile.name === "phone320",
      sparsePenRelease: profile.name === "ipad",
      buildCount: commands.filter((c) => c.type === "build").length,
      nonAnchorTapKeepsAnchor: !profile.desktop,
      rotationPreserved: true,
      desktopSingleClick: !!profile.desktop,
    });
    await page.request.post(apiOrigin + "/api/leave", {
      headers: { Authorization: "Bearer " + token },
      data: { code: latest.code },
    });
    await ctx.close();
  }
  assert.deepEqual(report.errors, []);
  console.log("PASS touch placement", JSON.stringify(report));
} catch (error) {
  report.failure = { name: error.name, message: error.message };
  throw error;
} finally {
  await writeFile(
    "artifacts/touch-placement.json",
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
