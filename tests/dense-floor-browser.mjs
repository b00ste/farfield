// Browser Testing only. Deterministic renderer fixture, no live game-state mutation.
import { chromium } from "playwright";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const bundle = await build({
  stdin: {
    contents: `import {createState,rotated} from './games/farfield/engine.ts';import {render} from './games/farfield/render.ts';window.fixture=()=>{const s=createState();s.modules=[];s.monoliths=[];s.friend.x=100;s.friend.y=100;for(let y=0;y<4;y++)for(let x=0;x<4;x++)s.modules.push({id:1+y*4+x,type:'habitat',cells:rotated(1,0).map(p=>({x:p.x+x*2,y:p.y+y*2})),progress:1,owner:'Station'});return s};window.paint=(canvas,s)=>render(canvas.getContext('2d'),400,320,s,{x:4,y:4,zoom:1},null,null,true);`,
    resolveDir: process.cwd(),
  },
  bundle: true,
  write: false,
  format: "iife",
  platform: "browser",
});
const browser = await chromium.launch({
  channel: "chrome",
  args: ["--no-sandbox"],
});
try {
  const page = await browser.newPage({
    viewport: { width: 820, height: 350 },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    '<body style="margin:0;background:#0c141f;color:#dbe8cc;font:14px monospace"><div style="display:flex;gap:20px"><section>Forward build order<br><canvas id="a" width="400" height="320"></canvas></section><section>Reverse build order<br><canvas id="b" width="400" height="320"></canvas></section></div></body>',
  );
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const result = await page.evaluate(() => {
    const s = fixture();
    paint(a, s);
    paint(b, { ...s, modules: [...s.modules].reverse() });
    const x = a.getContext("2d").getImageData(0, 0, 400, 320).data,
      y = b.getContext("2d").getImageData(0, 0, 400, 320).data;
    let differences = 0;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) differences++;
    return { modules: 16, tiles: 64, zoom: 1, differentChannels: differences };
  });
  assert.equal(
    result.differentChannels,
    0,
    "adjacent floors must render identically regardless of module placement order",
  );
  await mkdir("artifacts", { recursive: true });
  await page.screenshot({ path: "artifacts/dense-floor-order.png" });
  await writeFile(
    "artifacts/dense-floor-order.json",
    JSON.stringify(result, null, 2),
  );
  console.log("PASS dense floors", JSON.stringify(result));
} finally {
  await browser.close();
}
