# Live playtest — 21 September 2026

Status: four-session gameplay validation complete; suitable for a small free early-access playtest. Larger public concurrency is limited by the development proxy. These are observed results, not a production certification.

## Four-session economy stress run

Four isolated Chromium contexts joined through the title screen and room code at the public HTTPS preview. Three were 1440×900 desktops; one was a 390×844 touch viewport. All used the real room server, normal command API, production resource costs, construction time and simulation speed. Only wallet ownership/artwork RPC was supplied by the SDK test fixture; no state/resource injection or clock acceleration.

Over seven minutes the stations reached 56, 57, 60 and 60 buildings, each with 64 workers: **233 buildings and 256 workers**. **489 successful commands, zero API errors and zero page errors.** Command latency: median 9.9 ms, p95 16.2 ms on this cluster/network. Mean animation-frame intervals ranged 16.5–20.6 ms (roughly 49–60 FPS); desktop p95 33.4 ms, touch viewport p95 16.8 ms. These are headless shared-machine observations, not physical-phone benchmarks or internet-wide latency guarantees.

The first run caught missing reload recovery. Dismantling inspection also confirmed that completed tiles were retained as walkable wrecks, even on voluntary demolition. Fixes now distinguish voluntary floor removal from enemy wreckage, evacuate friendly occupants and guard enemy occupancy/connectivity, clear invalid navigation paths, and save a same-tab seat capability behind wallet/Friend revalidation.

The final seven-minute rerun after the evacuation/recovery fixes reached **60 buildings and 64 workers per player: 240 buildings / 256 workers**, with **496 successful commands, zero API errors and zero page errors**. Reload restored the same seat after reconnecting the fixture wallet. Mean frame intervals were 18.4/19.2/21.0/16.6 ms; desktop p95 was 33.4 ms, touch p95 16.8 ms. Command p95 was 19.3 ms. This complete rerun passed; `artifacts/live-four-final.json` records it.

Reproduce in Browser Testing, with Playwright and Chrome already installed:

```sh
PLAY_SECONDS=420 node tests/live-four-player.mjs
PLAY_SECONDS=210 WIN_PHASE=1 node tests/live-four-player.mjs
node tests/submission-browser.mjs
```

Artifacts remain in `artifacts/` (ignored, not source assets). Request reports contain timings and gameplay stats, not wallet/referee private keys or saved seat tokens.

## Live objective and combat match

Four browser contexts started from equal corner cores, grew real economies, then built completed paths to four distinct monoliths. All four Friends physically reached and captured their objective. A second Friend then marched to the first player's occupied monolith: the objective became contested and did not change ownership remotely. A manual attack dealt damage; the defender used Shield, was defeated and respawned at its core. Rivals withdrew over built paths. The first commander captured the remaining signals and held all four for the full 60 seconds. **All four sessions agreed on the same winner and victory cause (`signals`).** The match ran about 15 minutes 40 seconds with 456 ordinary commands and no gameplay API/page errors.

The run's post-match screenshot step failed because it tried to click the now-hidden Center station button. This was a test-harness failure after the gameplay assertions, not a game crash; the helper now skips camera buttons after game over. Full-screen Victory/Defeat UI was subsequently checked in a separate real two-client matchmaking/forfeit test. The original report retains the failure rather than presenting the whole script as passed.

## Fixes and focused verification

- Voluntary dismantling removes its four tiles and returns 75% of alloy. Friendly occupants physically walk clear first; refunds happen once, after removal. Enemy occupants block removal. Station bridges require an alternative completed route. Unfinished cancellation still refunds 100%, including orphaned dependent blueprints. Enemy combat wreckage remains walkable.
- Removed flooring invalidates cached movement paths, including routes across other stations. Building staff cannot auto-reassign onto a building being cleared; evacuation takes precedence over automatic aggression.
- Same-tab recovery stores only the room capability and selected identity/launch settings in session storage. Reconnecting the same wallet and revalidating ownership restores the same seat; it does not create a new commander. An expired room now offers a way back to the menu. A final browser check caught inherited `pointer-events: none` blocking that button; the button now explicitly accepts pointer input. The rerun passed a real server-side seat removal, clicked Main menu and verified the saved capability was cleared.
- Optional `?submission=1` gives the game an actual 960×640 inner viewport, uniformly scaled/letterboxed. Real scaled pointer placement, floor removal and seat recovery passed at 1920×1080 and 852×393. The normal route remains responsive.
- Removed the medium-width action strip's forced full width. It now stays compact at 960px too.
- Touch-only regression passed at 320×568 after the evacuation change: roster, selectors, pinch/pan/cancel, rotation/placement/refunds, movement, recruitment/assignments, guard commands, dock positions, panel scrolling, settings, pause, forfeit and return home.
- Real online matchmaking with two distinct fixture wallet/Friend identities automatically paired and launched both clients, then agreed on the winner after a UI forfeit. Both result screens covered the entire viewport and RF deposits remained disabled.
- Authenticated seats now have independent request budgets behind a shared reverse proxy. Inventing bearer strings still shares the unauthenticated IP budget. A real HTTP load test with **16 seats in four rooms, 1,280 sync requests in 20 seconds**, returned no errors on the candidate server. This is transport load, not 16-browser rendering performance.

### Public hosting limit

The same HTTP test through the public development URL passed with **8 seats / 2 rooms, 640 sync requests over 20 seconds**, zero errors and p95 111 ms. At **16 seats / 4 rooms**, the outer proxy returned HTTP 429: “You've been rate limited for sending more than 512 requests in 1m0s.” The retained rerun recorded 96 rejected requests out of 1,280 sync requests. The direct Node server handled that load without errors; the public proxy is a separate limit. This short eight-seat sample does not establish sustained eight-player capacity. Four real browser sessions and two-client matchmaking passed through the public URL, but a larger launch needs hosting with appropriate request capacity (or a different transport). No infrastructure limits were changed.

65 logic/server tests, TypeScript checking, FriendSDK validation, production build and 8 local Solidity tests pass. A fresh checkout-style directory passed `npm ci --ignore-scripts` and the production build; transitive wallet packages emit existing deprecation/peer warnings. Synthetic crowded simulation (480 modules / 256 workers) remains roughly 8.3 ms mean / 10.5 ms p95 per tick/view update.

Browser automation uses Chrome in `rarefriends-browser`. Game APIs are live except explicitly labelled deterministic combat fixtures in other suites. Browser ownership/art fixtures cannot verify physical mobile wallet handoff, real NFT discovery under load, or human game balance. Rooms still reset on process restart. Mainnet money mode remains disabled and unaudited. Public-preview uptime depends on the development workspace.
