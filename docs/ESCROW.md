# Farfield RF matches — implementation and deployment

**Mainnet status: not deployed, deposits disabled.** Local Solidity and Anvil integration tests pass. No real RF approvals, transfers, deployment or wallet signatures have been submitted by the agent. A dedicated referee wallet has been generated at the builder’s request; it remains unfunded and deployment is pending.

## Agreed terms

- Robinhood mainnet, chain **4663**.
- Rare Friends **RF**, `0x0779369854d3EcdEA927206718FFD7730C67B71f`, 18 decimals. This is the token documented by [FriendSDK](https://github.com/spokesz/friendsdk/blob/main/contracts/README.md), not a different token with ticker RARE.
- Online matchmaking is **two human commanders**. Each deposits **exactly 1 RF** from the connected owner wallet. The winner claims **2 RF**; no platform fee.
- Farfield’s server is the trusted referee, as selected by the builder. It reports the gameplay winner through an immutable referee address. The contract verifies the reporter and payout recipient, not the underlying game simulation.
- Funding expires **10 minutes after the referee creates the on-chain match**. If only one player funds, that player can reclaim their 1 RF when the window expires.
- Once both deposits arrive, the result window is **45 minutes**. If no accepted result arrives before it expires, each player can independently reclaim their own 1 RF. A result cannot override an expired refund window.
- Either player may forfeit directly on-chain while the match is active; the other player becomes the winner without waiting for the server. The in-game forfeit is processed by the server and submitted as a result.
- Winner payments and refunds use **pull claims**. The contract never sends arbitrary prizes or grants a referee withdrawal. Users pay gas for their approval, deposit and claim; the referee pays gas to create and settle matches.

The SDK's supplied chance-game contract is not suitable for reporting deterministic PvP results. Farfield therefore uses `contracts/src/FarfieldEscrow.sol`, while retaining SDK identity, canonical art and sandbox integration. No chance-game deployment is involved.

## Implemented flow

1. The trusted landing offers the token option only if the server reports an enabled, verified deployment.
2. The owner signs a single-use challenge containing chain, escrow address, wallet, Friend, exact entry/prize terms, nonce and expiry. Signing transfers no funds. The server verifies the signature and freshly reads ownership, generation and canonical wallet. Currently EOA signatures are supported.
3. Paid and practice queues are separate. Paid players are bound to verified wallets. Two different wallets and Friends are required. An authenticated owner can resume their active paid seat; a practice room token cannot authorize an RF match.
4. The referee creates a fixed match on-chain. Both players review terms in a **trusted-host escrow dialog**, approve exactly 1 RF and deposit in separate wallet actions. The contract rechecks the Friend's current eligibility at deposit.
5. The server waits for confirmed on-chain funding before launching the simulation. Ordinary game `start` commands cannot bypass funding. Online pause is disallowed. A connection absent for over 60 seconds forfeits while a rival remains active.
6. On victory, the server reports the winning deposited wallet; the winner claims 2 RF through the escrow dialog. Failed/missing settlement leaves the timeout refund path intact.
7. Match IDs are saved in browser storage when escrow is opened. Landing **Settings → Recent RF matches** or a manually entered ID opens the recovery dialog. The contract can also be called directly without the app or referee server.

The game iframe can request that the trusted host open escrow, but receives no wallet provider or signer. The host pins transaction methods, amount and configured contract. Wallet/account/chain changes invalidate the selected game; the escrow dialog is keyed to the current identity. Buttons block duplicate submissions while receipt confirmation is pending.

## Local verification

```sh
npm run test:contracts
```

Eight Solidity tests cover fixed deposits, exact winner payout, duplicate/outsider claims, fresh ownership, referee authorization, direct forfeit, partial funding refunds and full funding timeout refunds. Tests deploy test doubles at the pinned addresses on a local chain.

For full server integration, start **local Anvil**, not a mainnet fork:

```sh
anvil --port 18545 --chain-id 4663 --block-time 1 --silent
```

Then:

```sh
npm run test:wagers
```

The integration uses Anvil's public development mnemonic in memory. It deploys locally, creates test RF/Generations contracts, verifies signed identity and nonce replay rejection, restores an authenticated seat, requires both confirmed deposits, settles a server-refereed forfeit, claims 2 RF, and recovers an unmatched deposit without the server. It never sends to mainnet. Never fund or reuse Anvil development accounts on a real network.

## Deployment preparation

Dedicated referee: **`0x6C2c8c529e4922d2D9fAD488A8B140A00FA4cF19`** on **Robinhood mainnet (4663)**. Generated with viem’s cryptographic key generator on 2026-09-20; a local sign/recover check passed. The private server environment is `/home/coder/.config/farfield/referee.env`, outside this repository, in a mode-0700 directory with mode-0600 file permissions. It is permission-protected plaintext, not an encrypted keystore. No key was printed, committed, copied to Browser Testing, or loaded by the running server. Wagers remain disabled.

Read-only RPC simulation at block 68100727 estimated deployment at **1,339,153 gas**, or **0.000076926304932 ETH** at the then-current gas price (57,444,000 wei). The simulation overrode the account balance only for estimation; it broadcast nothing. Actual gas fees can change. Balance was **0 ETH**. Funding and an actual deployment are still needed; re-estimate gas before broadcasting. Public metadata is in [referee-public.json](referee-public.json). Keep private keys out of chat, source, command arguments and frontend configuration.

The contract pins RF, Generations and chain 4663. The referee is immutable; replacing a referee requires a new deployment and preserving old claims. Compile and inspect before broadcasting:

```sh
forge build --root contracts
forge inspect --root contracts src/FarfieldEscrow.sol:FarfieldEscrow abi
```

After choosing the actual referee address and a local Foundry keystore account, the deployment command is:

```sh
forge create --root contracts src/FarfieldEscrow.sol:FarfieldEscrow \
  --rpc-url https://rpc.mainnet.chain.robinhood.com \
  --account DEPLOYER_KEYSTORE_NAME \
  --constructor-args REFEREE_PUBLIC_ADDRESS \
  --broadcast
```

**This broadcasts a real transaction and has not been run.** Record its transaction hash, deployed address, compiler settings, artifact and referee address in a deployment manifest. Contract code has local tests; it has not received an independent audit.

Server-only configuration, loaded through a protected environment file or secret manager:

```text
RF_ESCROW_ADDRESS=<deployed contract>
RF_REFEREE_KEY=<dedicated server signer secret>
RF_WAGERS_ENABLED=true
```

`FRIEND_RPC_URL` optionally selects a private provider. The referee needs ETH for gas but does not custody the prize pool. Never enable with a public development key. On startup the server checks chain, deployed code, RF token, entry amount and referee against configuration; any failed check leaves deposits disabled.

Restart using the environment without exposing its values (for example Node's `--env-file` pointing to a mode-0600 file). Verify `/api/wager/config` reports the intended public addresses. Test one actual-wallet match, timeout recovery and account switching with the builder before declaring the mode live. Production should retain the referee signer securely and run a monitored backend with durable match storage.

## Known limits

The simulation is still in memory. A server restart loses its off-chain match state; funds stay in escrow and are refundable at the fixed timeout. A referee outage lasting until the deadline voids a match. The referee is trusted and can report an incorrect winner before the deadline; the user explicitly selected this model. There is no on-chain gameplay proof, appeals process or automatic dispute resolution. A paid game lost to reload can be rejoined via a new signature only while the server retains it. Once the 60-second disconnect deadline passes, reconnecting does not undo a forfeit.

The app remembers recent match IDs in that browser. Clearing browser storage does not erase the on-chain match or claim; recover the ID from `MatchCreated`/`Deposited` events or transaction history. The on-chain `claim(id)` function remains available without this UI. Smart-contract accounts/ERC-1271 signatures are not yet supported by the matchmaking login.
