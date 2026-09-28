// Browser Testing only. Access credentials stay outside the repository. Wallet/NFT
// discovery is fixture-only; ranked auth, custom simulation and SSE are real.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { privateKeyToAccount } from "viem/accounts";
import { installFixture } from "./fixture.mjs";
import { observeRoom } from "./room-observer.mjs";
import { place } from "../server/arena.ts";
const origin = "https://preview.farfield.fun";
assert.equal(process.env.TEST_URL, origin);
assert.equal(process.env.TEST_API_URL, origin);
const access = JSON.parse(await readFile(process.env.ACCESS_FILE || "/home/coder/.config/farfield/staging/access.json", "utf8"));
assert.equal(new URL(access.origin).origin, origin);
const accessHeaders = { "CF-Access-Client-Id": access.clientId, "CF-Access-Client-Secret": access.clientSecret };
const clean = value => String(value).replaceAll(access.clientId,"[redacted]").replaceAll(access.clientSecret,"[redacted]").replace(/eyJ[A-Za-z0-9_.-]+/g,"[jwt]").replace(/https?:\/\/\S+/g,"[url]");
const report = { origin, fixture: "Browser wallet and NFT discovery only; actual ranked auth, custom game and stream", unauthenticated: [], clients: [], errors: [], streams: 0, externalCredentialLeaks: 0 };
const browser = await chromium.launch({channel:"chrome",args:["--no-sandbox","--disable-background-timer-throttling","--disable-renderer-backgrounding"]});
const clients=[];
await mkdir("artifacts",{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function wait(fn,label,ms=30000){const until=Date.now()+ms;while(Date.now()<until){if(await fn())return;await sleep(100);}throw Error(label);}
async function api(context,path,body={},token){const response=await context.request.post(origin+"/api/"+path,{headers:{...accessHeaders,...(token?{Authorization:`Bearer ${token}`}:{})},data:body,maxRedirects:0});return {status:response.status(),body:await response.json()};}
async function command(c,command){const response=await api(c.context,"command",{code:c.latest.code,command},c.token);assert.equal(response.status,200,`Command rejected: ${command.type}`);c.latest=response.body;return response.body;}
async function connect(i){
 const context=await browser.newContext({viewport:i===3?{width:390,height:844}:{width:1440,height:900},hasTouch:i===3}),page=await context.newPage();
 page.setDefaultTimeout(20000);
 const c={i,context,page,game:page.frameLocator("iframe"),latest:null,token:null};clients.push(c);
 await installFixture(page,origin);
 await page.route("**/*",route=>{
  const request=route.request(),headers={...request.headers()};
  delete headers["cf-access-client-id"];delete headers["cf-access-client-secret"];
  if(new URL(request.url()).origin===origin)Object.assign(headers,accessHeaders);
  return route.fallback({headers});
 });
 page.on("request",request=>{const url=new URL(request.url());if(url.pathname==="/api/events")report.streams++;if(url.origin!==origin&&Object.keys(request.headers()).some(k=>k.toLowerCase().startsWith("cf-access-client-")))report.externalCredentialLeaks++;});
 page.on("pageerror",error=>report.errors.push(clean(error.message)));
 await observeRoom(page,view=>{if(!c.latest||view.revision>=c.latest.revision)c.latest=view;if(view.token)c.token=view.token;});
 await page.goto(origin);
 const script=await page.locator('script[src*="runtime.js"]').getAttribute("src");
 const build=new URL(script,origin).searchParams.get("v");
 if(process.env.EXPECT_BUILD)assert.equal(build,process.env.EXPECT_BUILD);
 report.build=build;
 await page.getByRole("button",{name:"Connect wallet",exact:true}).first().click();
 await page.getByRole("button",{name:/Browser Wallet/}).click();
 await page.getByRole("button",{name:/Change commander/}).waitFor();return c;
}
try{
 const unauth=await browser.newContext();
 for(const path of ["/","/game.html","/game.js","/api/ranked/config"]){
  const r=await unauth.request.get(origin+path,{maxRedirects:0});
  const destination=r.headers().location;const blocked=[302,303,307,401,403].includes(r.status());
  assert.ok(blocked,"Unauthenticated protected resource blocked");
  if(destination)assert.ok(new URL(destination,origin).hostname.endsWith("cloudflareaccess.com"));
  report.unauthenticated.push({path,status:r.status(),accessRedirect:!!destination});
 }
 const publicConfig=await unauth.request.post("https://api.farfield.fun/api/ranked/config",{data:{},maxRedirects:0});
 const publicRoot=await unauth.request.get("https://farfield.fun",{maxRedirects:0});assert.equal(publicRoot.status(),200);
 report.productionBuild=(await publicRoot.text()).match(/runtime\.js\?v=([a-f0-9]+)/)?.[1];
 if(publicConfig.status()===404)assert.equal(report.productionBuild,"0c0d663825e6c55f");
 else {assert.equal(publicConfig.status(),200);assert.equal((await publicConfig.json()).enabled,false);}
 report.productionRankedDisabled=true;
 const loginPage=await unauth.newPage();
 await loginPage.goto(origin);
 await loginPage.locator('input[type="email"]').waitFor({timeout:20000});
 assert.ok(new URL(loginPage.url()).hostname.endsWith("cloudflareaccess.com"));
 report.emailLoginReachable=await loginPage.locator('input[type="email"]').isVisible();
 report.otpDeliveryTested=false;
 await loginPage.screenshot({path:"artifacts/staging-email-login.png"});
 await unauth.close();
 const host=await connect(0);
 const config=await api(host.context,"ranked/config");assert.equal(config.status,200);assert.equal(config.body.enabled,true);report.rankedEnabled=true;
 await host.page.getByRole("button",{name:/Online PvP/}).click();
 await host.page.getByRole("button",{name:"Leaderboard ↗",exact:true}).click();
 await host.page.getByRole("region",{name:"Ranked leaderboard"}).waitFor();
 await host.page.getByRole("columnheader",{name:"Commander",exact:true}).waitFor();
 const standingsBefore=await api(host.context,"ranked/leaderboard");assert.equal(standingsBefore.status,200);
 if(!standingsBefore.body.entries.length)await host.page.getByText("Complete five placement matches to enter the leaderboard.",{exact:true}).waitFor();
 report.leaderboardLoaded=true;
 await host.page.screenshot({path:"artifacts/staging-leaderboard.png"});
 await host.page.getByRole("button",{name:"Back to online play",exact:true}).click();
 const fake=privateKeyToAccount(`0x${"11".repeat(32)}`);
 let challenge=await api(host.context,"ranked/challenge",{address:fake.address,friendId:"7730"});assert.equal(challenge.status,200);
 assert.ok(challenge.body.message.includes("preview.farfield.fun")&&challenge.body.message.includes("4663"));
 const invalid=await api(host.context,"ranked/verify",{id:challenge.body.id,signature:"0x"+"11".repeat(65)});assert.equal(invalid.status,400);
 challenge=await api(host.context,"ranked/challenge",{address:fake.address,friendId:"7730"});
 const signed=await fake.signMessage({message:challenge.body.message});
 const unowned=await api(host.context,"ranked/verify",{id:challenge.body.id,signature:signed});assert.equal(unowned.status,400);assert.ok(!unowned.body.token);
 const unsigned=await api(host.context,"matchmake",{friendId:"7730"});assert.equal(unsigned.status,400);
 report.realAuth={invalidSignatureRejected:true,validSignatureWithoutOwnershipRejected:true,unsignedMatchmakingRejected:true};
 await host.page.getByRole("button",{name:"Back to main menu",exact:true}).click();
 await host.page.getByRole("button",{name:/Friends & AI/}).click();
 await host.page.getByRole("combobox",{name:"AI commanders",exact:true}).click();
 await host.page.getByRole("option",{name:"Friends only",exact:true}).click();
 await host.page.getByRole("button",{name:"Enter sector →",exact:true}).click();
 await wait(()=>host.token,"custom host joins");
 for(let i=1;i<4;i++){
  const c=await connect(i);
  await c.page.getByRole("button",{name:/Join friends/}).click();
  await c.page.getByRole("textbox",{name:"Match code",exact:true}).fill(host.latest.code);
  await c.page.getByRole("button",{name:"Join friends →",exact:true}).click();
  await wait(()=>c.token,`custom client ${i} joins`);
 }
 await wait(()=>clients.every(c=>c.latest?.players.length===4),"four lobby views");
 await host.game.getByRole("button",{name:"Begin match →",exact:true}).click();
 await wait(()=>clients.every(c=>c.latest?.state.phase==="playing"),"all clients start");
 for(const c of clients){
  const state=structuredClone(c.latest.state);state.nextShape=1;
  const build=place(state,"foundry");assert.ok(build);
  await command(c,build);
 }
 await wait(()=>clients.every(c=>c.latest?.state.modules.some(m=>m.type==="foundry"&&m.progress>=1)),"Friends finish foundries",40000);
 for(const c of clients){
  const foundry=c.latest.state.modules.find(m=>m.type==="foundry");
  await command(c,{type:"direct",...foundry.cells[0],task:"work"});
  await command(c,{type:"recruit",role:"miners"});
 }
 await wait(()=>clients.every(c=>c.latest?.state.roles.miners===1),"all four workers recruited",20000);
 await sleep(3000);
 for(const c of clients){assert.equal(c.latest.ranked,undefined);report.clients.push({client:c.i,modules:c.latest.state.modules.length,workers:c.latest.state.crew,alloy:c.latest.state.alloy,unranked:true});}
 await clients[3].page.screenshot({path:"artifacts/staging-custom-phone.png"});
 for(const c of clients.slice(1))await command(c,{type:"forfeit"});
 await wait(()=>host.latest?.state.phase==="won","host custom victory");
 assert.equal(host.latest.ranked,undefined);
 const after=await api(host.context,"ranked/leaderboard");assert.equal(after.status,200);assert.deepEqual(after.body.entries,standingsBefore.body.entries);report.customDidNotEnterRankings=true;
 await host.page.screenshot({path:"artifacts/staging-custom-result.png"});
 assert.ok(report.streams>=4);assert.equal(report.externalCredentialLeaks,0);assert.deepEqual(report.errors,[]);
 report.positiveRankedLimitation="Requires a real owned Friend wallet signature; no production or ranked matches created by this test.";
}catch(error){report.failure=clean(error.message);process.exitCode=1;}
finally{
 for(const c of clients)if(c.token)await api(c.context,"leave",{code:c.latest.code},c.token).catch(()=>{});
 await writeFile("artifacts/staging-browser.json",JSON.stringify(report,null,2));
 await browser.close();
}
console.log(JSON.stringify(report));
