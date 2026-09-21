# Ranked Preseason (private preview)

Ranking is off by default. The public game keeps its existing free matchmaking until this preview has been accepted. Only automatic online 1v1 matches affect ratings; custom matches and AI never do.

## Player experience

Online PvP asks for a wallet signature before ranked matchmaking. The message identifies the site, Robinhood chain 4663, selected Friend, nonce and expiry. The server verifies the signature and canonical NFT ownership/generation through FriendSDK. Ratings follow the wallet, not the selected Friend. Changing commanders preserves the record. Sign-in is held only in the trusted host's memory; match seat capabilities remain separate.

Five completed matches establish a division. Profiles show placements, rating, wins, losses and draws. The leaderboard lists the top 20 players who completed placements, using Friend labels without publishing wallet addresses. Public Friend IDs can still be correlated with on-chain ownership; this is not anonymity.

Preseason uses Glicko-1 with initial rating 1500 and rating deviation 350. Each match is a rating period; both updates use pre-match values. Deviation has a floor of 50 and does not increase for inactivity in this first version. The authoritative formula is [Glickman's specification](https://www.glicko.net/glicko/glicko.pdf).

| Division | Displayed rating after placements |
| --- | --- |
| Bronze | Below 1200 |
| Silver | 1200–1399 |
| Gold | 1400–1599 |
| Platinum | 1600–1799 |
| Diamond | 1800+ |

Matchmaking starts within 150 rating points, widens by 50 every ten seconds, and stops widening at 800. The longer-waiting player's range applies. Waiting players are paired automatically as that range expands; the same wallet cannot occupy two active ranked seats. A waiting seat must remain connected. These thresholds are experimental and should be adjusted using real queue data.

Wins, losses and draws count; resource and worker counts do not. Leaving or forfeiting a live match is a loss. Disconnects retain the existing 60-second grace period. Both disconnected players can produce a draw. Cancelled queue entries do not count.

A server restart voids unfinished ranked games without changing ratings. A server loop stall longer than five seconds also voids active ranked games. An already-committed result survives a stale room snapshot and is not applied twice. The result screen distinguishes cancellations from wins and losses. Daily staging backup briefly stops the server, so active test matches can be cancelled during that maintenance window.

## Storage and configuration

Server-only environment:

```env
FARFIELD_RANKED_ENABLED=1
FARFIELD_RANKED_ORIGIN=https://preview.farfield.fun
FARFIELD_RANKINGS_PATH=/data/rankings.sqlite
FARFIELD_STATE_PATH=/data/rooms.json
FARFIELD_ALLOWED_ORIGINS=https://preview.farfield.fun
```

Build with an empty `PUBLIC_API_ORIGIN` for the private preview; the app and API share the Access-protected origin. Do not copy production rooms or ratings into the preview. The RPC upstream remains a private runtime setting.

The rankings database lives outside the web root, uses 0600 permissions and full synchronous SQLite transactions. One transaction records the match, both profile updates and both results. Match IDs are immutable and exact replays are idempotent. Room snapshots are separate; the results ledger is authoritative when restoring a previously committed result.

The first implementation assumes a single authoritative process. It does not add distributed matchmaking, multi-writer game servers, automated anti-collusion detection or seasonal resets. These are free, experimental ratings with no rewards attached. Repeated matches with cooperating accounts can manipulate ratings; assess this before expanding beyond the test group.

## Validation

- `npm test`: rating math, transactions/rollback, replay, placements, queue widening, wallet isolation, reconnect boundaries and restart recovery.
- `npm run test:ranked-server`: real server, real test-wallet signatures, fixture chain reads, matchmaking, forfeit settlement, custom exclusion and process restart.
- `npm run test:ranked-browser`: Browser Testing workspace only; host signature UI fixtures, failure/retry, private token boundary and desktop/mobile layout. Fixtures never ship in the app.
- Live preview: verify unauthenticated requests to both the app and `/api/*` are denied; sign in with an approved email; test two real eligible wallets, play to a result and re-open the leaderboard. Browser emulation cannot verify native mobile wallet switching.

The preview hosting setup and exact access rules are in `deploy/aws/staging/README.md`.
