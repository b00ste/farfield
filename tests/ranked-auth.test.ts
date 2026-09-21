import test from "node:test";
import assert from "node:assert/strict";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { RankedAuth } from "../server/ranked-auth.ts";
// Deterministic test-only accounts: no funds, no production usage.
const alice = privateKeyToAccount(`0x${"11".repeat(32)}`);
const bob = privateKeyToAccount(`0x${"22".repeat(32)}`);
const verifier = { signature: (address: `0x${string}`, message: string, signature: `0x${string}`) => verifyMessage({address,message,signature}), ownership: async () => true };
test("ranked sign-in binds domain, wallet, Friend and chain; verifies real signatures", async () => {
  const auth = new RankedAuth("https://preview.farfield.fun", verifier);
  const challenge = auth.challenge(alice.address, "94425", 1000);
  assert.match(challenge.message, /preview.farfield.fun/);
  assert.match(challenge.message, /Chain ID: 4663/);
  assert.match(challenge.message, /Friend: 94425/);
  const signature = await alice.signMessage({ message: challenge.message });
  const session = await auth.verify(challenge.id, signature, 1001);
  assert.equal(auth.access(session.token, 1002).address, alice.address.toLowerCase());
  assert.equal(auth.access(session.token, 1002).friendId, "94425");
  await assert.rejects(auth.verify(challenge.id, signature, 1002), /already used/);
  assert.throws(() => auth.access(session.token, session.expiresAt), /expired/);
});
test("wrong signer, expired nonce, missing NFT, and upstream errors never authorize", async () => {
  const auth = new RankedAuth("https://preview.farfield.fun", verifier);
  const challenge = auth.challenge(alice.address, "1", 1000);
  await assert.rejects(auth.verify(challenge.id, await bob.signMessage({message:challenge.message}),1001), /Could not verify/);
  const expired = auth.challenge(alice.address, "1",1000);
  await assert.rejects(auth.verify(expired.id, await alice.signMessage({message:expired.message}),301000), /expired/);
  for (const ownership of [async () => false, async () => {throw Error("https://rpc.invalid/private-secret");}]) {
    const denied = new RankedAuth("https://preview.farfield.fun", {...verifier,ownership});
    const proof = denied.challenge(alice.address,"1",1000);
    await assert.rejects(denied.verify(proof.id,await alice.signMessage({message:proof.message}),1001), e => {
      assert.ok(e instanceof Error); assert.doesNotMatch(e.message,/private-secret|rpc.invalid/); return true;
    });
  }
});
test("parallel replay yields one session; matchmaking rechecks ownership and selected Friend", async () => {
  let owned = true;
  const auth = new RankedAuth("https://preview.farfield.fun", {...verifier,ownership:async()=>owned});
  const proof = auth.challenge(alice.address,"1",1000);
  const signature = await alice.signMessage({message:proof.message});
  const results = await Promise.allSettled([auth.verify(proof.id,signature,1001),auth.verify(proof.id,signature,1001)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  const session = results.find(r=>r.status==='fulfilled')!.value;
  await assert.rejects(auth.authorizeMatch(session.token,"2",1002),/selected Friend/);
  assert.equal((await auth.authorizeMatch(session.token,"1",1002)).friendId,"1");
  owned = false;
  await assert.rejects(auth.authorizeMatch(session.token,"1",1002), /ownership/);
});
test("challenge input and origin are bounded and canonical", () => {
  assert.throws(()=>new RankedAuth('https://preview.farfield.fun/path',verifier), /origin/);
  const auth = new RankedAuth('https://preview.farfield.fun',verifier);
  for(const id of ['0','01','-1','x',(1n<<256n).toString()]) assert.throws(()=>auth.challenge(alice.address,id),/eligible/);
  assert.throws(()=>auth.challenge('0x'+'0'.repeat(40),'1'),/wallet/);
  assert.throws(()=>auth.access('forged'),/expired/);
});
