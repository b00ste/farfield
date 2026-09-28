// Browser Testing only: explicit auth/signature fixtures exercise the trusted-host
// boundary. This is not proof of server signature recovery or NFT ownership.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { installFixture } from "./fixture.mjs";
import { mkdir, writeFile } from "node:fs/promises";
const origin = process.env.TEST_URL || "http://127.0.0.1:4180";
const profile = { season: "Preseason", rating: 1200, deviation: 350, provisional: true, division: "Unranked", label: "Placement 0/5", placements: { completed: 0, required: 5 }, matches: 0, wins: 0, losses: 0, draws: 0, friendId: "7730", name: "Friend #7730" };
const token = "automation-only-ranked-token";
const message = "Automation fixture: ranked commander sign-in";
const report = { fixture: "Wallet signatures and ranked endpoints mocked; no live match", checks: [], errors: [] };
const browser = await chromium.launch({ channel: "chrome", args: ["--no-sandbox"] });
await mkdir("artifacts", { recursive: true });
try {
  for (const [name, width, height, enabled] of [["desktop",1440,900,true],["phone",390,844,true],["phone320",320,568,true],["tablet",1024,768,true],["landscape",932,430,true],["disabled",1440,900,false]]) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: !["desktop", "disabled"].includes(name) });
    const page = await context.newPage();
    page.on("pageerror", e => report.errors.push(e.message.replace(/https?:\/\/\S+/g,"[url]")));
    await installFixture(page, origin);
    await page.addInitScript(() => {
      const request = window.ethereum.request.bind(window.ethereum);
      window.__rankFixture = { reject: true, signs: 0, message: "", proofLeaked: false };
      window.ethereum.request = async args => {
        if (args.method !== "personal_sign") return request(args);
        const f = window.__rankFixture;
        f.signs++;
        f.message = args.params[0];
        if (f.reject) throw { code: 4001, message: "Rejected by fixture" };
        return "0x" + "11".repeat(65);
      };
      window.addEventListener("message", event => {
        if (JSON.stringify(event.data ?? {}, (_key,value) => typeof value === "bigint" ? String(value) : value).includes("automation-only-ranked-token")) window.__rankFixture.proofLeaked = true;
      });
    });
    let matchCalls = 0;
    await page.route("**/api/ranked/*", async route => {
      const path = new URL(route.request().url()).pathname.split("/").pop();
      assert.equal(route.request().method(),"POST");
      if (path === "config") return route.fulfill({json:{enabled,season:"Preseason"}});
      if (path === "leaderboard") return route.fulfill({json:{season:"Preseason",entries:[{...profile,position:1}]}});
      if (path === "challenge") return route.fulfill({json:{id:"fixture-challenge",message}});
      if (path === "verify") {
        assert.equal(route.request().postDataJSON().id,"fixture-challenge");
        return route.fulfill({json:{token,expiresAt:Date.now()+3600000,profile}});
      }
      if (path === "profile") return route.fulfill({json:{profile}});
      throw Error(`Unexpected ranked fixture path ${path}`);
    });
    await page.route("**/api/matchmake", route => {
      matchCalls++;
      assert.equal(route.request().headers().authorization, enabled ? `Bearer ${token}` : undefined);
      assert.equal(route.request().postDataJSON().friendId,"7730");
      return route.fulfill({status:503,json:{error:"Fixture stops before creating a live room."}});
    });
    await page.goto(origin);
    await page.getByRole("button",{name:"Connect wallet",exact:true}).first().click();
    await page.getByRole("button",{name:/Browser Wallet/}).click();
    await page.getByRole("button",{name:/Change commander/}).waitFor();
    await page.getByRole("button",{name:/Online PvP/}).click();
    if (enabled) {
      await page.getByRole("button",{name:"Leaderboard ↗",exact:true}).click();
      await page.getByRole("cell",{name:"Friend #7730",exact:true}).waitFor();
      await page.getByRole("button",{name:"Back to online play",exact:true}).click();
      const sign = page.getByRole("button",{name:"Sign in for ranked →",exact:true});
      await sign.click();
      await page.getByRole("alert").filter({hasText:"Sign-in was not completed"}).waitFor();
      assert.equal(await page.locator("iframe").count(),0);
      assert.equal(matchCalls,0);
      const controls = await page.locator(".landing-setup button:visible").evaluateAll(nodes => nodes.map(node=>{const r=node.getBoundingClientRect();return {name:node.textContent,ok:r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1};}));
      assert.ok(controls.every(c=>c.ok),JSON.stringify(controls));
      await page.screenshot({path:`artifacts/ranked-host-${name}.png`});
      await page.evaluate(()=>{window.__rankFixture.reject=false;});
      await sign.click();
    } else {
      assert.equal(await page.getByText("Leaderboard ↗",{exact:true}).count(),0);
      await page.getByRole("button",{name:"Find free match →",exact:true}).click();
    }
    await page.waitForFunction(()=>document.querySelector("iframe"));
    for(let i=0;i<100&&!matchCalls;i++) await page.waitForTimeout(100);
    assert.equal(matchCalls,1);
    const state = await page.evaluate(()=>window.__rankFixture);
    assert.equal(state.signs,enabled?2:0);
    if(enabled) assert.equal(Buffer.from(state.message.slice(2),"hex").toString(),message);
    assert.equal(state.proofLeaked,false);
    const storage = await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage}));
    assert.ok(!storage.includes(token));
    if (enabled) {
      await page.frameLocator("iframe").getByRole("button",{name:"Main menu",exact:true}).click();
      await page.getByRole("button",{name:/Online PvP/}).click();
      await page.getByRole("button",{name:"Sign in for ranked →",exact:true}).waitFor();
    }
    report.checks.push({name,enabled,failedMatchCanSignInAgain:enabled,rejectedSignaturePreventsLaunch:enabled,matchmakeUsesTrustedToken:enabled,noProofInWindowMessages:true,noProofPersisted:true});
    await context.close();
  }
  assert.deepEqual(report.errors,[]);
} finally {
  await writeFile("artifacts/ranked-host-browser.json",JSON.stringify(report,null,2));
  await browser.close();
}
console.log(JSON.stringify(report));
