// CLI HTTP integration. Only the upstream chain reads are fixtures; signature,
// matchmaking, commands, settlement and process restarts use the actual server.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { privateKeyToAccount } from 'viem/accounts';
const a = privateKeyToAccount(`0x${'11'.repeat(32)}`), b = privateKeyToAccount(`0x${'22'.repeat(32)}`);
const owners = new Map([['1',a.address],['2',b.address]]);
const rpc = createServer(async(req,res)=>{
 let raw=''; for await(const chunk of req)raw+=chunk;
 const body=JSON.parse(raw);
 const reply = item=>{
  let result;
  if(item.method==='eth_chainId')result='0x1237';
  else if(item.method==='eth_blockNumber')result='0x1';
  else if(item.method==='eth_call'){
   const data=item.params[0].data;
   if(data?.startsWith('0x6352211e'))result='0x'+(owners.get(BigInt('0x'+data.slice(10)).toString())||'0x'+'0'.repeat(40)).slice(2).padStart(64,'0');
   // Get the actual generation selector below; ERC6492 calls fail and viem
   // falls back to EOA recovery, keeping signatures cryptographically real.
   else if(data?.slice(0,10)===generationSelector)result='0x'+'1'.padStart(64,'0');
  }
  return result!==undefined?{jsonrpc:'2.0',id:item.id,result}:{jsonrpc:'2.0',id:item.id,error:{code:-32000,message:'Fixture: unsupported read'}};
 };
 res.setHeader('Content-Type','application/json');res.end(JSON.stringify(Array.isArray(body)?body.map(reply):reply(body)));
});
const {toFunctionSelector}=await import('viem');
const generationSelector=toFunctionSelector('generation(uint256)');
await new Promise(r=>rpc.listen(0,'127.0.0.1',r));
const rpcOrigin=`http://127.0.0.1:${rpc.address().port}`;
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const origin=`http://127.0.0.1:${port}`,dir=await mkdtemp(join(tmpdir(),'farfield-ranked-http-'));
let child,exited;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function start(){
 child=spawn(process.execPath,['dist/server.mjs'],{env:{...process.env,PORT:String(port),FRIEND_RPC_URL:rpcOrigin,FARFIELD_ALLOWED_ORIGINS:origin,FARFIELD_RANKED_ENABLED:'1',FARFIELD_RANKED_ORIGIN:origin,FARFIELD_RANKINGS_PATH:join(dir,'rankings.sqlite'),FARFIELD_STATE_PATH:join(dir,'rooms.json')},stdio:['ignore','ignore','pipe']});
 child.stderr.resume();exited=new Promise(r=>child.once('exit',code=>r(code)));
 for(let n=0;n<80;n++){try{if((await fetch(origin+'/health')).ok)return;}catch{}if(child.exitCode!==null)throw Error('Ranked server exited');await wait(100);}throw Error('Ranked server timeout');
}
async function stop(){child.kill('SIGTERM');assert.equal(await exited,0);}
async function api(path,body={},token,expected=200){const response=await fetch(origin+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(body)});const value=await response.json();assert.equal(response.status,expected,value.error||path);return value;}
async function login(account,friendId){const proof=await api('ranked/challenge',{address:account.address,friendId});const signature=await account.signMessage({message:proof.message});return api('ranked/verify',{id:proof.id,signature});}
try{
 await start();assert.equal((await api('ranked/config')).enabled,true);
 await api('matchmake',{friendId:'1'},undefined,400);
 await api('ranked/verify',{id:'invented',signature:'0x11'},undefined,400);
 const signedA=await login(a,'1'),signedB=await login(b,'2');
 await api('matchmake',{friendId:'2'},signedA.token,400);
 let first=await api('matchmake',{friendId:'1'},signedA.token);
 let second=await api('matchmake',{friendId:'2'},signedB.token);
 assert.equal(first.code,second.code);assert.equal(second.state.phase,'playing');
 assert.doesNotMatch(JSON.stringify(second),new RegExp(a.address.slice(2),'i'));
 const lost=await api('command',{code:first.code,command:{type:'forfeit'}},first.token);
 assert.equal(lost.ranked.result.outcome,'loss');assert.equal(lost.ranked.profile.matches,1);
 const won=await api('sync',{code:second.code},second.token);
 assert.equal(won.ranked.result.outcome,'win');assert.ok(won.ranked.result.delta>0);
 await api('command',{code:first.code,command:{type:'forfeit'}},first.token,400);
 assert.equal((await api('ranked/profile',{},signedA.token)).profile.matches,1);
 const custom=await api('create',{friendId:'1',mode:'custom',bots:['easy']});
 await api('command',{code:custom.code,command:{type:'start'}},custom.token);
 await api('command',{code:custom.code,command:{type:'forfeit'}},custom.token);
 assert.equal((await api('ranked/profile',{},signedA.token)).profile.matches,1);
 await api('leave',{code:first.code},first.token);await api('leave',{code:second.code},second.token);
 first=await api('matchmake',{friendId:'1'},signedA.token);second=await api('matchmake',{friendId:'2'},signedB.token);
 const queueCode=second.code;
 for(let n=0;n<50;n++){
  first= {...first,...await api('sync',{code:first.code},first.token)};
  const view=await api('sync',{code:queueCode},second.token);
  if(view.state.phase==='playing'){second={...second,...view};break;}
  await wait(1000);
 }
 assert.equal(second.state.phase,'playing','widened search must start the rematch');
 assert.equal(first.code,second.code);
 await stop();await start();
 const cancelled=await api('sync',{code:first.code},first.token);
 assert.match(cancelled.ranked.cancelled,/restarted/);assert.equal(cancelled.ranked.profile.matches,1);
 assert.equal(cancelled.ranked.result,null);
 await api('ranked/profile',{},signedA.token,400);
 assert.equal((await login(a,'1')).profile.matches,1);
 await stop();
 console.log(JSON.stringify({passed:true,checks:['real signature verification','ownership-bound matching','ranked win/loss persisted once','custom unranked','server restart cancels without rating','profile and results omit wallets']}));
}finally{if(child?.exitCode===null){child.kill('SIGTERM');await exited;}await new Promise(r=>rpc.close(r));await rm(dir,{recursive:true,force:true});}
